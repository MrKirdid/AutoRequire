import * as vscode from 'vscode';
import * as path from 'path';
import { ModuleInfo } from './types';
import { PathResolver } from './pathResolver';

/**
 * Indexes and caches all Luau modules in the workspace
 */
export class ModuleIndexer {
  private modules: ModuleInfo[] = [];
  private indexing: boolean = false;
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private workspaceFolders: readonly vscode.WorkspaceFolder[],
    private pathResolver: PathResolver
  ) {}

  /**
   * Initialize the indexer and start watching for changes
   */
  public async initialize(): Promise<void> {
    await this.rebuildIndex();
    this.setupFileWatcher();
  }

  /**
   * Rebuild the entire module index
   */
  public async rebuildIndex(): Promise<void> {
    if (this.indexing) {
      console.log('[Super Require] Index rebuild already in progress');
      return;
    }

    this.indexing = true;
    this.modules = [];

    console.log('[Super Require] Starting module indexing...');
    const startTime = Date.now();

    try {
      // Search for only .luau files (Rojo standard)
      const files = await vscode.workspace.findFiles(
        '**/*.luau',
        '**/node_modules/**' // Exclude node_modules
      );

      console.log(`[Super Require] Found ${files.length} Luau files`);

      for (const file of files) {
        this.indexFile(file);
      }

      const duration = Date.now() - startTime;
      console.log(`[Super Require] Indexed ${this.modules.length} modules in ${duration}ms`);
    } catch (error) {
      console.error('[Super Require] Error during indexing:', error);
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Index a single file
   */
  private indexFile(uri: vscode.Uri): void {
    const fsPath = uri.fsPath;
    const fileName = path.basename(fsPath);
    const nameWithoutExt = fileName.replace(/\.luau$/, '');

    // Skip files starting with dot
    if (fileName.startsWith('.')) {
      return;
    }

    // Handle init.luau files - use parent folder name as module name
    let name: string;
    if (nameWithoutExt.toLowerCase() === 'init' || 
        nameWithoutExt.toLowerCase() === 'init.server' || 
        nameWithoutExt.toLowerCase() === 'init.client') {
      // Get parent folder name as the module name
      const parentDir = path.dirname(fsPath);
      name = path.basename(parentDir);
    } else {
      name = nameWithoutExt;
    }

    // Find workspace folder for relative path
    const workspaceFolder = this.workspaceFolders.find(folder =>
      fsPath.startsWith(folder.uri.fsPath)
    );

    const relativePath = workspaceFolder
      ? path.relative(workspaceFolder.uri.fsPath, fsPath)
      : fsPath;

    // Resolve instance path
    const instancePath = this.pathResolver.resolveInstancePath(fsPath);

    const moduleInfo: ModuleInfo = {
      name,
      fsPath,
      instancePath,
      relativePath,
    };

    this.modules.push(moduleInfo);
  }

  /**
   * Set up file system watcher for dynamic updates
   */
  private setupFileWatcher(): void {
    // Watch for only .luau file changes (Rojo standard)
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.luau'
    );

    // File created
    this.fileWatcher.onDidCreate((uri) => {
      console.log(`[Super Require] File created: ${uri.fsPath}`);
      this.indexFile(uri);
    });

    // File deleted
    this.fileWatcher.onDidDelete((uri) => {
      console.log(`[Super Require] File deleted: ${uri.fsPath}`);
      this.modules = this.modules.filter(m => m.fsPath !== uri.fsPath);
    });

    // File changed (might be renamed or moved)
    this.fileWatcher.onDidChange((uri) => {
      console.log(`[Super Require] File changed: ${uri.fsPath}`);
      // Remove old entry and re-index
      this.modules = this.modules.filter(m => m.fsPath !== uri.fsPath);
      this.indexFile(uri);
    });

    console.log('[Super Require] File watcher activated');
  }

  /**
   * Get all indexed modules
   */
  public getModules(): ModuleInfo[] {
    return this.modules;
  }

  /**
   * Get modules count
   */
  public getModuleCount(): number {
    return this.modules.length;
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.fileWatcher?.dispose();
    this.modules = [];
  }
}