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
        { name: 'name', weight: 3 },      // Prioritize module name heavily
        { name: 'relativePath', weight: 1 } // Secondary: search in path
      ],
      threshold: 0.6, // Higher = more fuzzy (0.6 is quite lenient)
      includeScore: true,
      minMatchCharLength: 1,
      ignoreLocation: true, // Allow matches anywhere in the string
      useExtendedSearch: false,
      findAllMatches: true, // Don't stop at first match
      shouldSort: true,
    });
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
    const match = /^(\s*):(.*)$/.exec(textBeforeCursor);
    
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
      this.createCompletionItem(moduleInfo, document, position, leadingWhitespace, fullMatch, textBeforeCursor)
    );
    
    // Mark as incomplete so VS Code re-queries as user types (enables fuzzy search)
    return new vscode.CompletionList(completionItems, true);
  }

  /**
   * Search for modules using fuzzy search
   */
  private searchModules(query: string): ModuleInfo[] {
    const allModules = this.moduleIndexer.getModules();
    
    // If query is empty, return all modules (limited by maxSuggestions)
    if (!query || query.trim() === '') {
      return allModules.slice(0, this.config.maxSuggestions);
    }

    const queryLower = query.toLowerCase();
    
    // First, try simple substring matching (often better than fuzzy for code)
    const substringMatches = allModules.filter(m => 
      m.name.toLowerCase().includes(queryLower) ||
      m.relativePath.toLowerCase().includes(queryLower)
    );
    
    // Sort substring matches: exact start match first, then by name length
    substringMatches.sort((a, b) => {
      const aStartsWith = a.name.toLowerCase().startsWith(queryLower);
      const bStartsWith = b.name.toLowerCase().startsWith(queryLower);
      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;
      return a.name.length - b.name.length;
    });
    
    if (substringMatches.length > 0) {
      return substringMatches.slice(0, this.config.maxSuggestions);
    }
    
    // Fall back to fuzzy search if no substring matches
    if (!this.fuse) {
      return [];
    }

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
    fullMatch: string,
    textBeforeCursor: string
  ): vscode.CompletionItem {
    // Sanitize name - remove any remaining extensions and make it a valid Lua identifier
    let varName = moduleInfo.name
      .replace(/\.(luau|lua|server|client)$/gi, '') // Remove extensions
      .replace(/[^a-zA-Z0-9_]/g, '_') // Replace invalid chars with underscore
      .replace(/^[0-9]/, '_$&'); // Prefix with _ if starts with number
    
    const requireStatement = `local ${varName} = require(${moduleInfo.instancePath})`;

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

    // Use the full text before cursor as filter text to prevent VS Code from re-filtering our fuzzy results
    item.filterText = textBeforeCursor;

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