import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Sourcemap, SourcemapNode, RojoProject, RojoTreeNode } from './types';

/**
 * Resolves file system paths to Roblox Instance paths
 */
export class PathResolver {
  private sourcemapCache: Map<string, Sourcemap> = new Map();
  private rojoProjectCache: Map<string, RojoProject> = new Map();
  private fileToInstancePathCache: Map<string, string> = new Map();

  constructor(private workspaceFolders: readonly vscode.WorkspaceFolder[]) {
    this.loadSourcemaps();
    this.loadRojoProjects();
  }

  /**
   * Load all sourcemap.json files from workspace folders
   */
  private loadSourcemaps(): void {
    for (const folder of this.workspaceFolders) {
      const sourcemapPath = path.join(folder.uri.fsPath, 'sourcemap.json');
      
      if (fs.existsSync(sourcemapPath)) {
        try {
          const content = fs.readFileSync(sourcemapPath, 'utf-8');
          const sourcemap: Sourcemap = JSON.parse(content);
          this.sourcemapCache.set(folder.uri.fsPath, sourcemap);
          console.log(`[Super Require] Loaded sourcemap for ${folder.name}`);
        } catch (error) {
          console.error(`[Super Require] Failed to parse sourcemap at ${sourcemapPath}:`, error);
        }
      }
    }
  }

  /**
   * Load all default.project.json files from workspace folders (Rojo project files)
   */
  private loadRojoProjects(): void {
    for (const folder of this.workspaceFolders) {
      // Try default.project.json first, then *.project.json
      const projectPaths = [
        path.join(folder.uri.fsPath, 'default.project.json'),
      ];

      for (const projectPath of projectPaths) {
        if (fs.existsSync(projectPath)) {
          try {
            const content = fs.readFileSync(projectPath, 'utf-8');
            const project: RojoProject = JSON.parse(content);
            this.rojoProjectCache.set(folder.uri.fsPath, project);
            console.log(`[Super Require] Loaded Rojo project for ${folder.name}`);
            break;
          } catch (error) {
            console.error(`[Super Require] Failed to parse Rojo project at ${projectPath}:`, error);
          }
        }
      }
    }
  }

  /**
   * Reload sourcemaps (call when sourcemap.json changes)
   */
  public reloadSourcemaps(): void {
    this.sourcemapCache.clear();
    this.fileToInstancePathCache.clear();
    this.loadSourcemaps();
  }

  /**
   * Reload Rojo projects (call when default.project.json changes)
   */
  public reloadRojoProjects(): void {
    this.rojoProjectCache.clear();
    this.fileToInstancePathCache.clear();
    this.loadRojoProjects();
  }

  /**
   * Resolve a file system path to a Roblox Instance path
   */
  public resolveInstancePath(fsPath: string): string {
    // Check cache first
    if (this.fileToInstancePathCache.has(fsPath)) {
      return this.fileToInstancePathCache.get(fsPath)!;
    }

    // Try sourcemap resolution first
    const sourcemapPath = this.resolveFromSourcemap(fsPath);
    if (sourcemapPath) {
      const fullPath = 'game.' + sourcemapPath;
      this.fileToInstancePathCache.set(fsPath, fullPath);
      return fullPath;
    }

    // Try Rojo project resolution
    const rojoPath = this.resolveFromRojoProject(fsPath);
    if (rojoPath) {
      const fullPath = 'game.' + rojoPath;
      this.fileToInstancePathCache.set(fsPath, fullPath);
      return fullPath;
    }

    // Fallback to folder convention
    const conventionPath = this.resolveFromConvention(fsPath);
    const fullPath = 'game.' + conventionPath;
    this.fileToInstancePathCache.set(fsPath, fullPath);
    return fullPath;
  }

  /**
   * Resolve path using sourcemap.json
   */
  private resolveFromSourcemap(fsPath: string): string | null {
    // Find which workspace folder contains this file
    const workspaceFolder = this.workspaceFolders.find(folder =>
      fsPath.startsWith(folder.uri.fsPath)
    );

    if (!workspaceFolder) {
      return null;
    }

    const sourcemap = this.sourcemapCache.get(workspaceFolder.uri.fsPath);
    if (!sourcemap || !sourcemap.children) {
      return null;
    }

    // Normalize the file path for comparison
    const normalizedFsPath = fsPath.replace(/\\/g, '/');
    const workspacePath = workspaceFolder.uri.fsPath.replace(/\\/g, '/');

    // Search through sourcemap tree
    const result = this.searchSourcemapNode(
      sourcemap.children,
      normalizedFsPath,
      workspacePath,
      []
    );

    return result;
  }

