/**
 * Type definitions for the Roblox Super Require extension
 */

/**
 * Module types for better icon categorization
 */
export enum ModuleType {
  /** Standard module script */
  Module = 'module',
  /** Wally package */
  WallyPackage = 'wally',
  /** Shared module (ReplicatedStorage) */
  Shared = 'shared',
  /** Server module (ServerScriptService/ServerStorage) */
  Server = 'server',
  /** Client module (StarterPlayerScripts, etc.) */
  Client = 'client',
  /** Utility/Helper module */
  Utility = 'utility',
  /** Service-like module */
  Service = 'service',
  /** Controller module */
  Controller = 'controller',
  /** Component module */
  Component = 'component',
}

/**
 * Represents a cached module in the workspace
 */
export interface ModuleInfo {
  /** The module's display name (without extension) */
  name: string;
  
  /** Absolute file system path to the module */
  fsPath: string;
  
  /** Roblox Instance path (e.g., "game.ReplicatedStorage.Packages.Janitor") */
  instancePath: string;
  
  /** Relative path from workspace root */
  relativePath: string;
  
  /** Whether this is a Wally package (for capitalization) */
  isWallyPackage?: boolean;

  /** The type/category of this module for icon display */
  moduleType?: ModuleType;
}

/**
 * Rojo sourcemap structure (simplified)
 */
export interface SourcemapNode {
  /** Class name (e.g., "ModuleScript", "Folder") */
  className?: string;
  
  /** Name of the instance */
  name: string;
  
  /** File paths associated with this node */
  filePaths?: string[];
  
  /** Child nodes */
  children?: SourcemapNode[];
}

/**
 * Root sourcemap structure
 */
export interface Sourcemap {
  /** Project name */
  name: string;
  
  /** Root class name (usually "DataModel") */
  className: string;
  
  /** File paths for the root */
  filePaths?: string[];
  
  /** Child nodes (services) */
  children?: SourcemapNode[];
}

/**
 * Rojo project tree node (from default.project.json)
 */
export interface RojoTreeNode {
  /** Class name for the instance */
  $className?: string;
  
  /** File system path mapping */
  $path?: string;
  
  /** Other properties for nested children */
  [key: string]: RojoTreeNode | string | undefined;
}

/**
 * Rojo project structure (default.project.json)
 */
export interface RojoProject {
  /** Project name */
  name: string;
  
  /** The tree structure mapping file paths to Roblox instances */
  tree: RojoTreeNode;
}

/**
 * Configuration settings for the extension
 */
export interface ExtensionConfig {
  /** Enable/disable the extension */
  enabled: boolean;
  /** Fuzzy search threshold (0 = exact match, 1 = match anything) */
  fuzzyThreshold: number;
  /** Maximum number of suggestions to show */
  maxSuggestions: number;
  /** Show activation message when extension loads */
  showActivationMessage: boolean;
  /** Show the full path in completion item detail */
  showPathInDetail: boolean;
  /** Prioritize Wally packages over other modules */
  preferWallyPackages: boolean;
  /** Character that triggers autocomplete */
  triggerCharacter: string;
  /** Automatically insert require statement on selection */
  autoInsertRequire: boolean;
  /** Show module type icons in autocomplete */
  showModuleIcons: boolean;
}