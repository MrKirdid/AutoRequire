import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Sourcemap, SourcemapNode } from './types';

/**
 * Resolves file system paths to Roblox Instance paths
 */
export class PathResolver {
  private sourcemapCache: Map<string, Sourcemap> = new Map();
  private fileToInstancePathCache: Map<string, string> = new Map();

  constructor(private workspaceFolders: readonly vscode.WorkspaceFolder[]) {
    this.loadSourcemaps();
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
   * Reload sourcemaps (call when sourcemap.json changes)
   */
  public reloadSourcemaps(): void {
    this.sourcemapCache.clear();
    this.fileToInstancePathCache.clear();
    this.loadSourcemaps();
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
      this.fileToInstancePathCache.set(fsPath, sourcemapPath);
      return sourcemapPath;
    }

    // Fallback to folder convention
    const conventionPath = this.resolveFromConvention(fsPath);
    this.fileToInstancePathCache.set(fsPath, conventionPath);
    return conventionPath;
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
          
          if (fullPath === targetPath || fullPath === targetPath.replace(/\.(lua|luau)$/, '')) {
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

    // Remove file extension from last segment
    const lastSegment = segments[segments.length - 1];
    segments[segments.length - 1] = lastSegment.replace(/\.(lua|luau)$/, '');

    // Map common folder names to Roblox services
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
    if (segments.length > 1) {
      const firstSegment = segments[0].toLowerCase();
      const mappedService = serviceMap[firstSegment];

      if (mappedService) {
        segments[0] = mappedService;
      }
    }

    return segments.join('.');
  }

  /**
   * Get file name without extension
   */
  private getFileNameWithoutExtension(fsPath: string): string {
    const fileName = path.basename(fsPath);
    return fileName.replace(/\.(lua|luau)$/, '');
  }

  /**
   * Clear the instance path cache
   */
  public clearCache(): void {
    this.fileToInstancePathCache.clear();
  }
}