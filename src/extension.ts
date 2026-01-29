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

export async function activate(context: vscode.ExtensionContext) {
  logger.init();

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    logger.warn('No workspace folder found');
    return;
  }

  logger.info(`Workspace: ${workspaceFolders.map(f => f.name).join(', ')}`);

  try {
    const config = loadConfiguration();

    // Initialize components
    pathResolver = new PathResolver(workspaceFolders);
    await pathResolver.initialize();

    moduleIndexer = new ModuleIndexer(workspaceFolders, pathResolver);
    completionProvider = new RequireCompletionProvider(moduleIndexer, config);

    // Index modules with timeout
    await Promise.race([
      moduleIndexer.initialize(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Indexing timed out')), 30000))
    ]).catch(e => logger.error('Indexing failed', e));

    // Register completion provider
    const luaSelector: vscode.DocumentSelector = [
      { scheme: 'file', language: 'lua' },
      { scheme: 'file', language: 'luau' },
      { scheme: 'file', pattern: '**/*.lua' },
      { scheme: 'file', pattern: '**/*.luau' }
    ];

    const triggerChars = ':abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    disposables.push(
      vscode.languages.registerCompletionItemProvider(luaSelector, completionProvider, ...triggerChars)
    );

    // Watch for config changes
    disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('robloxSuperRequire')) {
          completionProvider?.updateConfig(loadConfiguration());
          logger.info('Configuration updated');
        }
      })
    );

    // Watch for sourcemap.json changes
    const sourcemapWatcher = vscode.workspace.createFileSystemWatcher('**/sourcemap.json');
    const handleSourcemapChange = async () => {
      pathResolver?.reloadSourcemaps();
      pathResolver?.clearCache();
      await moduleIndexer?.rebuildIndex();
      completionProvider?.updateFuseIndex();
    };
    disposables.push(sourcemapWatcher);
    disposables.push(sourcemapWatcher.onDidChange(handleSourcemapChange));
    disposables.push(sourcemapWatcher.onDidCreate(handleSourcemapChange));
    disposables.push(sourcemapWatcher.onDidDelete(handleSourcemapChange));

    // Watch for default.project.json changes
    const rojoWatcher = vscode.workspace.createFileSystemWatcher('**/default.project.json');
    const handleRojoChange = async () => {
      pathResolver?.reloadRojoProjects();
      pathResolver?.clearCache();
      await moduleIndexer?.rebuildIndex();
      completionProvider?.updateFuseIndex();
    };
    disposables.push(rojoWatcher);
    disposables.push(rojoWatcher.onDidChange(handleRojoChange));
    disposables.push(rojoWatcher.onDidCreate(handleRojoChange));
    disposables.push(rojoWatcher.onDidDelete(handleRojoChange));

    // Register reindex command
    disposables.push(
      vscode.commands.registerCommand('robloxSuperRequire.reindex', async () => {
        await moduleIndexer?.rebuildIndex();
        completionProvider?.updateFuseIndex();
        vscode.window.showInformationMessage(`Indexed ${moduleIndexer?.getModuleCount() || 0} modules`);
      })
    );

    context.subscriptions.push(...disposables);
    logger.info(`Activated with ${moduleIndexer?.getModuleCount() || 0} modules`);

  } catch (error) {
    logger.error('Activation failed', error);
    vscode.window.showErrorMessage(`Roblox Super Require failed: ${error}`);
  }
}

function loadConfiguration(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('robloxSuperRequire');
  return {
    enabled: config.get<boolean>('enabled', true),
    maxSuggestions: config.get<number>('maxSuggestions', 15),
    fuzzyMatchStrength: config.get<'strict' | 'normal' | 'loose'>('fuzzyMatchStrength', 'normal'),
    pathStyle: config.get<'auto' | 'absolute' | 'relative'>('pathStyle', 'auto'),
    excludePatterns: config.get<string[]>('excludePatterns', ['**/node_modules/**', '**/.git/**']),
    useGetService: config.get<boolean>('useGetService', false),
    debugMode: config.get<boolean>('debugMode', false),
  };
}

export function deactivate() {
  moduleIndexer?.dispose();
  pathResolver?.dispose();
  disposables.forEach(d => d.dispose());
  disposables = [];
  moduleIndexer = undefined;
  pathResolver = undefined;
  completionProvider = undefined;
  logger.dispose();
}