  /**
   * Recursively search sourcemap tree for matching file path
   */
  private searchSourcemapNode(
    nodes: SourcemapNode[],
    targetPath: string,
    workspacePath: string,
    pathSegments: string[]
  ): string | null {
    for (const node of nodes) {
      const currentPath = [...pathSegments, node.name];

      // Check if this node has the target file
      if (node.filePaths) {
        for (const filePath of node.filePaths) {
          const fullPath = path.join(workspacePath, filePath).replace(/\\/g, '/');
          
          if (fullPath === targetPath || fullPath === targetPath.replace(/\.luau$/, '')) {
            return currentPath.join('.');
          }
        }
      }

      // Search children recursively
      if (node.children) {
        const result = this.searchSourcemapNode(
          node.children,
          targetPath,
          workspacePath,
          currentPath
        );
        
        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  /**
   * Resolve path using Rojo default.project.json
   */
  private resolveFromRojoProject(fsPath: string): string | null {
    // Find which workspace folder contains this file
    const workspaceFolder = this.workspaceFolders.find(folder =>
      fsPath.startsWith(folder.uri.fsPath)
    );

    if (!workspaceFolder) {
      return null;
    }

    const project = this.rojoProjectCache.get(workspaceFolder.uri.fsPath);
    if (!project || !project.tree) {
      return null;
    }

    // Normalize paths for comparison
    const normalizedFsPath = fsPath.replace(/\\/g, '/');
    const workspacePath = workspaceFolder.uri.fsPath.replace(/\\/g, '/');
    const relativePath = path.relative(workspacePath, normalizedFsPath).replace(/\\/g, '/');

    // Search through Rojo tree for $path mappings
    const result = this.searchRojoTree(project.tree, relativePath, workspacePath, []);
    return result;
  }

  /**
   * Recursively search Rojo project tree for matching file path
   */
  private searchRojoTree(
    node: RojoTreeNode,
    targetRelativePath: string,
    workspacePath: string,
    pathSegments: string[]
  ): string | null {
    // Check if this node has a $path that maps to or contains our target
    if (node.$path) {
      const nodePath = node.$path.replace(/\\/g, '/');
      
      // Check if target file is within this $path
      if (targetRelativePath.startsWith(nodePath + '/') || targetRelativePath === nodePath) {
        // Calculate the remaining path after the $path
        let remainingPath: string;
        if (targetRelativePath === nodePath) {
          remainingPath = '';
        } else {
          remainingPath = targetRelativePath.substring(nodePath.length + 1);
        }

        // Build the instance path
        const segments = remainingPath ? remainingPath.split('/') : [];
        
        // Process remaining segments - handle init.luau and file extensions
        const processedSegments = this.processPathSegments(segments);
        
        // Build full path
        const fullSegments = [...pathSegments, ...processedSegments];
        return fullSegments.join('.');
      }
    }

    // Search children (keys that don't start with $)
    for (const key of Object.keys(node)) {
      if (!key.startsWith('$')) {
        const childNode = node[key] as RojoTreeNode;
        if (childNode && typeof childNode === 'object') {
          const childPath = [...pathSegments, key];
          const result = this.searchRojoTree(childNode, targetRelativePath, workspacePath, childPath);
          if (result) {
            return result;
          }
        }
      }
    }

    return null;
  }

  /**
   * Process path segments - handle init.luau files and extensions
   */
  private processPathSegments(segments: string[]): string[] {
    if (segments.length === 0) {
      return [];
    }

    const result: string[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      let segment = segments[i];
      
      // Remove .luau extension
      segment = segment.replace(/\.luau$/, '');
      
      // Handle init files - they represent the parent folder, so skip them
      // But if it's the last segment and it's init, we don't add anything
      // because the parent folder name is already in the path
      if (segment.toLowerCase() === 'init' || 
          segment.toLowerCase() === 'init.server' || 
          segment.toLowerCase() === 'init.client') {
        // Skip init files - they represent the parent folder
        continue;
      }
      
      result.push(segment);
    }

    return result;
  }

  /**
   * Resolve path using folder naming conventions
   */
  private resolveFromConvention(fsPath: string): string {
    // Find workspace folder
    const workspaceFolder = this.workspaceFolders.find(folder =>
      fsPath.startsWith(folder.uri.fsPath)
    );

    if (!workspaceFolder) {
      return this.getFileNameWithoutExtension(fsPath);
    }

    const relativePath = path.relative(workspaceFolder.uri.fsPath, fsPath);
    const segments = relativePath.split(path.sep);

    // Process segments - handle init.luau and extensions
    const processedSegments: string[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      let segment = segments[i];
      
      // Remove .luau extension
      segment = segment.replace(/\.luau$/, '');
      
      // Handle init files
      if (segment.toLowerCase() === 'init' || 
          segment.toLowerCase() === 'init.server' || 
          segment.toLowerCase() === 'init.client') {
        continue; // Skip - parent folder name is the module name
      }
      
      processedSegments.push(segment);
    }

    // Map common folder names to Roblox services (first segment only)
    const serviceMap: Record<string, string> = {
      'src': 'ReplicatedStorage',
      'server': 'ServerScriptService',
      'client': 'StarterPlayer.StarterPlayerScripts',
      'shared': 'ReplicatedStorage.Shared',
      'replicated': 'ReplicatedStorage',
      'replicatedstorage': 'ReplicatedStorage',
      'serverscriptservice': 'ServerScriptService',
      'serverstorage': 'ServerStorage',
      'starterplayer': 'StarterPlayer',
      'startergui': 'StarterGui',
      'lighting': 'Lighting',
      'workspace': 'Workspace',
    };

    // Try to identify service from first folder
    if (processedSegments.length > 0) {
      const firstSegment = processedSegments[0].toLowerCase();
      const mappedService = serviceMap[firstSegment];

      if (mappedService) {
        processedSegments[0] = mappedService;
      }
    }

    return processedSegments.join('.');
  }

  /**
   * Get file name without extension
   */
  private getFileNameWithoutExtension(fsPath: string): string {
    const fileName = path.basename(fsPath);
    return fileName.replace(/\.luau$/, '');
  }

  /**
   * Clear the instance path cache
   */
  public clearCache(): void {
    this.fileToInstancePathCache.clear();
  }
}