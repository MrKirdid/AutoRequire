import * as vscode from 'vscode';
import { ModuleIndexer } from './moduleIndexer';
import { PathResolver } from './pathResolver';
import { RequireCompletionProvider } from './completionProvider';
import { ExtensionConfig } from './types';

let moduleIndexer: ModuleIndexer | undefined;
let pathResolver: PathResolver | undefined;
let completionProvider: RequireCompletionProvider | undefined;
let disposables: vscode.Disposable[] = [];

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('[Super Require] Extension activating...');

  // Get workspace folders
  const workspaceFolders = vscode.workspace.workspaceFolders;
  
  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log('[Super Require] No workspace folder found, extension will not activate');
    return;
  }

  // Load configuration
  const config = loadConfiguration();

  // Initialize components
  pathResolver = new PathResolver(workspaceFolders);
  moduleIndexer = new ModuleIndexer(workspaceFolders, pathResolver);
  completionProvider = new RequireCompletionProvider(moduleIndexer, config);

  // Index modules
  await moduleIndexer.initialize();

  // Register completion provider for Lua and Luau files
  const luaSelector: vscode.DocumentSelector = [
    { scheme: 'file', language: 'lua' },
    { scheme: 'file', language: 'luau' }
  ];

  const providerDisposable = vscode.languages.registerCompletionItemProvider(
    luaSelector,
    completionProvider,
    ':' // Trigger character
  );

  disposables.push(providerDisposable);

  // Watch for configuration changes
  const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('robloxSuperRequire')) {
      console.log('[Super Require] Configuration changed, reloading...');
      const newConfig = loadConfiguration();
      completionProvider?.updateConfig(newConfig);
    }
  });

  disposables.push(configWatcher);

  // Watch for workspace folder changes
  const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    console.log('[Super Require] Workspace folders changed, reinitializing...');
    deactivate();
    activate(context);
  });

  disposables.push(workspaceWatcher);

  // Watch for sourcemap.json changes
  const sourcemapWatcher = vscode.workspace.createFileSystemWatcher('**/sourcemap.json');
  
  sourcemapWatcher.onDidChange(() => {
    console.log('[Super Require] sourcemap.json changed, reloading...');
    pathResolver?.reloadSourcemaps();
    pathResolver?.clearCache();
    moduleIndexer?.rebuildIndex();
    completionProvider?.updateFuseIndex();
  });

  sourcemapWatcher.onDidCreate(() => {
    console.log('[Super Require] sourcemap.json created, reloading...');
    pathResolver?.reloadSourcemaps();
    pathResolver?.clearCache();
    moduleIndexer?.rebuildIndex();
    completionProvider?.updateFuseIndex();
  });

  sourcemapWatcher.onDidDelete(() => {
    console.log('[Super Require] sourcemap.json deleted, reloading...');
    pathResolver?.reloadSourcemaps();
    pathResolver?.clearCache();
    moduleIndexer?.rebuildIndex();
    completionProvider?.updateFuseIndex();
  });

  disposables.push(sourcemapWatcher);

  // Register commands
  const reindexCommand = vscode.commands.registerCommand(
    'robloxSuperRequire.reindex',
    async () => {
      vscode.window.showInformationMessage('Reindexing modules...');
      await moduleIndexer?.rebuildIndex();
      completionProvider?.updateFuseIndex();
      const count = moduleIndexer?.getModuleCount() || 0;
      vscode.window.showInformationMessage(`Indexed ${count} modules`);
    }
  );

  disposables.push(reindexCommand);

  // Add all disposables to context
  context.subscriptions.push(...disposables);

  const moduleCount = moduleIndexer.getModuleCount();
  console.log(`[Super Require] Extension activated successfully! Indexed ${moduleCount} modules.`);
  
  // Show a subtle notification
  vscode.window.showInformationMessage(
    `Roblox Super Require: Indexed ${moduleCount} modules`
  );
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
  console.log('[Super Require] Extension deactivating...');

  // Dispose all resources
  moduleIndexer?.dispose();
  
  for (const disposable of disposables) {
    disposable.dispose();
  }

  disposables = [];
  moduleIndexer = undefined;
  pathResolver = undefined;
  completionProvider = undefined;

  console.log('[Super Require] Extension deactivated');
}
