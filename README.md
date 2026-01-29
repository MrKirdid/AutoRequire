# 🚀 Roblox Super Require Autocomplete

**Intelligent `require()` autocomplete for Roblox Luau projects** with blazing-fast fuzzy search and automatic path resolution using Rojo project structure.

Never manually type `require()` statements again! Just type `:` at the start of a line, search for your module, and let the extension do the rest.

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Download & Build

Open a terminal (Command Prompt or PowerShell) and run these commands:

```bash
# Clone the repository
git clone https://github.com/MrKirdid/AutoRequire.git

# Enter the folder
cd vscode-roblox-super-require

# Install dependencies
npm install

# Compile the extension
npm run compile

# Package as VSIX file
npx vsce package
```

This creates a file called `roblox-super-require-1.0.0.vsix` in the folder.

### Step 2: Install in VS Code

1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type **"Install from VSIX"** and select it
4. Navigate to the folder and select `roblox-super-require-1.0.0.vsix`
5. Click **Reload** when prompted

### Step 3: Use It!

1. Open any `.luau` file in your Rojo project
2. Go to the **start of an empty line**
3. Type `:` followed by part of a module name (e.g., `:jan`)
4. Select from the autocomplete dropdown
5. It inserts: `local Janitor = require(game.ReplicatedStorage.Shared.Packages.Janitor)`

**That's it! 🎉**

---

## ✨ Features

### 🎯 Smart Trigger
- Type `:` at the **start of a line** to activate module search
- Only triggers on line start—won't interfere with your code mid-line
- Works in both `.lua` and `.luau` files

### 🔍 Advanced Fuzzy Search with Typo Tolerance
- **Typo-friendly matching**: Type `rpomptclass` and still find `PromptClass`!
- Uses advanced algorithms: Levenshtein distance, character frequency analysis, keyboard proximity detection
- Handles character swaps, missing letters, and adjacent key mistakes
- Type partial names: `:Jan` matches `Janitor`
- Searches both module names and file paths
- Handles hundreds of modules without lag
- Configurable tolerance levels: "normal" or "aggressive"
- **Only searches `.luau` files** (Rojo standard)

### 🛤️ Smart Path Resolution
- **Uses deepest defined variable**: If you have `local Shared = ReplicatedStorage.Shared`, requires use `Shared.Module` instead of `ReplicatedStorage.Shared.Module`
- **Relative paths**: Automatically uses `script.Parent` paths when modules are close
- Reads `default.project.json` (Rojo project files)
- Reads `sourcemap.json` (Rojo sourcemap)
- Recognizes common Roblox services:
  - `ReplicatedStorage`
  - `ServerScriptService`
  - `ServerStorage`
  - `StarterPlayer`, `StarterGui`
  - And more!

### 📁 init.luau Support
- Properly handles `init.luau` files (Rojo convention)
- Uses the **parent folder name** as the module name
- Supports `init.server.luau` and `init.client.luau` variants

### ⚡ Performance
- Indexes all `.luau` modules at startup
- Caches results for instant suggestions
- Watches for file changes and updates automatically
- No external dependencies for fuzzy matching (pure TypeScript)
- No noticeable lag even with large projects

### 📝 Smart Insertion
- Automatically generates: `local <ModuleName> = require(game.<InstancePath>)`
- Uses existing variable definitions for shorter paths
- Shows full paths in autocomplete for disambiguation

---

## 🎮 Usage

### Basic Usage

1. Open a `.lua` or `.luau` file in your Roblox project
2. Start a new line
3. Type `:` followed by part of the module name
4. Select the module from autocomplete suggestions
5. The full `require()` statement is inserted automatically!

### Example Workflow

**File structure (Rojo project):**
```
src/
  shared/
    Packages/
      Janitor.luau
      Signal.luau
      Promise.luau
    Utils/
      init.luau       <-- This becomes "Utils" module
      Helper.luau
```

**In your code:**
```lua
-- Type this:
:Jan

-- Autocomplete shows:
-- Janitor - game.ReplicatedStorage.Shared.Packages.Janitor

-- Press Enter, and it becomes:
local Janitor = require(game.ReplicatedStorage.Shared.Packages.Janitor)
```

**Another example with init.luau:**
```lua
-- Type:
:Utils

-- Autocomplete shows:
-- Utils - game.ReplicatedStorage.Shared.Utils

-- Result:
local Utils = require(game.ReplicatedStorage.Shared.Utils)
```

---

## ⚙️ Configuration

