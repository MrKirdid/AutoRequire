import * as vscode from 'vscode';
import { ModuleIndexer } from './moduleIndexer';
import { ModuleInfo, ExtensionConfig, DefinedVariable } from './types';
import { fuzzyMatch, rankMatches, FuzzyMatchOptions } from './fuzzyMatcher';

/**
 * Provides autocomplete suggestions for require statements
 */
export class RequireCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private moduleIndexer: ModuleIndexer,
    private config: ExtensionConfig
  ) {}

  public updateFuseIndex(): void {}

  /**
   * Extract defined service variables from the document
   */
  private extractDefinedServices(document: vscode.TextDocument): Map<string, string> {
    const services = new Map<string, string>();
    const text = document.getText();
    
    // Match: local X = game:GetService("Service") or local X = game.Service
    const getServicePattern = /local\s+(\w+)\s*=\s*game:GetService\s*\(\s*["'](\w+)["']\s*\)/g;
    const dotAccessPattern = /local\s+(\w+)\s*=\s*game\.(\w+)\s*(?:$|[\r\n;])/gm;
    
    let match;
    while ((match = getServicePattern.exec(text)) !== null) {
      services.set(match[2], match[1]);
    }
    while ((match = dotAccessPattern.exec(text)) !== null) {
      if (/^[A-Z]/.test(match[2])) {
        services.set(match[2], match[1]);
      }
    }
    return services;
  }

  /**
   * Extract all defined instance variables
   */
  private extractDefinedVariables(document: vscode.TextDocument): DefinedVariable[] {
    const variables: DefinedVariable[] = [];
    const text = document.getText();
    const serviceVars = new Map<string, { varName: string; instancePath: string; lineIndex: number }>();
    
    // Match game:GetService patterns
    const getServicePattern = /local\s+(\w+)\s*=\s*game:GetService\s*\(\s*["'](\w+)["']\s*\)/g;
    let match;
    while ((match = getServicePattern.exec(text)) !== null) {
      const [, varName, serviceName] = match;
      const lineIndex = text.substring(0, match.index).split('\n').length - 1;
      const instancePath = `game.${serviceName}`;
      serviceVars.set(varName, { varName, instancePath, lineIndex });
      variables.push({ varName, instancePath, depth: 2, lineIndex });
    }
    
    // Match game.Service patterns
    const dotAccessPattern = /local\s+(\w+)\s*=\s*game\.(\w+)\s*(?:$|[\r\n;])/gm;
    while ((match = dotAccessPattern.exec(text)) !== null) {
      const [, varName, serviceName] = match;
      if (/^[A-Z]/.test(serviceName) && !serviceVars.has(varName)) {
        const lineIndex = text.substring(0, match.index).split('\n').length - 1;
        const instancePath = `game.${serviceName}`;
        serviceVars.set(varName, { varName, instancePath, lineIndex });
        variables.push({ varName, instancePath, depth: 2, lineIndex });
      }
    }
    
    // Match nested paths: local X = OtherVar.Path.To.Thing
    const varRefPattern = /local\s+(\w+)\s*=\s*(\w+)((?:\.\w+|\["[^"]+"\])+)/g;
    while ((match = varRefPattern.exec(text)) !== null) {
      const [, newVarName, baseVarName, pathPart] = match;
      const baseVar = serviceVars.get(baseVarName);
      if (baseVar) {
        const lineIndex = text.substring(0, match.index).split('\n').length - 1;
        let additionalPath = '';
        const dotMatches = pathPart.matchAll(/\.(\w+)/g);
        for (const dm of dotMatches) additionalPath += `.${dm[1]}`;
        const bracketMatches = pathPart.matchAll(/\[["']([^"']+)["']\]/g);
        for (const bm of bracketMatches) {
          additionalPath += /^[a-zA-Z_]\w*$/.test(bm[1]) ? `.${bm[1]}` : `["${bm[1]}"]`;
        }
        if (additionalPath) {
          const instancePath = baseVar.instancePath + additionalPath;
          const depth = instancePath.split(/\.|\[/).length;
          serviceVars.set(newVarName, { varName: newVarName, instancePath, lineIndex });
          variables.push({ varName: newVarName, instancePath, depth, lineIndex });
        }
      }
    }
    
    variables.sort((a, b) => b.depth - a.depth);
    return variables;
  }

  /**
   * Get current script's instance path
   */
  private getCurrentScriptPath(document: vscode.TextDocument): string | null {
    const currentModule = this.moduleIndexer.getModules().find(m => m.fsPath === document.uri.fsPath);
    return currentModule?.instancePath || null;
  }

  /**
   * Try to generate a relative path (script.Parent based)
   */
  private getRelativePath(currentPath: string, targetPath: string): string | null {
    if (this.config.pathStyle === 'absolute') return null;
    
    const currentParts = currentPath.split('.');
    const targetParts = targetPath.split('.');
    
    if (currentParts[0] !== 'game' || targetParts[0] !== 'game') return null;
    
    let commonLength = 0;
    for (let i = 0; i < Math.min(currentParts.length, targetParts.length); i++) {
      if (currentParts[i] === targetParts[i]) commonLength = i + 1;
      else break;
    }
    
    if (commonLength < 2) return null;
    
    const parentsNeeded = currentParts.length - commonLength;
    const childrenNeeded = targetParts.slice(commonLength);
    
    if (parentsNeeded > 3) return null; // Max 3 parents
    
    let relativePath = 'script';
    for (let i = 0; i < parentsNeeded; i++) relativePath += '.Parent';
    for (const child of childrenNeeded) {
      relativePath += /^[a-zA-Z_]\w*$/.test(child) ? `.${child}` : `["${child}"]`;
    }
    
    return relativePath;
  }

  /**
   * Find deepest matching variable for path
   */
  private findDeepestMatchingVariable(instancePath: string, definedVariables: DefinedVariable[]): { varName: string; remainingPath: string } | null {
    const normalizedTarget = instancePath.toLowerCase();
    
    for (const variable of definedVariables) {
      const normalizedVarPath = variable.instancePath.toLowerCase();
      if (normalizedTarget.startsWith(normalizedVarPath)) {
        const remaining = instancePath.substring(variable.instancePath.length);
        if (remaining === '' || remaining.startsWith('.') || remaining.startsWith('[')) {
          return { varName: variable.varName, remainingPath: remaining };
        }
      }
    }
    return null;
  }

  /**
   * Build the best require path
   */
  private buildRequirePath(
    moduleInfo: ModuleInfo,
    definedServices: Map<string, string>,
    definedVariables: DefinedVariable[],
    currentScriptPath: string | null
  ): string {
    const instancePath = moduleInfo.instancePath;
    
    // Try deepest matching variable first
    const deepMatch = this.findDeepestMatchingVariable(instancePath, definedVariables);
    if (deepMatch) {
      return deepMatch.varName + deepMatch.remainingPath;
    }
    
    // Try relative path
    if (currentScriptPath && this.config.pathStyle !== 'absolute') {
      const relativePath = this.getRelativePath(currentScriptPath, instancePath);
      if (relativePath) return relativePath;
    }
    
    // Try service variable
    const match = instancePath.match(/^game\.(\w+)(\..*)?$/);
    if (match) {
      const varName = definedServices.get(match[1]);
      if (varName) return varName + (match[2] || '');
    }
    
    // Use GetService if configured
    if (this.config.useGetService && match) {
      return `game:GetService("${match[1]}")${match[2] || ''}`;
    }
    
    return instancePath;
  }

  /**
   * Provide completion items
   */
  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    if (token.isCancellationRequested || !this.config.enabled) return undefined;

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // Check for trigger pattern: whitespace + : + optional search query
    const match = /^(\s*):(.*)$/.exec(textBeforeCursor);
    if (!match) return undefined;

    const [fullMatch, leadingWhitespace, searchQuery] = match;
    
    const definedServices = this.extractDefinedServices(document);
    const definedVariables = this.extractDefinedVariables(document);
    const currentScriptPath = this.getCurrentScriptPath(document);

    const results = this.searchModules(searchQuery);
    if (results.length === 0) return undefined;

    const completionItems = results.map((moduleInfo, index) => 
      this.createCompletionItem(moduleInfo, position, leadingWhitespace, textBeforeCursor, index, definedServices, definedVariables, currentScriptPath)
    );
    
    return new vscode.CompletionList(completionItems, true);
  }

  /**
   * Search modules with fuzzy matching
   */
  private searchModules(query: string): ModuleInfo[] {
    const allModules = this.moduleIndexer.getModules();
    
    if (!query || query.trim() === '') {
      return allModules.slice(0, this.config.maxSuggestions);
    }

    const queryLower = query.toLowerCase();
    
    // Fast path: exact, prefix, substring matches
    const exactMatches: ModuleInfo[] = [];
    const prefixMatches: ModuleInfo[] = [];
    const substringMatches: ModuleInfo[] = [];
    
    for (const module of allModules) {
      const nameLower = module.name.toLowerCase();
      if (nameLower === queryLower) exactMatches.push(module);
      else if (nameLower.startsWith(queryLower)) prefixMatches.push(module);
      else if (nameLower.includes(queryLower)) substringMatches.push(module);
    }
    
    if (exactMatches.length > 0) return exactMatches.slice(0, this.config.maxSuggestions);
    if (prefixMatches.length > 0) {
      prefixMatches.sort((a, b) => a.name.length - b.name.length);
      return prefixMatches.slice(0, this.config.maxSuggestions);
    }
    if (substringMatches.length > 0) {
      substringMatches.sort((a, b) => a.name.length - b.name.length);
      return substringMatches.slice(0, this.config.maxSuggestions);
    }
    
    // Fuzzy matching based on strength setting
    const minScore = this.config.fuzzyMatchStrength === 'strict' ? 0.5 
      : this.config.fuzzyMatchStrength === 'loose' ? 0.2 : 0.35;
    
    const fuzzyOptions: Partial<FuzzyMatchOptions> = {
      minScore,
      allowVeryFuzzy: this.config.fuzzyMatchStrength === 'loose',
    };
    
    const rankedResults = rankMatches(query, allModules, (m) => [m.name, m.relativePath], fuzzyOptions);
    
    return rankedResults
      .filter(r => r.score >= minScore)
      .map(r => r.item)
      .slice(0, this.config.maxSuggestions);
  }

  /**
   * Get icon for module
   */
  private getModuleIcon(moduleInfo: ModuleInfo): vscode.CompletionItemKind {
    const nameLower = moduleInfo.name.toLowerCase();
    const pathLower = moduleInfo.instancePath.toLowerCase();
    
    if (moduleInfo.isWallyPackage) return vscode.CompletionItemKind.Reference;
    if (nameLower.includes('service')) return vscode.CompletionItemKind.Interface;
    if (nameLower.includes('controller')) return vscode.CompletionItemKind.Class;
    if (nameLower.includes('component')) return vscode.CompletionItemKind.Struct;
    if (nameLower.includes('util') || nameLower.includes('helper')) return vscode.CompletionItemKind.Function;
    if (pathLower.includes('serverscriptservice') || pathLower.includes('serverstorage')) return vscode.CompletionItemKind.Event;
    if (pathLower.includes('starterplayerscripts') || pathLower.includes('startergui')) return vscode.CompletionItemKind.User;
    if (pathLower.includes('replicatedstorage')) return vscode.CompletionItemKind.Constant;
    return vscode.CompletionItemKind.Module;
  }

  /**
   * Get module type tag
   */
  private getModuleTag(moduleInfo: ModuleInfo): string {
    const nameLower = moduleInfo.name.toLowerCase();
    const pathLower = moduleInfo.instancePath.toLowerCase();
    
    if (moduleInfo.isWallyPackage) return 'Wally';
    if (nameLower.includes('service')) return 'Service';
    if (nameLower.includes('controller')) return 'Controller';
    if (nameLower.includes('component')) return 'Component';
    if (nameLower.includes('util') || nameLower.includes('helper')) return 'Utility';
    if (pathLower.includes('serverscriptservice') || pathLower.includes('serverstorage')) return 'Server';
    if (pathLower.includes('starterplayerscripts') || pathLower.includes('startergui')) return 'Client';
    if (pathLower.includes('replicatedstorage')) return 'Shared';
    return 'Module';
  }

  /**
   * Create a completion item
   */
  private createCompletionItem(
    moduleInfo: ModuleInfo,
    position: vscode.Position,
    leadingWhitespace: string,
    textBeforeCursor: string,
    sortIndex: number,
    definedServices: Map<string, string>,
    definedVariables: DefinedVariable[],
    currentScriptPath: string | null
  ): vscode.CompletionItem {
    let varName = moduleInfo.name
      .replace(/\.(luau|lua|server|client)$/gi, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^[0-9]/, '_$&');
    
    if (moduleInfo.isWallyPackage && varName.length > 0) {
      varName = varName.charAt(0).toUpperCase() + varName.slice(1);
    }
    
    const requirePath = this.buildRequirePath(moduleInfo, definedServices, definedVariables, currentScriptPath);
    const requireStatement = `local ${varName} = require(${requirePath})`;

    const item = new vscode.CompletionItem(moduleInfo.name, this.getModuleIcon(moduleInfo));
    item.insertText = requireStatement;
    item.detail = `${this.getModuleTag(moduleInfo)} • ${requirePath}`;
    
    const doc = new vscode.MarkdownString();
    doc.appendMarkdown(`**${moduleInfo.name}**\n\n`);
    doc.appendMarkdown(`**Path:** \`${moduleInfo.instancePath}\`\n\n`);
    doc.appendCodeblock(requireStatement, 'lua');
    item.documentation = doc;
    
    item.range = new vscode.Range(new vscode.Position(position.line, leadingWhitespace.length), position);
    item.sortText = String(sortIndex).padStart(5, '0');
    item.filterText = textBeforeCursor;
    if (sortIndex === 0) item.preselect = true;

    return item;
  }

  public updateConfig(config: ExtensionConfig): void {
    this.config = config;
  }
}
