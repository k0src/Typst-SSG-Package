# Typst SSG

Typst static site generator framework. Compiles Typst documents to PDF and renders them in a browser viewer with PDFium.

- [Main Repository](https://github.com/k0src/Typst-SSG)
- **[npm Package Repository](https://github.com/k0src/Typst-SSG-Package)**
- [Typst Package Repository](https://github.com/k0src/Typst-SSG-Util-Package)

## Installation

```bash
npm install typst-ssg
```

**Prerequisites:**

- [Node.js](https://nodejs.org/en/download) 18+
- [Typst](https://typst.app/open-source/#download) 0.12+ installed and in PATH

## Usage

### Commands

- `tssg init [directory]` - Initialize a new project
  - Creates a new Typst SSG project with boilerplate files.
  - If no directory is specified, uses the current directory (must be empty).
- `tssg build [options]` - Build site
  - Compiles all `.typ` files in `src/pages/` to PDF and generates HTML viewer.
  - **Options:**
    - `-r, --root <path>` - Root directory (default: `.`)
    - `-o, --output <path>` - Output directory (default: `./build`)
    - `--no-clean` - Skip cleaning output directory before build
    - `-v, --verbose` - Show detailed build output
- `tssg dev [options]` - Start development server
  - Starts a local development server with hot reload.
  - Watches for file changes and automatically rebuilds affected pages.
  - **Options:**
    - `-r, --root <path>` - Root directory (default: `.`)
    - `-o, --output <path>` - Output directory (default: `./build`)
    - `-p, --port <number>` - Port for dev server (default: `3000`)
    - `-h, --host <address>` - Host address (default: `localhost`)
    - `--no-open` - Don't open browser automatically
    - `-v, --verbose` - Show detailed build output

## Development

### Project Structure

```
src/
├── index.js              # Main exports
├── cli.js                # Command line interface
├── build.js              # Build process
├── pipeline.js           # Build pipeline utilities
├── server.js             # Development server
├── tree.js               # File tree management
├── typst-adapter.js      # Typst compilation and layout resolution
└── templates/            # SSG templates
    ├── init/             # Boilerplate template (tssg init)
    ├── pdfium/           # PDF viewer module
    ├── default.typ       # Default Typst document layout
    ├── viewer.css        # Viewer styles
    ├── viewer.js         # Viewer logic (PDFium integration)
    └── viewer.tssg       # Viewer HTML template
bin/
└── tssg                  # CLI executable
```

### Components

#### Builder ([build.js](src/build.js))

- Runs the full build process and compiles all pages to PDF
- Finds and applies layout files (`index.typ`) based on the inheritance mode
- Rewrites import paths so they resolve correctly in temp directories
- Builds dependency graphs for incremental rebuilds
- Generates HTML viewer for each PDF

#### Pipeline ([pipeline.js](src/pipeline.js))

- Converts file paths to URL routes (e.g., `blog/post.typ` → `/blog/post/`)
- Maps routes to build output paths (`/blog/post/` → `blog/post/index.html`)
- Generic object utilities for mapping and filtering

#### CLI ([cli.js](src/cli.js))

- Implements `build`, `dev`, and `init` commands via Commander.js
- Handles command-line arguments and flags
- Creates new projects with `tssg init`

#### File Tree ([tree.js](src/tree.js))

- Reads directory structures into nested objects
- Writes nested objects back to the filesystem
- Utilities to walk, filter, and map over file trees

#### Typst Adapter ([typst-adapter.js](src/typst-adapter.js))

- Checks if Typst is installed and gets version info
- Compiles `.typ` source to PDF by spawning Typst CLI process
- Manages temp files and handles compilation errors/timeouts

#### PDF Viewer ([viewer.js](src/templates/viewer.js))

- Renders PDFs in the browser using PDFium compiled to WebAssembly
- Creates text layer overlay for text selection
- Handles different link types:
  - Internal page references (like Typst `@label` references) scroll to target location
  - External URLs open in new tab by default
  - `tssg:sametab:` prefix - opens link in same tab instead of new tab
  - `tssg:copy:` prefix - copies text after prefix to clipboard when clicked
- Configurable render quality via `pdfQuality` in config

### Layout Inheritance

There are three modes that can be set in `tssg.config.js`:

1. `none`: Pages only use layout from same directory
2. `fallback`: Pages use nearest parent layout
3. `merge`: Pages merge `set` statements from all ancestor layouts

Layout resolution walks up the directory tree looking for `index.typ` files with a `layout(body)` function.

### Import Resolution

- **Relative imports**:
  - Paths relative to the current file (e.g., `#import "../utils/helpers.typ"`).
  - Automatically rewritten by the builder these when moving files to temp directories for compilation.
- **Package imports**:
  - Standard Typst packages work normally (e.g., `#import "@local/mypackage:1.0.0"`).
  - The compiler handles resolution when invoked with the `--root` flag.
- **Preview imports**:
  - Typst Universe packages are downloaded and cached automatically (e.g., `#import "@preview/cetz:0.4.2"`).

## Configuration

Create a `tssg.config.js` file in your project root:

```javascript
export default {
  // Source directory (default: "./src")
  src: "./src",

  // Output directory (default: "./build")
  output: "./build",

  // Base path for deployment (default: "/")
  // For GitHub Pages project sites, use "/repo-name/"
  // For user/org sites or custom domains, use "/"
  base: "/",

  // Which page maps to root route "/" (default: "index.typ")
  indexPage: "index.typ",

  // Layout inheritance: "none" | "fallback" | "merge" (default: "fallback")
  // - none: Pages only use same-directory layout
  // - fallback: Pages use nearest parent layout
  // - merge: Pages merge all ancestor layouts' set statements
  layoutInheritance: "fallback",

  // Maximum layout merge depth (default: 5)
  maxMergeDepth: 5,

  // PDF rendering quality multiplier (default: 2.0)
  // Higher = better quality but larger files and slower rendering
  pdfQuality: 2.0,

  // Sidebar configuration
  sidebar: {
    // Enable/disable sidebar globally (default: true)
    enabled: true,
  },

  // Table of contents configuration
  toc: {
    // Enable/disable TOC globally (default: true)
    enabled: true,

    // Minimum heading level to include (default: 1)
    // 1 = top-level headings only, 2 = second-level, etc.
    minLevel: 1,

    // Maximum heading level to include (default: 4)
    maxLevel: 4,
  },

  // Theme configuration for sidebar and TOC
  theme: {
    // Sidebar styling
    sidebarBg: "#f8f9fa", // Background color
    sidebarTextColor: "#333", // Text color
    sidebarActiveColor: "#007bff", // Active page highlight color

    // TOC styling
    tocBg: "#f8f9fa", // Background color
    tocTextColor: "#333", // Text color
  },
};
```

#### Options

- `src` - Directory containing `pages/` and `assets/` folders
- `indexPage` - Filename to use as the site index (appears at `/`)
- `layoutInheritance` - How layouts are resolved
- `maxMergeDepth` - Maximum number of parent layouts to merge in `merge` mode
- `pdfQuality` - Rendering quality multiplier (higher can be sharper, but the files are larger, and may appear aliased)

## API

For programmatic usage, import functions from `typst-ssg`:

```javascript
import {
  build,
  dev,
  loadConfig,
  readTree,
  writeTree,
  compileTypst,
  pathToRoute,
} from "typst-ssg";
```

### Build Functions

#### `build(options)`

Runs a full build of the site.

```javascript
const result = await build({
  root: "./", // Project root directory
  output: "./build", // Output directory
  clean: true, // Clean output before build
  verbose: false, // Detailed logging
});
// Returns: { success: boolean, pageCount: number, assetCount: number, duration: number, errors: string[] }
```

#### `buildIncremental(changedFile, options)`

Rebuilds only pages affected by a file change.

```javascript
import { buildIncremental } from "typst-ssg/build.js";

const result = await buildIncremental("/path/to/changed/file.typ", {
  root: "./",
  output: "./build",
  verbose: false,
});
```

### Server Functions

#### `dev(options)`

Starts development server with hot reload.

```javascript
const { server, watcher, close } = await dev({
  root: "./",
  output: "./build",
  port: 3000,
  host: "localhost",
  open: true, // Auto-open browser
  verbose: false,
});
```

### Tree Functions

#### `readTree(rootPath, options)`

Reads directory structure into nested objects.

```javascript
const tree = readTree("./src/pages", {
  extensions: [".typ", ".css"], // Filter by extension
  ignore: ["node_modules"], // Directories to skip
});
// Returns: { "file.typ": "content", "dir": { "nested.typ": "content" } }
```

#### `writeTree(tree, outputPath, options)`

Writes nested object to filesystem.

```javascript
const count = writeTree(tree, "./output", { clean: true });
// Returns: number of files written
```

#### `walkTree(tree, callback)`

Traverses tree depth-first.

```javascript
walkTree(tree, (pathArray, content, isLeaf) => {
  if (isLeaf) {
    console.log(`File: ${pathArray.join("/")} - ${content.length} bytes`);
  }
});
```

#### `filterTree(tree, predicate)`

Creates new tree with only matching nodes.

```javascript
const typFiles = filterTree(tree, (path, content, isLeaf) => {
  return isLeaf && path[path.length - 1].endsWith(".typ");
});
```

#### `mapTree(tree, mapper)`

Transforms leaf node contents.

```javascript
const uppercased = mapTree(tree, (path, content) => content.toUpperCase());
```

### Typst Functions

#### `compileTypst(options)`

Compiles Typst source to PDF.

```javascript
const result = await compileTypst({
  source: "#set page(width: 10cm)\nHello", // Typst source code
  outputPath: "./output.pdf", // Where to write PDF
  workDir: "./temp", // Working directory
  rootDir: "./src", // Root for imports
  timeout: 30000, // Timeout in ms
});
// Returns: { success: boolean, outputPath: string, error?: string }
```

#### `checkTypstInstalled()`

Checks if Typst CLI is available.

```javascript
const { installed, version } = checkTypstInstalled();
// Returns: { installed: boolean, version: string | null }
```

#### `createTempDir(prefix, baseDir)`

Creates temporary directory.

```javascript
const tempDir = createTempDir("tssg-", "./");
// Returns: absolute path to temp directory
```

#### `cleanupTempDir(tempDir)`

Removes temporary directory.

```javascript
cleanupTempDir(tempDir);
```

### Pipeline Functions

#### `pathToRoute(pathArray)`

Converts file path to URL route.

```javascript
pathToRoute(["blog", "post.typ"]); // Returns: "/blog/post/"
pathToRoute(["index.typ"]); // Returns: "/"
```

#### `routeToBuildPath(route)`

Maps route to build output paths.

```javascript
routeToBuildPath("/blog/post/");
// Returns: { dir: "blog/post", pdfPath: "blog/post/index.pdf", htmlPath: "blog/post/index.html" }
```

#### `mapObject(obj, fn)`, `mapValues(obj, fn)`, `filterObject(obj, predicate)`

Object transformation utilities.

```javascript
const mapped = mapObject({ a: 1, b: 2 }, (val, key) => val * 2);
const filtered = filterObject({ a: 1, b: 2 }, (val) => val > 1);
```

### Config Functions

#### `loadConfig(rootPath)`

Loads and merges `tssg.config.js` with defaults.

```javascript
const config = await loadConfig("./");
// Returns: { src, indexPage, layoutInheritance, maxMergeDepth, pdfQuality, ... }
```

## Dependencies

- `@embedpdf/pdfium` - PDFium WASM for PDF rendering
- `chokidar` - File watching
- `commander` - CLI framework

## Contributing

Contributions are welcome. Please open issues and pull requests for the npm package on this repository.

## License

[MIT](LICENSE)