Open VS Code settings (`Ctrl+,` or `Cmd+,`) and search for "Roblox Super Require":

### Core Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable/disable the extension |
| `triggerCharacter` | `:` | Character that triggers autocomplete |
| `maxSuggestions` | `20` | Maximum number of suggestions |
| `autoInsertRequire` | `true` | Insert full `local X = require()` statement |
| `showPathInDetail` | `true` | Show instance path in completion detail |
| `showModuleIcons` | `true` | Show different icons for module types |
| `preferWallyPackages` | `false` | Prioritize Wally packages in results |

### Fuzzy Search Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `fuzzyMinScore` | `0.3` | Minimum match score (0-1). Lower = more matches |
| `typoTolerance` | `aggressive` | `"normal"` or `"aggressive"`. Aggressive handles large typos like `rpomptclass` → `PromptClass` |

### Path Resolution Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `useDeepestVariable` | `true` | Use deepest defined variable for paths. E.g., use `Shared.Module` if `local Shared = RS.Shared` exists |
| `preferRelativePaths` | `true` | Use `script.Parent` paths when close |
| `maxParentTraversals` | `3` | Max `.Parent` traversals for relative paths |

**Example `settings.json`:**
```json
{
  "robloxSuperRequire.enabled": true,
  "robloxSuperRequire.typoTolerance": "aggressive",
  "robloxSuperRequire.fuzzyMinScore": 0.25,
  "robloxSuperRequire.useDeepestVariable": true,
  "robloxSuperRequire.preferRelativePaths": true,
  "robloxSuperRequire.maxSuggestions": 30
}
```

---

## 🆕 Deep Path Resolution

One of the most powerful features! If you have existing variable definitions, the extension uses them automatically.

**Example:**
```lua
-- Existing definitions in your file:
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage.Shared
local Packages = Shared.Packages

-- When you type :Janitor, instead of:
local Janitor = require(game.ReplicatedStorage.Shared.Packages.Janitor)

-- You get the shortest path:
local Janitor = require(Packages.Janitor)
```

The extension finds the **deepest** matching variable and uses it, making your requires clean and consistent!

---

## 🗂️ Rojo Project Support

This extension works seamlessly with [Rojo](https://rojo.space/) projects!

### default.project.json

The extension reads your `default.project.json` to accurately resolve Roblox Instance paths. Example project file:

```json
{
  "name": "my-game",
  "tree": {
    "$className": "DataModel",
    "ReplicatedStorage": {
      "Shared": {
        "$path": "src/shared"
      }
    },
    "ServerScriptService": {
      "Server": {
        "$path": "src/server"
      }
    }
  }
}
```

### sourcemap.json

If you have a `sourcemap.json` in your workspace root (generated by Rojo), the extension will:
- Read the Rojo sourcemap structure
- Resolve accurate Roblox Instance paths
- Automatically update when `sourcemap.json` changes

**No project files?** No problem! The extension falls back to intelligent folder naming conventions.

---

## 🔧 Commands

Access commands via `Ctrl+Shift+P` (or `Cmd+Shift+P`):

- **Roblox Super Require: Reindex Modules** - Manually rebuild the module index

---

## 🐛 Troubleshooting

### Autocomplete not showing?
- Make sure you're in a `.lua` or `.luau` file
- Check that you typed `:` at the **start of a line** (not mid-line)
- Verify the extension is enabled in settings

### Modules not found?
- Run the "Reindex Modules" command
- Check that your files have `.luau` extensions
- Ensure you have a workspace folder open

### Wrong paths?
- Add a `default.project.json` to your project root
- Check that your folder structure follows Rojo conventions
- Rebuild the index after moving files

---

## 🚀 Performance Tips

- The extension indexes modules on startup—first activation may take a moment
- Index is cached for instant subsequent searches
- File watcher updates the index automatically when you add/remove files
- For very large projects (1000+ modules), consider increasing `maxSuggestions` carefully

---

## 📝 Requirements

- **VS Code:** 1.75.0 or higher
- **Language:** Lua or Luau files
- **Files:** `.luau` extension for your modules
- **Optional:** Rojo project with `default.project.json`

---

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- Built with [VS Code Extension API](https://code.visualstudio.com/api)
- Custom fuzzy matching with Levenshtein distance, keyboard proximity, and character frequency analysis
- Inspired by the Roblox development community and [Rojo](https://rojo.space/)

---

## 📧 Support

Found a bug or have a question? Open an issue on GitHub!

**Enjoy effortless `require()` statements! 🎉**