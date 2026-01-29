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
  /** Whether this is a Wally package */
  isWallyPackage?: boolean;
}

/**
 * Rojo sourcemap structure
 */
export interface SourcemapNode {
  className?: string;
  name: string;
  filePaths?: string[];
  children?: SourcemapNode[];
}

export interface Sourcemap {
  name: string;
  className: string;
  filePaths?: string[];
  children?: SourcemapNode[];
}

/**
 * Rojo project structure (default.project.json)
 */
export interface RojoTreeNode {
  $className?: string;
  $path?: string;
  [key: string]: RojoTreeNode | string | undefined;
}

export interface RojoProject {
  name: string;
  tree: RojoTreeNode;
}

/**
 * Defined variable for path resolution
 */
export interface DefinedVariable {
  varName: string;
  instancePath: string;
  depth: number;
  lineIndex: number;
}

/**
 * Fuzzy match strength levels
 */
export type FuzzyMatchStrength = 'strict' | 'normal' | 'loose';

/**
 * Path style preference
 */
export type PathStyle = 'auto' | 'absolute' | 'relative';

/**
 * Configuration settings for the extension (simplified)
 */
export interface ExtensionConfig {
  /** Enable/disable the extension */
  enabled: boolean;
  /** Maximum number of suggestions */
  maxSuggestions: number;
  /** Fuzzy match strictness */
  fuzzyMatchStrength: FuzzyMatchStrength;
  /** Path style preference */
  pathStyle: PathStyle;
  /** Exclude patterns */
  excludePatterns: string[];
  /** Use game:GetService() */
  useGetService: boolean;
  /** Debug mode */
  debugMode: boolean;
}
