import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Sourcemap, SourcemapNode, RojoProject, RojoTreeNode } from './types';
import { logger } from './logger';

/**
 * Check if a string is a valid Lua identifier (can use dot notation)
 */
function isValidLuaIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Format a path segment for Lua - use dot notation if valid identifier, bracket notation otherwise
 */
function formatPathSegment(segment: string): string {
  if (isValidLuaIdentifier(segment)) {
    return `.${segment}`;
  }
  // Use bracket notation for invalid identifiers (escape backslash and quotes)
  return `["${segment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/**
 * Build a Lua path from segments with proper notation
 */
function buildLuaPath(prefix: string, segments: string[]): string {
  return prefix + segments.map(formatPathSegment).join('');
}

/**
 * Resolves file system paths to Roblox Instance paths
 */
export class PathResolver {
  private sourcemapCache: Map<string, Sourcemap> = new Map();
  private rojoProjectCache: Map<string, RojoProject> = new Map();
  private fileToInstancePathCache: Map<string, string> = new Map();
  private initialized: boolean = false;

  constructor(private workspaceFolders: readonly vscode.WorkspaceFolder[]) {
    // Don't load anything in constructor - do it lazily or via explicit init
  }

  /**
   * Initialize by loading project files (call this explicitly)
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.loadSourcemapsAsync();
    await this.loadRojoProjectsAsync();
    this.initialized = true;
  }

  /**
   * Load all sourcemap.json files from workspace folders (async)
   */
  private async loadSourcemapsAsync(): Promise<void> {
    for (const folder of this.workspaceFolders) {
      const sourcemapPath = path.join(folder.uri.fsPath, 'sourcemap.json');
      
      try {
        const uri = vscode.Uri.file(sourcemapPath);
        const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
        
        if (exists) {
          const contentBytes = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(contentBytes).toString('utf-8');
          const sourcemap: Sourcemap = JSON.parse(content);
          this.sourcemapCache.set(folder.uri.fsPath, sourcemap);
        }
      } catch (error) {
        logger.error(`Failed to load sourcemap at ${sourcemapPath}`, error);
      }
    }
  }

  /**
   * Load all default.project.json files from workspace folders (async)
   */
  private async loadRojoProjectsAsync(): Promise<void> {
    for (const folder of this.workspaceFolders) {
      const projectPath = path.join(folder.uri.fsPath, 'default.project.json');

      try {
        const uri = vscode.Uri.file(projectPath);
        const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
        
        if (exists) {
          const contentBytes = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(contentBytes).toString('utf-8');
          const project: RojoProject = JSON.parse(content);
          this.rojoProjectCache.set(folder.uri.fsPath, project);
        }
      } catch (error) {
        logger.error(`Failed to load Rojo project at ${projectPath}`, error);
      }
    }
  }

  /**
   * Load sourcemaps synchronously (for reload)
   */
  private loadSourcemaps(): void {
    for (const folder of this.workspaceFolders) {
      const sourcemapPath = path.join(folder.uri.fsPath, 'sourcemap.json');
      
      try {
        if (fs.existsSync(sourcemapPath)) {
          const content = fs.readFileSync(sourcemapPath, 'utf-8');
          const sourcemap: Sourcemap = JSON.parse(content);
          this.sourcemapCache.set(folder.uri.fsPath, sourcemap);
        }
      } catch (error) {
        logger.error(`Failed to parse sourcemap at ${sourcemapPath}`, error);
      }
    }
  }

  /**
   * Load Rojo projects synchronously (for reload)
   */
  private loadRojoProjects(): void {
    for (const folder of this.workspaceFolders) {
      const projectPath = path.join(folder.uri.fsPath, 'default.project.json');

      try {
        if (fs.existsSync(projectPath)) {
          const content = fs.readFileSync(projectPath, 'utf-8');
          const project: RojoProject = JSON.parse(content);
          this.rojoProjectCache.set(folder.uri.fsPath, project);
        }
      } catch (error) {
        logger.error(`Failed to parse Rojo project at ${projectPath}`, error);
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
      const cached = this.fileToInstancePathCache.get(fsPath)!;
      return cached;
    }

    try {
      // Try sourcemap resolution first
      const sourcemapSegments = this.resolveFromSourcemapAsSegments(fsPath);
      if (sourcemapSegments && sourcemapSegments.length > 0) {
        const fullPath = 'game' + formatPathSegment(sourcemapSegments[0], false) + 
          (sourcemapSegments.length > 1 ? sourcemapSegments.slice(1).map((s, i) => formatPathSegment(s, false)).join('') : '');
        this.fileToInstancePathCache.set(fsPath, fullPath);
        return fullPath;
      }

      // Try Rojo project resolution
      const rojoSegments = this.resolveFromRojoProjectAsSegments(fsPath);
      if (rojoSegments && rojoSegments.length > 0) {
        const fullPath = 'game' + rojoSegments.map((s, i) => formatPathSegment(s, false)).join('');
        this.fileToInstancePathCache.set(fsPath, fullPath);
        return fullPath;
      }

      // Fallback to folder convention
      const conventionSegments = this.resolveFromConventionAsSegments(fsPath);
      const fullPath = 'game' + conventionSegments.map((s, i) => formatPathSegment(s, false)).join('');
      this.fileToInstancePathCache.set(fsPath, fullPath);
      return fullPath;
    } catch (error) {
      // Fallback to a simple path on error
      const fileName = path.basename(fsPath).replace(/\.(server|client)?\.luau$/i, '');
      const safePath = 'game' + formatPathSegment(fileName, false);
      this.fileToInstancePathCache.set(fsPath, safePath);
      return safePath;
    }
  }

  /**
   * Resolve path using sourcemap.json (returns segments array)
   */
  private resolveFromSourcemapAsSegments(fsPath: string): string[] | null {
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
    return this.searchSourcemapNodeAsSegments(
      sourcemap.children,
      normalizedFsPath,
      workspacePath,
      []
    );
  }



  /**
   * Recursively search sourcemap tree for matching file path (returns segments array)
   */
  private searchSourcemapNodeAsSegments(
    nodes: SourcemapNode[],
    targetPath: string,
    workspacePath: string,
    pathSegments: string[]
  ): string[] | null {
    for (const node of nodes) {
      const currentPath = [...pathSegments, node.name];

      // Check if this node has the target file
      if (node.filePaths) {
        for (const filePath of node.filePaths) {
          const fullPath = path.join(workspacePath, filePath).replace(/\\/g, '/');
          
          // Normalize both paths by removing .luau extension for comparison
          const normalizedFullPath = fullPath.replace(/\.luau$/i, '');
          const normalizedTargetPath = targetPath.replace(/\.luau$/i, '');
          
          if (normalizedFullPath === normalizedTargetPath) {
            return currentPath;
          }
        }
      }

      // Search children recursively
      if (node.children) {
        const result = this.searchSourcemapNodeAsSegments(
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
   * Resolve path using Rojo default.project.json (returns segments array)
   */
  private resolveFromRojoProjectAsSegments(fsPath: string): string[] | null {
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
    return this.searchRojoTreeAsSegments(project.tree, relativePath, workspacePath, []);
  }

  /**
   * Recursively search Rojo project tree for matching file path (returns segments array)
   */
  private searchRojoTreeAsSegments(
    node: RojoTreeNode,
    targetRelativePath: string,
    workspacePath: string,
    pathSegments: string[]
  ): string[] | null {
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
        
        // Build full path as segments array
        return [...pathSegments, ...processedSegments];
      }
    }

    // Search children (keys that don't start with $)
    for (const key of Object.keys(node)) {
      if (!key.startsWith('$')) {
        const childNode = node[key];
        // Type guard: ensure childNode is a non-null object (RojoTreeNode)
        if (childNode !== null && childNode !== undefined && typeof childNode === 'object') {
          const childPath = [...pathSegments, key];
          const result = this.searchRojoTreeAsSegments(childNode as RojoTreeNode, targetRelativePath, workspacePath, childPath);
          if (result) {
            return result;
          }
        }
      }
    }

    return null;
  }

  /**
   * Process path segments - handle init.luau/init.lua files and extensions
   */
  private processPathSegments(segments: string[]): string[] {
    if (segments.length === 0) {
      return [];
    }

    const result: string[] = [];
    
    for (let i = 0; i < segments.length; i++) {
      let segment = segments[i];
      
      // Remove .luau extension and .server/.client suffixes
      segment = segment.replace(/\.(server|client)?\.luau$/i, '');
      
      // Handle init files - they represent the parent folder, so skip them
      if (segment.toLowerCase() === 'init') {
        // Skip init files - they represent the parent folder
        continue;
      }
      
      result.push(segment);
    }

    return result;
  }

  /**
   * Resolve path using folder naming conventions (returns segments array)
   */
  private resolveFromConventionAsSegments(fsPath: string): string[] {
    // Find workspace folder
    const workspaceFolder = this.workspaceFolders.find(folder =>
      fsPath.startsWith(folder.uri.fsPath)
    );

    if (!workspaceFolder) {
      return [this.getFileNameWithoutExtension(fsPath)];
    }

    const relativePath = path.relative(workspaceFolder.uri.fsPath, fsPath);
    const segments = relativePath.split(path.sep);

    // Process segments - handle init.luau/init.lua and extensions
    const processedSegments: string[] = [];
    
    for (const seg of segments) {
      // Remove .luau/.lua extension and .server/.client suffixes
      let segment = seg.replace(/\.(server|client)?\.(luau|lua)$/i, '');
      segment = segment.replace(/\.(luau|lua)$/i, '');
      
      // Handle init files
      if (segment.toLowerCase() === 'init') {
        continue;
      }
      
      processedSegments.push(segment);
    }

    // Map common folder names to Roblox services (first segment only)
    const serviceMap: Record<string, string> = {
      'src': 'ReplicatedStorage',
      'server': 'ServerScriptService',
      'client': 'StarterPlayer.StarterPlayerScripts',
      'shared': 'ReplicatedStorage',
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
        // Handle services that have dots in them (like StarterPlayer.StarterPlayerScripts)
        if (mappedService.includes('.')) {
          const serviceParts = mappedService.split('.');
          processedSegments.splice(0, 1, ...serviceParts);
        } else {
          processedSegments[0] = mappedService;
        }
      }
    }

    // Handle edge case where all segments were init files - return a default
    if (processedSegments.length === 0) {
      // Get the file name as a fallback
      return [this.getFileNameWithoutExtension(fsPath)];
    }

    return processedSegments;
  }

  /**
   * Get file name without extension
   */
  private getFileNameWithoutExtension(fsPath: string): string {
    const fileName = path.basename(fsPath);
    return fileName.replace(/\.(luau|lua)$/i, '');
  }

  /**
   * Clear the instance path cache
   */
  public clearCache(): void {
    this.fileToInstancePathCache.clear();
  }
}