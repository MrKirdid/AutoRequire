/**
 * Type definitions for the Roblox Super Require extension
 */

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
  enabled: boolean;
  fuzzyThreshold: number;
  maxSuggestions: number;
}