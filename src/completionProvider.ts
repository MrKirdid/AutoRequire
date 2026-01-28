import * as vscode from 'vscode';
import Fuse from 'fuse.js';
import { ModuleIndexer } from './moduleIndexer';
import { ModuleInfo, ExtensionConfig } from './types';

/**
 * Provides autocomplete suggestions for require statements
 */
export class RequireCompletionProvider implements vscode.CompletionItemProvider {
  private fuse: Fuse<ModuleInfo> | null = null;

  constructor(
    private moduleIndexer: ModuleIndexer,
    private config: ExtensionConfig
  ) {
    this.updateFuseIndex();
  }

  /**
   * Update the Fuse.js search index
   */
  public updateFuseIndex(): void {
    const modules = this.moduleIndexer.getModules();
    
    this.fuse = new Fuse(modules, {
      keys: [
        { name: 'name', weight: 2 },      // Prioritize module name
        { name: 'relativePath', weight: 1 } // Secondary: search in path
      ],
      threshold: this.config.fuzzyThreshold,
      includeScore: true,
      minMatchCharLength: 1,
      ignoreLocation: true, // Allow matches anywhere in the string
    });

    console.log(`[Super Require] Fuse index updated with ${modules.length} modules`);
  }

  /**
   * Provide completion items
   */
  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    // Check if extension is enabled
    if (!this.config.enabled) {
      return undefined;
    }

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // Check if we're at the start of a line with ':'
    // Pattern: optional whitespace, then ':', then optional characters (search query)
    const match = /^(\s*):([\w]*)$/.exec(textBeforeCursor);
    
    if (!match) {
      return undefined;
    }

    const [fullMatch, leadingWhitespace, searchQuery] = match;

    // Perform fuzzy search
    const results = this.searchModules(searchQuery);

    if (results.length === 0) {
      return undefined;
    }

    // Convert to completion items
    const completionItems = results.map(moduleInfo => 
      this.createCompletionItem(moduleInfo, document, position, leadingWhitespace, fullMatch)
    );

    return new vscode.CompletionList(completionItems, false);
  }

  /**
   * Search for modules using fuzzy search
   */
  private searchModules(query: string): ModuleInfo[] {
    if (!this.fuse) {
      return [];
    }

    // If query is empty, return all modules (limited by maxSuggestions)
    if (!query || query.trim() === '') {
      return this.moduleIndexer.getModules().slice(0, this.config.maxSuggestions);
    }

    // Perform fuzzy search
    const results = this.fuse.search(query);

    // Extract items and limit results
    return results
      .map(result => result.item)
      .slice(0, this.config.maxSuggestions);
  }

  /**
   * Create a completion item for a module
   */
  private createCompletionItem(
    moduleInfo: ModuleInfo,
    document: vscode.TextDocument,
    position: vscode.Position,
    leadingWhitespace: string,
    fullMatch: string
  ): vscode.CompletionItem {
    const requireStatement = `local ${moduleInfo.name} = require(${moduleInfo.instancePath})`;

    const item = new vscode.CompletionItem(
      moduleInfo.name,
      vscode.CompletionItemKind.Module
    );

    // Set the text that will be inserted
    item.insertText = requireStatement;

    // Show the instance path as detail
    item.detail = moduleInfo.instancePath;

    // Show relative path in documentation
    item.documentation = new vscode.MarkdownString(
      `**Path:** \`${moduleInfo.relativePath}\`\n\n` +
      `**Require:** \`${requireStatement}\``
    );

    // Set the range to replace (removes the ':' and search query)
    const startPos = new vscode.Position(position.line, leadingWhitespace.length);
    const endPos = position;
    item.range = new vscode.Range(startPos, endPos);

    // Higher sort text = lower priority
    // We want exact matches to appear first
    item.sortText = moduleInfo.name;

    // Filter text for better matching
    item.filterText = `:${moduleInfo.name}`;

    return item;
  }

  /**
   * Update configuration
   */
  public updateConfig(config: ExtensionConfig): void {
    this.config = config;
    this.updateFuseIndex();
  }
}