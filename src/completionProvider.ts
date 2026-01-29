import * as vscode from 'vscode';
import * as path from 'path';
import Fuse from 'fuse.js';
import { ModuleIndexer } from './moduleIndexer';
import { ModuleInfo, ExtensionConfig, ModuleType } from './types';

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
   * Extract already-defined service/require variables from the document
   * Returns a map of service name (e.g., "ReplicatedStorage") to variable name (e.g., "ReplicatedStorage" or "RS")
   */
  private extractDefinedServices(document: vscode.TextDocument): Map<string, string> {
    const services = new Map<string, string>();
    const text = document.getText();
    
    // Match patterns like:
    // local ReplicatedStorage = game:GetService("ReplicatedStorage")
    // local RS = game:GetService("ReplicatedStorage")
    // local ReplicatedStorage = game.ReplicatedStorage
    // local RS = game.ReplicatedStorage
    const getServicePattern = /local\s+(\w+)\s*=\s*game:GetService\s*\(\s*["'](\w+)["']\s*\)/g;
    const dotAccessPattern = /local\s+(\w+)\s*=\s*game\.(\w+)\s*(?:$|[\r\n;])/gm;
    
    let match;
    while ((match = getServicePattern.exec(text)) !== null) {
      const [, varName, serviceName] = match;
      services.set(serviceName, varName);
    }
    
    while ((match = dotAccessPattern.exec(text)) !== null) {
      const [, varName, serviceName] = match;
      // Only add if it looks like a service (PascalCase)
      if (/^[A-Z]/.test(serviceName)) {
        services.set(serviceName, varName);
      }
    }
    
    return services;
  }

  /**
   * Get the current script's instance path based on the document's file path
   */
  private getCurrentScriptPath(document: vscode.TextDocument): string | null {
    const currentModule = this.moduleIndexer.getModules().find(
      m => m.fsPath === document.uri.fsPath
    );
    return currentModule?.instancePath || null;
  }

  /**
   * Try to generate a relative path (script.Parent, script.Child, etc.)
   * Returns null if no relative path is applicable
   */
  private getRelativePath(currentPath: string, targetPath: string): string | null {
    // Parse instance paths like "game.ReplicatedStorage.Modules.CraftingModule"
    const currentParts = currentPath.split('.');
    const targetParts = targetPath.split('.');
    
    // Both should start with "game"
    if (currentParts[0] !== 'game' || targetParts[0] !== 'game') {
      return null;
    }
    
    // Find common prefix
    let commonLength = 0;
    for (let i = 0; i < Math.min(currentParts.length, targetParts.length); i++) {
      if (currentParts[i] === targetParts[i]) {
        commonLength = i + 1;
      } else {
        break;
      }
    }
    
    // Need at least "game.ServiceName" in common (2 parts)
    if (commonLength < 2) {
      return null;
    }
    
    // Calculate how many .Parent we need to go up from current
    const parentsNeeded = currentParts.length - commonLength;
    
    // Calculate what children we need to access from there
    const childrenNeeded = targetParts.slice(commonLength);
    
    // Build the relative path
    let relativePath = 'script';
    
    // Add .Parent for each level we need to go up
    for (let i = 0; i < parentsNeeded; i++) {
      relativePath += '.Parent';
    }
    
    // Add children
    for (const child of childrenNeeded) {
      // Handle bracket notation if needed
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(child)) {
        relativePath += `.${child}`;
      } else {
        relativePath += `["${child}"]`;
      }
    }
    
    // Only return relative path if it's actually shorter or makes sense
    // (e.g., don't return script.Parent.Parent.Parent.Parent.Parent...)
    if (parentsNeeded > 3) {
      return null; // Too many parents, use absolute path
    }
    
    // If the target is a direct child of current script, use script.ChildName
    if (parentsNeeded === 0 && childrenNeeded.length > 0) {
      return relativePath;
    }
    
    // If target is sibling (same parent) or nearby, use relative
    if (parentsNeeded <= 2) {
      return relativePath;
    }
    
    return null;
  }

  /**
   * Replace service references in path with defined variable names
   */
  private replaceServicesWithVariables(instancePath: string, definedServices: Map<string, string>): string {
    // Parse the path: game.ServiceName.Rest.Of.Path
    const match = instancePath.match(/^game\.(\w+)(\..*)?$/);
    if (!match) {
      return instancePath;
    }
    
    const [, serviceName, restOfPath] = match;
    
    // Check if this service is already defined
    const varName = definedServices.get(serviceName);
    if (varName) {
      return varName + (restOfPath || '');
    }
    
    return instancePath;
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
    // Check if request was cancelled
    if (token.isCancellationRequested) {
      return undefined;
    }

    // Check if extension is enabled
    if (!this.config.enabled) {
      return undefined;
    }

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // Check if we're at the start of a line with the trigger character
    // Pattern: optional whitespace, then trigger char, then optional characters (search query)
    const triggerChar = this.config.triggerCharacter || ':';
    const escapedTrigger = triggerChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^(\\s*)${escapedTrigger}(.*)$`);
    const match = pattern.exec(textBeforeCursor);
    
    if (!match) {
      return undefined;
    }

    // Check cancellation again before searching
    if (token.isCancellationRequested) {
      return undefined;
    }

    const [fullMatch, leadingWhitespace, searchQuery] = match;

    // Extract already-defined services from the document
    const definedServices = this.extractDefinedServices(document);
    
    // Get current script's path for relative path calculation
    const currentScriptPath = this.getCurrentScriptPath(document);

    // Perform fuzzy search
    const results = this.searchModules(searchQuery);

    if (results.length === 0 || token.isCancellationRequested) {
      return undefined;
    }

    // Convert to completion items with proper sort index
    const completionItems = results.map((moduleInfo, index) => 
      this.createCompletionItem(moduleInfo, document, position, leadingWhitespace, fullMatch, textBeforeCursor, index, definedServices, currentScriptPath)
    );
    
    // Mark as incomplete so VS Code re-queries as user types (enables fuzzy search)
    return new vscode.CompletionList(completionItems, true);
  }

  /**
   * Search for modules using fuzzy search
   */
  private searchModules(query: string): ModuleInfo[] {
    let allModules = this.moduleIndexer.getModules();
    
    // If preferWallyPackages is enabled, sort Wally packages first
    if (this.config.preferWallyPackages) {
      allModules = [...allModules].sort((a, b) => {
        if (a.isWallyPackage && !b.isWallyPackage) return -1;
        if (!a.isWallyPackage && b.isWallyPackage) return 1;
        return 0;
      });
    }
    
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
      
      // If preferWallyPackages, keep that priority
      if (this.config.preferWallyPackages) {
        if (a.isWallyPackage && !b.isWallyPackage) return -1;
        if (!a.isWallyPackage && b.isWallyPackage) return 1;
      }
      
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
   * Get the appropriate VS Code icon for a module based on its type and path
   */
  private getModuleIcon(moduleInfo: ModuleInfo): vscode.CompletionItemKind {
    if (!this.config.showModuleIcons) {
      return vscode.CompletionItemKind.Module;
    }

    const nameLower = moduleInfo.name.toLowerCase();
    const pathLower = moduleInfo.instancePath.toLowerCase();
    
    // Wally packages get a special package icon
    if (moduleInfo.isWallyPackage) {
      return vscode.CompletionItemKind.Reference; // Package-like appearance
    }
    
    // Service modules (including Units)
    if (nameLower.endsWith('service') || nameLower.includes('service') || 
        pathLower.includes('units') || pathLower.includes('/units/')) {
      return vscode.CompletionItemKind.Interface; // Service icon
    }
    
    // Controller modules (including Units)
    if (nameLower.endsWith('controller') || nameLower.includes('controller')) {
      return vscode.CompletionItemKind.Class; // Controller icon
    }
    
    // Component modules
    if (nameLower.endsWith('component') || nameLower.includes('component')) {
      return vscode.CompletionItemKind.Struct; // Component icon
    }
    
    // Utility modules
    if (nameLower.includes('util') || nameLower.includes('helper') || nameLower.includes('lib')) {
      return vscode.CompletionItemKind.Function; // Utility icon
    }
    
    // Server modules
    if (pathLower.includes('serverscriptservice') || pathLower.includes('serverstorage')) {
      return vscode.CompletionItemKind.Event; // Server icon (orange)
    }
    
    // Client modules
    if (pathLower.includes('starterplayerscripts') || pathLower.includes('startergui') || 
        pathLower.includes('replicatedfirst')) {
      return vscode.CompletionItemKind.User; // Client icon (blue person)
    }
    
    // Shared modules (ReplicatedStorage)
    if (pathLower.includes('replicatedstorage')) {
      return vscode.CompletionItemKind.Constant; // Shared icon
    }
    
    // Types/Interfaces
    if (nameLower.endsWith('types') || nameLower.endsWith('type') || nameLower.startsWith('types')) {
      return vscode.CompletionItemKind.TypeParameter;
    }
    
    // Config modules
    if (nameLower.includes('config') || nameLower.includes('settings') || nameLower.includes('constants')) {
      return vscode.CompletionItemKind.Value;
    }
    
    // Default module icon
    return vscode.CompletionItemKind.Module;
  }

  /**
   * Get a descriptive label/tag for the module type
   */
  private getModuleTag(moduleInfo: ModuleInfo): string {
    const nameLower = moduleInfo.name.toLowerCase();
    const pathLower = moduleInfo.instancePath.toLowerCase();
    
    if (moduleInfo.isWallyPackage) return 'Wally Package';
    
    // Check for Units folder (used for services/controllers)
    if (pathLower.includes('.units.') || pathLower.includes('/units/')) {
      // Determine if it's a server or client unit
      if (pathLower.includes('serverscriptservice') || pathLower.includes('serverstorage')) {
        return 'Unit (Server)';
      } else if (pathLower.includes('starterplayerscripts') || pathLower.includes('startergui')) {
        return 'Unit (Client)';
      }
      return 'Unit';
    }
    
    if (nameLower.endsWith('service') || nameLower.includes('service')) return 'Service';
    if (nameLower.endsWith('controller') || nameLower.includes('controller')) return 'Controller';
    if (nameLower.endsWith('component') || nameLower.includes('component')) return 'Component';
    if (nameLower.includes('util') || nameLower.includes('helper')) return 'Utility';
    if (pathLower.includes('serverscriptservice') || pathLower.includes('serverstorage')) return 'Server';
    if (pathLower.includes('starterplayerscripts') || pathLower.includes('startergui')) return 'Client';
    if (pathLower.includes('replicatedstorage')) return 'Shared';
    if (nameLower.includes('types')) return 'Types';
    if (nameLower.includes('config')) return 'Config';
    
    return 'Module';
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
    textBeforeCursor: string,
    sortIndex: number,
    definedServices: Map<string, string>,
    currentScriptPath: string | null
  ): vscode.CompletionItem {
    // Sanitize name - remove any remaining extensions and make it a valid Lua identifier
    let varName = moduleInfo.name
      .replace(/\.(luau|lua|server|client)$/gi, '') // Remove extensions
      .replace(/[^a-zA-Z0-9_]/g, '_') // Replace invalid chars with underscore
      .replace(/^[0-9]/, '_$&'); // Prefix with _ if starts with number
    
    // Capitalize first letter for Wally packages
    if (moduleInfo.isWallyPackage && varName.length > 0) {
      varName = varName.charAt(0).toUpperCase() + varName.slice(1);
    }
    
    // Determine the best path to use for require
    let requirePath = moduleInfo.instancePath;
    let pathNote = '';
    
    // First, try to use a relative path if applicable
    if (currentScriptPath) {
      const relativePath = this.getRelativePath(currentScriptPath, moduleInfo.instancePath);
      if (relativePath) {
        requirePath = relativePath;
        pathNote = ' (relative)';
      }
    }
    
    // If not using relative path, try to use defined service variables
    if (!pathNote) {
      const pathWithService = this.replaceServicesWithVariables(moduleInfo.instancePath, definedServices);
      if (pathWithService !== moduleInfo.instancePath) {
        requirePath = pathWithService;
        pathNote = ' (using defined var)';
      }
    }
    
    const requireStatement = `local ${varName} = require(${requirePath})`;

    // Get appropriate icon based on module type
    const itemKind = this.getModuleIcon(moduleInfo);
    const moduleTag = this.getModuleTag(moduleInfo);

    const item = new vscode.CompletionItem(
      moduleInfo.name,
      itemKind
    );

    // Set the text that will be inserted
    if (this.config.autoInsertRequire) {
      item.insertText = requireStatement;
    } else {
      item.insertText = `require(${requirePath})`;
    }

    // Show the instance path and module tag as detail
    if (this.config.showPathInDetail) {
      item.detail = `${moduleTag}  •  ${requirePath}${pathNote}`;
    } else {
      item.detail = moduleTag;
    }

    // Build rich documentation
    const docParts: string[] = [];
    docParts.push(`### ${moduleInfo.name}`);
    docParts.push('');
    docParts.push(`**Type:** ${moduleTag}`);
    docParts.push('');
    if (pathNote) {
      docParts.push(`**Using:** ${pathNote.trim().replace(/[()]/g, '')}`);
      docParts.push('');
    }
    docParts.push(`**Instance Path:**`);
    docParts.push(`\`${moduleInfo.instancePath}\``);
    docParts.push('');
    docParts.push(`**Require Path:**`);
    docParts.push(`\`${requirePath}\``);
    docParts.push('');
    docParts.push(`**File Path:**`);
    docParts.push(`\`${moduleInfo.relativePath}\``);
    docParts.push('');
    docParts.push('**Generated Require:**');
    docParts.push('```lua');
    docParts.push(requireStatement);
    docParts.push('```');

    item.documentation = new vscode.MarkdownString(docParts.join('\n'));
    item.documentation.isTrusted = true;

    // Set the range to replace (removes the trigger char and search query)
    const startPos = new vscode.Position(position.line, leadingWhitespace.length);
    const endPos = position;
    item.range = new vscode.Range(startPos, endPos);

    // Use zero-padded index for consistent sort order (preserves our ranking)
    item.sortText = String(sortIndex).padStart(5, '0');

    // Use the full text before cursor as filter text to prevent VS Code from re-filtering our fuzzy results
    item.filterText = textBeforeCursor;

    // Add a preselect for the first item
    if (sortIndex === 0) {
      item.preselect = true;
    }

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