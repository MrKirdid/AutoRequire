import * as vscode from 'vscode';
import { ModuleIndexer } from './moduleIndexer';
import { PathResolver } from './pathResolver';
import { RequireCompletionProvider } from './completionProvider';
import { ExtensionConfig } from './types';
import { logger } from './logger';

let moduleIndexer: ModuleIndexer | undefined;
let pathResolver: PathResolver | undefined;
let completionProvider: RequireCompletionProvider | undefined;
let disposables: vscode.Disposable[] = [];
let isActivating: boolean = false;
let isReinitializing: boolean = false;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
  // Prevent concurrent activation
  if (isActivating) {
    logger.warn('Activation already in progress, skipping');
    return;
  }
  isActivating = true;

  // Initialize logger first - this creates the output channel
  logger.init();

  try {
    // Get workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
      const msg = 'No workspace folder found. Please open a folder first.';
      logger.warn(msg);
      vscode.window.showWarningMessage(`Roblox Super Require: ${msg}`);
      return;
    }

    logger.info(`Workspace: ${workspaceFolders.map(f => f.name).join(', ')}`);

    // Load configuration
    const config = loadConfiguration();

    // Initialize components with error handling
    try {
      pathResolver = new PathResolver(workspaceFolders);
      await pathResolver.initialize();
    } catch (e) {
      logger.error('Failed to initialize PathResolver', e);
      if (!pathResolver) {
        pathResolver = new PathResolver(workspaceFolders);
      }
    }
    
    try {
      moduleIndexer = new ModuleIndexer(workspaceFolders, pathResolver);
    } catch (e) {
      logger.error('Failed to create ModuleIndexer', e);
      throw e;
    }
    
    try {
      completionProvider = new RequireCompletionProvider(moduleIndexer, config);
    } catch (e) {
      logger.error('Failed to initialize CompletionProvider', e);
      throw e;
    }

    // Index modules with timeout
    try {
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Indexing timed out')), 30000);
      });
      
      await Promise.race([moduleIndexer.initialize(), timeoutPromise]);
    } catch (e) {
      logger.error('Module indexing failed', e);
      vscode.window.showWarningMessage(`Roblox Super Require: Indexing had issues: ${e}`);
    }

    // Register completion provider for Lua and Luau files
    const luaSelector: vscode.DocumentSelector = [
      { scheme: 'file', language: 'lua' },
      { scheme: 'file', language: 'luau' },
      { scheme: 'file', pattern: '**/*.lua' },
      { scheme: 'file', pattern: '**/*.luau' }
    ];

    // Trigger on ':' and alphanumeric characters for fuzzy search
    const triggerCharacters = ':';
    const alphaNum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    const providerDisposable = vscode.languages.registerCompletionItemProvider(
      luaSelector,
      completionProvider,
      ...triggerCharacters,
      ...alphaNum
    );

  disposables.push(providerDisposable);

  // Watch for configuration changes
  const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('robloxSuperRequire')) {
      const newConfig = loadConfiguration();
      completionProvider?.updateConfig(newConfig);
    }
  });

  disposables.push(configWatcher);

  // Watch for workspace folder changes
  const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(async () => {
    if (isReinitializing) {
      return;
    }
    isReinitializing = true;
    try {
      const newWorkspaceFolders = vscode.workspace.workspaceFolders;
      if (newWorkspaceFolders && newWorkspaceFolders.length > 0) {
        pathResolver = new PathResolver(newWorkspaceFolders);
        await pathResolver.initialize();
        moduleIndexer?.dispose();
        moduleIndexer = new ModuleIndexer(newWorkspaceFolders, pathResolver);
        await moduleIndexer.initialize();
        completionProvider?.updateFuseIndex();
      }
    } catch (e) {
      logger.error('Failed to reinitialize after workspace change', e);
    } finally {
      isReinitializing = false;
    }
  });

  disposables.push(workspaceWatcher);

  // Watch for sourcemap.json changes
  const sourcemapWatcher = vscode.workspace.createFileSystemWatcher('**/sourcemap.json');
  
  const handleSourcemapChange = async () => {
    if (isReinitializing) return;
    pathResolver?.reloadSourcemaps();
    pathResolver?.clearCache();
    await moduleIndexer?.rebuildIndex();
    completionProvider?.updateFuseIndex();
  };

  const sourcemapChangeDisposable = sourcemapWatcher.onDidChange(handleSourcemapChange);
  const sourcemapCreateDisposable = sourcemapWatcher.onDidCreate(handleSourcemapChange);
  const sourcemapDeleteDisposable = sourcemapWatcher.onDidDelete(handleSourcemapChange);

  disposables.push(sourcemapWatcher, sourcemapChangeDisposable, sourcemapCreateDisposable, sourcemapDeleteDisposable);

  // Watch for default.project.json changes (Rojo project file)
  const rojoProjectWatcher = vscode.workspace.createFileSystemWatcher('**/default.project.json');
  
  const handleRojoProjectChange = async () => {
    if (isReinitializing) return;
    pathResolver?.reloadRojoProjects();
    pathResolver?.clearCache();
    await moduleIndexer?.rebuildIndex();
    completionProvider?.updateFuseIndex();
  };

  const rojoChangeDisposable = rojoProjectWatcher.onDidChange(handleRojoProjectChange);
  const rojoCreateDisposable = rojoProjectWatcher.onDidCreate(handleRojoProjectChange);
  const rojoDeleteDisposable = rojoProjectWatcher.onDidDelete(handleRojoProjectChange);

  disposables.push(rojoProjectWatcher, rojoChangeDisposable, rojoCreateDisposable, rojoDeleteDisposable);

  // Register commands
  const reindexCommand = vscode.commands.registerCommand(
    'robloxSuperRequire.reindex',
    async () => {
      await moduleIndexer?.rebuildIndex();
      completionProvider?.updateFuseIndex();
      const count = moduleIndexer?.getModuleCount() || 0;
      vscode.window.showInformationMessage(`Indexed ${count} modules`);
    }
  );
  disposables.push(reindexCommand);

  // Status command to check if extension is working
  const statusCommand = vscode.commands.registerCommand(
    'robloxSuperRequire.showStatus',
    () => {
      const count = moduleIndexer?.getModuleCount() || 0;
      const modules = moduleIndexer?.getModules() || [];
      
      let message = `Roblox Super Require Status:\n`;
      message += `- Extension: Active ✓\n`;
      message += `- Modules indexed: ${count}\n`;
      message += `- Enabled: ${config.enabled}\n`;
      
      if (count > 0) {
        message += `\nFirst 5 modules:\n`;
        modules.slice(0, 5).forEach((m, i) => {
          message += `${i + 1}. ${m.name}\n`;
        });
      }
      
      vscode.window.showInformationMessage(message, { modal: true });
      logger.show();
    }
  );
  disposables.push(statusCommand);

  // Add all disposables to context
  context.subscriptions.push(...disposables);

  const moduleCount = moduleIndexer?.getModuleCount() || 0;
  logger.info(`Activated with ${moduleCount} modules indexed`);

  } catch (error) {
    // Catch any unhandled errors during activation
    logger.error('FATAL ERROR during activation', error);
    vscode.window.showErrorMessage(`Roblox Super Require failed to activate: ${error}`);
  } finally {
    isActivating = false;
  }
}

/**
 * Load extension configuration
 */
function loadConfiguration(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('robloxSuperRequire');
  
  return {
    enabled: config.get<boolean>('enabled', true),
    fuzzyThreshold: config.get<number>('fuzzyThreshold', 0.4),
    maxSuggestions: config.get<number>('maxSuggestions', 20),
  };
}

/**
 * Extension deactivation
 */
export function deactivate() {
  // Dispose in reverse order of creation
  moduleIndexer?.dispose();
  pathResolver?.dispose();
  
  for (const disposable of disposables) {
    try {
      disposable.dispose();
    } catch (e) {
      // Ignore disposal errors
    }
  }

  disposables = [];
  moduleIndexer = undefined;
  pathResolver = undefined;
  completionProvider = undefined;
  isActivating = false;
  isReinitializing = false;
  
  logger.dispose();
}