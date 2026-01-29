import * as vscode from 'vscode';
import * as path from 'path';
import { ModuleInfo } from './types';
import { PathResolver } from './pathResolver';
import { logger } from './logger';

/**
 * Indexes and caches all Luau modules in the workspace
 */
export class ModuleIndexer {
  private modules: ModuleInfo[] = [];
  private indexing: boolean = false;
  private watcherDisposables: vscode.Disposable[] = [];

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
      return;
    }

    this.indexing = true;
    this.modules = [];

    const startTime = Date.now();

    try {
      // Search for .luau files (Rojo standard) - exclude _Index (Wally internal)
      const luauFiles = await vscode.workspace.findFiles(
        '**/*.luau',
        '{**/node_modules/**,**/_Index/**}'
      );

      // Search for .lua files in Packages, ServerPackages, and DevPackages (Wally packages)
      // Only get the top-level link files, not the _Index contents
      const wallyPackageFiles = await vscode.workspace.findFiles(
        '{**/Packages/*.lua,**/ServerPackages/*.lua,**/DevPackages/*.lua}',
        '**/_Index/**'
      );

      for (const file of luauFiles) {
        this.indexFile(file, false);
      }

      for (const file of wallyPackageFiles) {
        this.indexFile(file, true);
      }

      const duration = Date.now() - startTime;
      logger.info(`Indexed ${this.modules.length} modules in ${duration}ms`);
    } catch (error) {
      logger.error('Error during indexing', error);
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Index a single file
   * @param uri The file URI
   * @param isWallyPackage Whether this is a Wally package link file
   */
  private indexFile(uri: vscode.Uri, isWallyPackage: boolean = false): void {
    const fsPath = uri.fsPath;
    const fileName = path.basename(fsPath);
    
    // Skip files starting with dot
    if (fileName.startsWith('.')) {
      return;
    }

    // Skip _Index folder contents (Wally internal)
    if (fsPath.includes(`${path.sep}_Index${path.sep}`) || fsPath.includes('/_Index/')) {
      return;
    }

    // Skip server and client scripts - they can't be required (they're Script/LocalScript, not ModuleScript)
    // But allow init.server.luau and init.client.luau as they represent the parent folder
    const lowerFileName = fileName.toLowerCase();
    const isServerScript = (lowerFileName.endsWith('.server.luau') || lowerFileName.endsWith('.server.lua')) && !lowerFileName.startsWith('init.');
    const isClientScript = (lowerFileName.endsWith('.client.luau') || lowerFileName.endsWith('.client.lua')) && !lowerFileName.startsWith('init.');
    if (isServerScript || isClientScript) {
      return;
    }

    // Remove extensions: .server.luau, .client.luau, .luau, .lua
    let nameWithoutExt = fileName;
    if (nameWithoutExt.toLowerCase().endsWith('.server.luau')) {
      nameWithoutExt = nameWithoutExt.slice(0, -12);
    } else if (nameWithoutExt.toLowerCase().endsWith('.client.luau')) {
      nameWithoutExt = nameWithoutExt.slice(0, -12);
    } else if (nameWithoutExt.toLowerCase().endsWith('.server.lua')) {
      nameWithoutExt = nameWithoutExt.slice(0, -11);
    } else if (nameWithoutExt.toLowerCase().endsWith('.client.lua')) {
      nameWithoutExt = nameWithoutExt.slice(0, -11);
    } else if (nameWithoutExt.toLowerCase().endsWith('.luau')) {
      nameWithoutExt = nameWithoutExt.slice(0, -5);
    } else if (nameWithoutExt.toLowerCase().endsWith('.lua')) {
      nameWithoutExt = nameWithoutExt.slice(0, -4);
    }

    // Handle init.luau/init.lua files - use parent folder name as module name
    let name: string;
    if (nameWithoutExt.toLowerCase() === 'init') {
      // Get parent folder name as the module name
      const parentDir = path.dirname(fsPath);
      name = path.basename(parentDir);
    } else {
      name = nameWithoutExt;
    }
    
    // Safety: ensure name doesn't have any remaining extension
    if (name.includes('.')) {
      name = name.replace(/\.(luau|lua|server|client)$/i, '');
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
      isWallyPackage,
    };

    this.modules.push(moduleInfo);
  }

  /**
   * Set up file system watcher for dynamic updates
   */
  private setupFileWatcher(): void {
    // Dispose any existing watchers first
    this.disposeWatchers();

    // Watch for .luau file changes (Rojo standard)
    const luauWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.luau'
    );

    // Watch for .lua file changes in Packages/ServerPackages/DevPackages (Wally)
    const luaWatcher = vscode.workspace.createFileSystemWatcher(
      '{**/Packages/*.lua,**/ServerPackages/*.lua,**/DevPackages/*.lua}'
    );

    // Helper to check if file should be indexed
    const shouldIndex = (uri: vscode.Uri): boolean => {
      const fsPath = uri.fsPath;
      // Skip _Index folder
      if (fsPath.includes(`${path.sep}_Index${path.sep}`) || fsPath.includes('/_Index/')) {
        return false;
      }
      return true;
    };

    // .luau file handlers
    const luauCreateDisposable = luauWatcher.onDidCreate((uri) => {
      if (shouldIndex(uri)) {
        this.indexFile(uri, false);
      }
    });

    const luauDeleteDisposable = luauWatcher.onDidDelete((uri) => {
      this.modules = this.modules.filter(m => m.fsPath !== uri.fsPath);
    });

    const luauChangeDisposable = luauWatcher.onDidChange((uri) => {
      if (shouldIndex(uri)) {
        this.modules = this.modules.filter(m => m.fsPath !== uri.fsPath);
        this.indexFile(uri, false);
      }
    });

    // .lua file handlers (Wally packages)
    const luaCreateDisposable = luaWatcher.onDidCreate((uri) => {
      if (shouldIndex(uri)) {
        this.indexFile(uri, true);
      }
    });

    const luaDeleteDisposable = luaWatcher.onDidDelete((uri) => {
      this.modules = this.modules.filter(m => m.fsPath !== uri.fsPath);
    });

    const luaChangeDisposable = luaWatcher.onDidChange((uri) => {
      if (shouldIndex(uri)) {
        this.modules = this.modules.filter(m => m.fsPath !== uri.fsPath);
        this.indexFile(uri, true);
      }
    });

    // Store all disposables for proper cleanup
    this.watcherDisposables.push(
      luauWatcher, luauCreateDisposable, luauDeleteDisposable, luauChangeDisposable,
      luaWatcher, luaCreateDisposable, luaDeleteDisposable, luaChangeDisposable
    );
  }

  /**
   * Dispose file watchers
   */
  private disposeWatchers(): void {
    for (const disposable of this.watcherDisposables) {
      try {
        disposable.dispose();
      } catch (e) {
        // Ignore disposal errors
      }
    }
    this.watcherDisposables = [];
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
    this.disposeWatchers();
    this.modules = [];
  }
}