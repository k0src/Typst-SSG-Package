import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readTree, walkTree, writeTree } from "./tree.js";
import { pathToRoute, routeToBuildPath } from "./pipeline.js";
import {
  checkTypstInstalled,
  compileTypst,
  createTempDir,
  cleanupTempDir,
} from "./typst-adapter.js";
import { loadConfig } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXCLUDE_DIRS = ["node_modules", ".git", "build"];
const SKIP_EXTENSIONS = [".json", ".js", ".ts"];
const TEMP_DIR_PREFIX = "tssg-";
const PAGES_DIR_NAME = "pages";
const ASSETS_DIR_NAME = "assets";

function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

function isExcludedDir(name) {
  return EXCLUDE_DIRS.includes(name) || name.startsWith(TEMP_DIR_PREFIX);
}

/**
 * Walks directory tree and extracts import dependencies
 * @param {string} dir Directory to walk
 * @param {Map<string, Set<string>>} graph Dependency graph to populate
 * @param {string} relativePath Current relative path from start
 */
function walkTypstDirectory(dir, graph, relativePath = "") {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (isExcludedDir(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = normalizePath(path.join(relativePath, entry.name));

    if (entry.isDirectory()) {
      walkTypstDirectory(fullPath, graph, relPath);
    } else if (entry.isFile() && entry.name.endsWith(".typ")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      const deps = new Set();

      const importRegex = /#import\s+"([^"]+)"/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (!importPath.startsWith(".")) continue;

        const fileDir = path.dirname(relPath);
        const resolvedImport = normalizePath(
          path.normalize(path.join(fileDir, importPath))
        );
        deps.add(resolvedImport);
      }

      graph.set(relPath, deps);
    }
  }
}

/**
 * Main build function
 * @param {Object} options Build options
 * @return {Promise<Object>} Build result
 */
export async function build(options = {}) {
  const startTime = Date.now();

  const rootPath = options.root || ".";
  const userConfig = await loadConfig(rootPath);

  const rootResolved = path.resolve(rootPath);
  fs.readdirSync(rootResolved, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(TEMP_DIR_PREFIX)
    )
    .forEach((entry) => {
      try {
        fs.rmSync(path.join(rootResolved, entry.name), {
          recursive: true,
          force: true,
        });
      } catch {
        // Ignore
      }
    });

  const config = {
    root: path.resolve(rootPath),
    src: path.resolve(rootPath, userConfig.src || "./src"),
    output: path.resolve(options.output || "./build"),
    clean: options.clean !== false,
    verbose: options.verbose || false,
    base: userConfig.base || "/",
    indexPage: userConfig.indexPage,
    layoutInheritance: userConfig.layoutInheritance,
    maxMergeDepth: userConfig.maxMergeDepth,
    pdfQuality: userConfig.pdfQuality,
    sidebar: userConfig.sidebar,
    toc: userConfig.toc,
    theme: userConfig.theme,
  };

  const typstCheck = checkTypstInstalled();
  if (!typstCheck.installed) {
    throw new Error(
      "Typst is not installed. Install from https://typst.app/open-source/#download"
    );
  }
  if (config.verbose) {
    console.log(`Using Typst ${typstCheck.version}`);
  }

  if (config.clean && fs.existsSync(config.output)) {
    fs.rmSync(config.output, { recursive: true, force: true });
  }
  fs.mkdirSync(config.output, { recursive: true });

  const assetsDir = path.join(config.output, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const templatesDir = path.join(__dirname, "templates");

  fs.copyFileSync(
    path.join(templatesDir, "viewer.css"),
    path.join(assetsDir, "_viewer.css")
  );
  fs.copyFileSync(
    path.join(templatesDir, "viewer.js"),
    path.join(assetsDir, "_viewer.js")
  );

  const pdfiumDir = path.join(assetsDir, "_pdfium");
  fs.mkdirSync(pdfiumDir, { recursive: true });
  fs.copyFileSync(
    path.join(templatesDir, "pdfium", "pdfium.esm.js"),
    path.join(pdfiumDir, "pdfium.esm.js")
  );
  fs.copyFileSync(
    path.join(templatesDir, "pdfium", "pdfium.wasm"),
    path.join(pdfiumDir, "pdfium.wasm")
  );

  if (config.verbose) {
    console.log("✓ Copied viewer assets");
  }

  const pagesDir = path.join(config.src, PAGES_DIR_NAME);
  const userAssetsDir = path.join(config.src, ASSETS_DIR_NAME);

  if (!fs.existsSync(pagesDir)) {
    throw new Error(`Pages directory not found: ${pagesDir}`);
  }

  const pagesTree = readTree(pagesDir, { extensions: [".typ", ".css"] });
  const assetsTree = fs.existsSync(userAssetsDir)
    ? readTree(userAssetsDir)
    : null;

  let pageCount = 0;
  const errors = [];
  const pages = [];

  walkTree(pagesTree, (pathArray, content, isLeaf) => {
    if (!isLeaf || !pathArray[pathArray.length - 1].endsWith(".typ")) {
      return;
    }

    if (
      pathArray[pathArray.length - 1] === "index.typ" &&
      isLayoutFile(content)
    ) {
      return;
    }

    pages.push({ pathArray, content });
  });

  const concurrencyLimit = 4;
  const buildPromises = [];

  for (let i = 0; i < pages.length; i += concurrencyLimit) {
    const batch = pages.slice(i, i + concurrencyLimit);
    const batchPromises = batch.map(async (page) => {
      try {
        await buildPage(page.pathArray, page.content, pagesTree, config);

        if (config.verbose) {
          let route = pathToRoute(page.pathArray);
          const fileName = page.pathArray[page.pathArray.length - 1];
          if (config.indexPage && fileName === config.indexPage) {
            route = "/";
          }
          console.log(`✓ Built ${route}`);
        }

        return { success: true, page };
      } catch (error) {
        const errorMsg = `Failed to build ${page.pathArray.join("/")}: ${
          error.message
        }`;
        errors.push(errorMsg);
        console.error(`✗ ${errorMsg}`);
        return { success: false, page, error };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    buildPromises.push(...batchResults);
  }

  pageCount = buildPromises.filter((r) => r.success).length;

  let assetCount = 0;
  if (assetsTree && Object.keys(assetsTree).length > 0) {
    writeTree(assetsTree, assetsDir);
    assetCount = countFiles(assetsTree);

    if (config.verbose) {
      console.log(`✓ Copied ${assetCount} asset(s)`);
    }
  }

  const nojekyllPath = path.join(config.output, ".nojekyll");
  fs.writeFileSync(nojekyllPath, "", "utf-8");

  return {
    success: errors.length === 0,
    pageCount,
    assetCount,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Builds dependency graph
 * @param {Object} config Build configuration
 * @param {Object} pagesTree Pages tree structure
 * @returns {Map<string, Set<string>>} Map of file path -> Set of dependencies
 */
function buildCompleteDependencyGraph(config, pagesTree) {
  const graph = new Map();
  const pagesRelativeToSrc = normalizePath(
    path.relative(config.src, path.join(config.src, PAGES_DIR_NAME))
  );

  walkTypstDirectory(config.src, graph);

  walkTree(pagesTree, (pathArray, content, isLeaf) => {
    if (!isLeaf || !pathArray[pathArray.length - 1].endsWith(".typ")) return;

    const fileName = pathArray[pathArray.length - 1];
    if (fileName === "index.typ" && isLayoutFile(content)) return;

    const pagePathInSrc = pagesRelativeToSrc + "/" + pathArray.join("/");

    if (!graph.has(pagePathInSrc)) {
      graph.set(pagePathInSrc, new Set());
    }
    const pageDeps = graph.get(pagePathInSrc);

    const layouts = findLayout(
      pathArray,
      pagesTree,
      config.layoutInheritance,
      config.maxMergeDepth
    );

    if (Array.isArray(layouts)) {
      for (const layout of layouts) {
        const layoutPathInSrc =
          pagesRelativeToSrc + "/" + layout.pathArray.join("/");
        pageDeps.add(layoutPathInSrc);
      }
    } else if (layouts) {
      const layoutPathInSrc =
        pagesRelativeToSrc + "/" + layouts.pathArray.join("/");
      pageDeps.add(layoutPathInSrc);
    }
  });

  return graph;
}

/**
 * Finds all pages affected by a file change
 * @param {string} changedFile Changed file path
 * @param {Map<string, Set<string>>} depGraph Complete dependency graph
 * @param {Object} pagesTree Pages tree
 * @param {string} pagesRelativeToSrc Pages directory path relative to src
 * @returns {Array} Array of affected pages with {pathArray, content}
 */
function findAffectedPages(
  changedFile,
  depGraph,
  pagesTree,
  pagesRelativeToSrc
) {
  const affectedFiles = new Set();
  const toCheck = [changedFile];
  const checked = new Set();

  while (toCheck.length > 0) {
    const current = toCheck.pop();
    if (checked.has(current)) continue;
    checked.add(current);

    for (const [file, deps] of depGraph.entries()) {
      if (deps.has(current)) {
        affectedFiles.add(file);
        toCheck.push(file);
      }
    }
  }

  if (changedFile.startsWith(pagesRelativeToSrc + "/")) {
    affectedFiles.add(changedFile);
  }

  const affectedPages = [];
  for (const filePath of affectedFiles) {
    if (!filePath.startsWith(pagesRelativeToSrc + "/")) continue;

    const pageRelativePath = filePath.substring(pagesRelativeToSrc.length + 1);
    const pathParts = pageRelativePath.split("/");

    let node = pagesTree;
    let found = true;
    for (const part of pathParts) {
      if (node && typeof node === "object" && part in node) {
        node = node[part];
      } else {
        found = false;
        break;
      }
    }

    if (found && typeof node === "string") {
      const fileName = pathParts[pathParts.length - 1];
      if (fileName === "index.typ" && isLayoutFile(node)) continue;
      affectedPages.push({ pathArray: pathParts, content: node });
    }
  }

  return affectedPages;
}

/**
 * Sets up temporary directory with all required files for compilation
 * @param {string} tempDirBase Base temporary directory path
 * @param {string[]} pagePathArray Page path array
 * @param {Object} config Build configuration
 * @returns {string} Working directory path for this specific page
 */
function setupTempDirectory(tempDirBase, pagePathArray, config) {
  const pageDir = pagePathArray.slice(0, -1);
  const tempDir = path.join(tempDirBase, ...pageDir);
  fs.mkdirSync(tempDir, { recursive: true });

  const pagesDir = path.join(config.src, PAGES_DIR_NAME);
  copyAllTypFiles(pagesDir, tempDirBase, EXCLUDE_DIRS);

  const srcEntries = fs.readdirSync(config.src, { withFileTypes: true });
  const pagesDirName = path.basename(pagesDir);

  for (const entry of srcEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === pagesDirName) continue;
    if (isExcludedDir(entry.name)) continue;

    const sourceDir = path.join(config.src, entry.name);
    const destDir = path.join(tempDirBase, entry.name);
    copyAllTypFiles(sourceDir, destDir, EXCLUDE_DIRS);
  }

  return tempDir;
}

/**
 * Recursively copies all .typ files and assets from source directory to destination
 * @param {string} sourceDir Source directory to copy from
 * @param {string} destDir Destination directory to copy to
 * @param {string[]} excludeDirs Directory names to exclude
 */
function copyAllTypFiles(sourceDir, destDir, excludeDirs = []) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (isExcludedDir(entry.name)) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyAllTypFiles(sourcePath, destPath, excludeDirs);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SKIP_EXTENSIONS.includes(ext)) {
        fs.copyFileSync(sourcePath, destPath);
      }
    }
  }
}

/**
 * Extract page title from Typst source
 * @param {string} document Typst source document
 * @returns {string|null} Page title or null
 */
function extractPageTitle(document) {
  const titleRegex = /#page-title\s*\(\s*"([^"]*)"\s*\)/g;
  const matches = [...document.matchAll(titleRegex)];

  if (matches.length > 0) {
    return matches[matches.length - 1][1];
  }

  return null;
}

/**
 * Extract page config from Typst source
 * @param {string} document Typst source document
 * @returns {Object} Page configuration
 */
function extractPageConfig(document) {
  const configRegex = /#page-config\s*\(([\s\S]*?)\)/g;
  const match = configRegex.exec(document);

  const defaultConfig = {
    sidebar: true,
    toc: true,
    tocMinLevel: 1,
    tocMaxLevel: 4,
  };

  if (!match) return defaultConfig;

  const configStr = match[1];
  const config = { ...defaultConfig };

  const sidebarMatch = configStr.match(/sidebar:\s*(true|false)/);
  if (sidebarMatch) {
    config.sidebar = sidebarMatch[1] === "true";
  }

  const tocMatch = configStr.match(/toc:\s*(true|false)/);
  if (tocMatch) {
    config.toc = tocMatch[1] === "true";
  }

  const minLevelMatch = configStr.match(/toc-min-level:\s*(\d+)/);
  if (minLevelMatch) {
    config.tocMinLevel = parseInt(minLevelMatch[1]);
  }

  const maxLevelMatch = configStr.match(/toc-max-level:\s*(\d+)/);
  if (maxLevelMatch) {
    config.tocMaxLevel = parseInt(maxLevelMatch[1]);
  }

  return config;
}

/**
 * Builds a single page
 * @param {string[]} pagePathArray Path array to the page file
 * @param {string} pageContent Content of the page file
 * @param {Object} pagesTree Full pages tree object
 * @param {Object} config Build configuration
 */
async function buildPage(pagePathArray, pageContent, pagesTree, config) {
  let route = pathToRoute(pagePathArray);

  const fileName = pagePathArray[pagePathArray.length - 1];
  if (config.indexPage && fileName === config.indexPage) {
    route = "/";
  }

  const buildPaths = routeToBuildPath(route);

  const layoutResult = findLayout(
    pagePathArray,
    pagesTree,
    config.layoutInheritance,
    config.maxMergeDepth
  );

  const cssResult = findCss(
    pagePathArray,
    pagesTree,
    config.layoutInheritance,
    config.maxMergeDepth
  );

  const customCss = composeCss(cssResult, config.layoutInheritance);

  const document = composeDocument(
    layoutResult,
    pageContent,
    pagePathArray,
    config.layoutInheritance
  );

  const pageTitle = extractPageTitle(document);
  const defaultTitle = route.split("/").filter(Boolean).pop() || "Home";
  const title = pageTitle || defaultTitle;

  const pageConfig = extractPageConfig(document);

  const tempDirBase = createTempDir(TEMP_DIR_PREFIX, config.root);

  try {
    const tempDir = setupTempDirectory(tempDirBase, pagePathArray, config);

    const outputPath = path.join(config.output, buildPaths.pdfPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const result = await compileTypst({
      source: document,
      outputPath: outputPath,
      workDir: tempDir,
      rootDir: tempDirBase,
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    const sidebarEnabled =
      config.sidebar?.enabled !== false && pageConfig.sidebar;
    let hasSidebar = false;

    if (sidebarEnabled) {
      const sidebarStructure = generateSidebarStructure(
        pagesTree,
        route,
        config
      );
      const sidebarTypst = generateSidebarTypst(
        sidebarStructure,
        config.theme || {}
      );
      const sidebarPath = path.join(
        config.output,
        buildPaths.dir,
        "sidebar.pdf"
      );

      const sidebarResult = await compileTypst({
        source: sidebarTypst,
        outputPath: sidebarPath,
        workDir: tempDir,
        rootDir: tempDirBase,
      });

      hasSidebar = sidebarResult.success && sidebarStructure.length > 0;
    }

    const tocEnabled = config.toc?.enabled !== false && pageConfig.toc;
    let hasToc = false;

    if (tocEnabled) {
      const tocMinLevel = config.toc?.minLevel || pageConfig.tocMinLevel;
      const tocMaxLevel = config.toc?.maxLevel || pageConfig.tocMaxLevel;

      const headings = extractHeadings(document, tocMinLevel, tocMaxLevel);
      const tocTypst = generateTocTypst(headings, config.theme || {});
      const tocPath = path.join(config.output, buildPaths.dir, "toc.pdf");

      const tocResult = await compileTypst({
        source: tocTypst,
        outputPath: tocPath,
        workDir: tempDir,
        rootDir: tempDirBase,
      });

      hasToc = tocResult.success && headings.length > 0;
    }

    const viewerHtml = generateViewer(
      route,
      title,
      config.pdfQuality,
      customCss,
      hasSidebar,
      hasToc,
      config.base
    );
    const htmlPath = path.join(config.output, buildPaths.htmlPath);
    fs.writeFileSync(htmlPath, viewerHtml, "utf-8");
  } finally {
    cleanupTempDir(tempDirBase);
  }
}

function countFiles(tree) {
  let count = 0;
  walkTree(tree, (pathArray, content, isLeaf) => {
    if (isLeaf) count++;
  });
  return count;
}

/**
 * Finds the layout file for a page
 * @param {string[]} pagePathArray Path array to page file
 * @param {Object} pagesTree Full pages tree object
 * @returns {Object|null} { pathArray, source } or null
 */
export function findLayout(
  pagePathArray,
  pagesTree,
  layoutInheritance = "fallback",
  maxMergeDepth = 5
) {
  if (!Array.isArray(pagePathArray) || pagePathArray.length === 0) {
    return layoutInheritance === "merge" ? [] : null;
  }

  if (!pagesTree || typeof pagesTree !== "object") {
    return layoutInheritance === "merge" ? [] : null;
  }

  if (layoutInheritance === "none") {
    const pageDir = pagePathArray.slice(0, -1);
    const indexPath = [...pageDir, "index.typ"];

    let node = pagesTree;
    for (const segment of indexPath) {
      if (node && typeof node === "object" && segment in node) {
        node = node[segment];
      } else {
        return null;
      }
    }

    if (typeof node === "string" && isLayoutFile(node)) {
      return { pathArray: indexPath, source: node, level: 0 };
    }
    return null;
  }

  let currentPath = pagePathArray.slice(0, -1);
  const layouts = [];
  let depth = 0;

  while (true) {
    if (layoutInheritance === "merge" && depth >= maxMergeDepth) {
      break;
    }

    const indexPath = [...currentPath, "index.typ"];

    let node = pagesTree;
    let found = true;

    for (const segment of indexPath) {
      if (node && typeof node === "object" && segment in node) {
        node = node[segment];
      } else {
        found = false;
        break;
      }
    }

    if (found && typeof node === "string") {
      if (isLayoutFile(node)) {
        const layout = {
          pathArray: indexPath,
          source: node,
          level: depth,
        };

        if (layoutInheritance === "fallback") {
          return layout;
        } else if (layoutInheritance === "merge") {
          layouts.push(layout);
        }
      }
    }

    if (currentPath.length === 0) {
      break;
    }

    currentPath = currentPath.slice(0, -1);
    depth++;
  }

  if (layoutInheritance === "merge") {
    return layouts;
  }

  return null;
}

/**
 * Rewrites import paths in a source file to be relative to a new location
 * @param {string} source Source code containing imports
 * @param {string[]} fromPathArray Original location path array (relative to pages/)
 * @param {string[]} toPathArray Target location path array (relative to pages/)
 * @returns {string} Source with rewritten imports
 */
function rewriteImports(source, fromPathArray, toPathArray) {
  const fromDir = fromPathArray.slice(0, -1);
  const toDir = toPathArray.slice(0, -1);

  return source.replace(/#import\s+"([^"]+)"/g, (match, importPath) => {
    if (!importPath.startsWith(".")) return match;

    const parts = importPath.split("/");
    const upCount = parts.findIndex((part) => part !== "..");
    const pathSegments = upCount === -1 ? [] : parts.slice(upCount);

    const absolutePath = [PAGES_DIR_NAME, ...fromDir];
    for (let i = 0; i < (upCount === -1 ? parts.length : upCount); i++) {
      absolutePath.pop();
    }
    absolutePath.push(...pathSegments);

    const tempDirPath =
      absolutePath[0] === PAGES_DIR_NAME ? absolutePath.slice(1) : absolutePath;

    const newPath = "../".repeat(toDir.length) + tempDirPath.join("/");

    return `#import "${newPath}"`;
  });
}

/**
 * Extract set/show statements from a layout function
 * @param {string} layoutSource Layout function source code
 * @returns {string[]} Array of set statements
 */
function extractSetStatements(layoutSource) {
  const setStatements = [];

  const layoutMatch = layoutSource.match(
    /#let\s+layout\s*\([^)]*\)\s*=\s*\{([\s\S]*)\}/
  );
  if (!layoutMatch) return setStatements;

  const layoutBody = layoutMatch[1];

  const statementRegex =
    /(^|\n)\s*(set|show)\s+\w+\([^)]*(?:\([^)]*\)[^)]*)*\)/gm;

  let match;
  while ((match = statementRegex.exec(layoutBody)) !== null) {
    setStatements.push(match[0].trim());
  }

  return setStatements;
}

/**
 * Checks if a Typst source file defines a layout function
 * @param {string} typstSource Typst source code
 * @returns {boolean} True if contains #let layout(body) = { ... }
 */
export function isLayoutFile(typstSource) {
  if (typeof typstSource !== "string") {
    return false;
  }

  const lines = typstSource.split("\n");
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const trimmed = line.trimStart();
    if (trimmed.startsWith("//")) {
      continue;
    }

    if (/#let\s+layout\s*\(\s*body\s*\)\s*=/.test(line)) {
      return true;
    }
  }

  return false;
}

/**
 * Finds CSS files for a given page
 * @param {string[]} pagePathArray Path array to page file
 * @param {Object} pagesTree Full pages tree object
 * @param {string} cssInheritance Inheritance mode
 * @param {number} maxMergeDepth Maximum depth for merge mode
 * @returns {Array|null} Array of CSS objects in merge mode, single object in fallback, null in none
 */
export function findCss(
  pagePathArray,
  pagesTree,
  cssInheritance = "fallback",
  maxMergeDepth = 5
) {
  if (!Array.isArray(pagePathArray) || pagePathArray.length === 0) {
    return cssInheritance === "merge" ? [] : null;
  }

  if (!pagesTree || typeof pagesTree !== "object") {
    return cssInheritance === "merge" ? [] : null;
  }

  if (cssInheritance === "none") {
    const pageDir = pagePathArray.slice(0, -1);
    const cssPath = [...pageDir, "index.css"];

    let node = pagesTree;
    for (const segment of cssPath) {
      if (node && typeof node === "object" && segment in node) {
        node = node[segment];
      } else {
        return null;
      }
    }

    if (typeof node === "string") {
      return { pathArray: cssPath, source: node, level: 0 };
    }
    return null;
  }

  if (cssInheritance === "fallback") {
    const directories = pagePathArray.slice(0, -1);

    for (let i = directories.length; i >= 0; i--) {
      const searchPath = [...directories.slice(0, i), "index.css"];

      let node = pagesTree;
      let found = true;

      for (const segment of searchPath) {
        if (node && typeof node === "object" && segment in node) {
          node = node[segment];
        } else {
          found = false;
          break;
        }
      }

      if (found && typeof node === "string") {
        return {
          pathArray: searchPath,
          source: node,
          level: directories.length - i,
        };
      }
    }

    return null;
  }

  if (cssInheritance === "merge") {
    const directories = pagePathArray.slice(0, -1);
    const cssFiles = [];

    for (let i = 0; i <= Math.min(directories.length, maxMergeDepth); i++) {
      const searchPath = [...directories.slice(0, i), "index.css"];

      let node = pagesTree;
      let found = true;

      for (const segment of searchPath) {
        if (node && typeof node === "object" && segment in node) {
          node = node[segment];
        } else {
          found = false;
          break;
        }
      }

      if (found && typeof node === "string") {
        cssFiles.push({
          pathArray: searchPath,
          source: node,
          level: i,
        });
      }
    }

    return cssFiles;
  }

  return cssInheritance === "merge" ? [] : null;
}

/**
 * Composes CSS from multiple files or single file
 * @param {Array|Object|null} cssResult Result from findCss()
 * @param {string} cssInheritance Inheritance mode
 * @returns {string} Composed CSS string
 */
export function composeCss(cssResult, cssInheritance = "fallback") {
  if (!cssResult) {
    return "";
  }

  if (cssInheritance === "merge" && Array.isArray(cssResult)) {
    if (cssResult.length === 0) {
      return "";
    }

    return cssResult
      .map((css) => `/* === ${css.pathArray.join("/")} === */\n${css.source}`)
      .join("\n\n");
  }

  if (cssResult && cssResult.source) {
    return cssResult.source;
  }

  return "";
}

/**
 * Generates minimal default Typst document
 * @param {string} pageBody Page content
 * @returns {string} Complete Typst document with minimal styling
 */
function generateMinimalDocument(pageBody) {
  return `#set page(
      width: 42em,
      height: auto,
      margin: (x: 0.25em, y: 0.25em),
      fill: white
    )

    #set text(fill: black)

    ${pageBody}
  `;
}

/**
 * Composes a complete Typst document from layout(s) and page content
 * @param {Object|Object[]|null} layoutResult Layout object(s) or null
 * @param {string} pageBody Page content to wrap
 * @param {string[]} pagePathArray Path array of the page being built
 * @param {string} layoutInheritance Layout inheritance: 'none' | 'fallback' | 'merge'
 * @returns {string} Complete Typst document ready to compile
 */
export function composeDocument(
  layoutResult,
  pageBody,
  pagePathArray,
  layoutInheritance = "fallback"
) {
  if (typeof pageBody !== "string") {
    throw new Error("Page body must be a string");
  }

  if (
    !layoutResult ||
    (Array.isArray(layoutResult) && layoutResult.length === 0)
  ) {
    return generateMinimalDocument(pageBody);
  }

  const generateSingleLayoutDocument = (layout) => {
    const layoutSource = rewriteImports(
      layout.source,
      layout.pathArray,
      pagePathArray
    );
    const rewrittenPageBody = rewriteImports(
      pageBody,
      pagePathArray,
      pagePathArray
    );

    return `${layoutSource}

#layout[
${rewrittenPageBody}
]`;
  };

  if (layoutInheritance === "none" || layoutInheritance === "fallback") {
    return generateSingleLayoutDocument(layoutResult);
  }

  if (layoutInheritance === "merge" && Array.isArray(layoutResult)) {
    if (layoutResult.length === 0) {
      return generateMinimalDocument(pageBody);
    }

    if (layoutResult.length === 1) {
      return generateSingleLayoutDocument(layoutResult[0]);
    }

    const immediateLayout = layoutResult[0];
    const setMap = new Map();

    for (let i = layoutResult.length - 1; i >= 0; i--) {
      const layout = layoutResult[i];
      const rewrittenSource = rewriteImports(
        layout.source,
        layout.pathArray,
        pagePathArray
      );
      const setStatements = extractSetStatements(rewrittenSource);

      for (const statement of setStatements) {
        const match = statement.trim().match(/^set\s+(\w+)/);
        if (match) {
          const key = match[1];
          setMap.set(key, statement);
        }
      }
    }

    const mergedSetStatements = Array.from(setMap.values());

    const immediateLayoutSource = rewriteImports(
      immediateLayout.source,
      immediateLayout.pathArray,
      pagePathArray
    );

    const rewrittenPageBody = rewriteImports(
      pageBody,
      pagePathArray,
      pagePathArray
    );

    return `${mergedSetStatements.join("\n")}

${immediateLayoutSource}

#layout[
${rewrittenPageBody}
]`;
  }

  return generateMinimalDocument(pageBody);
}

/**
 * Generates HTML viewer for a PDF page
 * @param {string} route Route path (e.g., '/blog/post/')
 * @param {string} title Page title
 * @param {number} pdfQuality PDF quality multiplier (default 2.0)
 * @param {string} customCss Custom CSS to inject (default "")
 * @param {boolean} hasSidebar Whether sidebar is enabled
 * @param {boolean} hasToc Whether TOC is enabled
 * @returns {string} HTML string
 */
export function generateViewer(
  route,
  title,
  pdfQuality = 2.0,
  customCss = "",
  hasSidebar = false,
  hasToc = false,
  base = "/"
) {
  const templatePath = new URL("./templates/viewer.tssg", import.meta.url);
  const template = fs.readFileSync(templatePath, "utf-8");

  const basePath = base === "/" ? "/" : base.replace(/\/$/, "") + "/";

  return template
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{pdfQuality\}\}/g, pdfQuality)
    .replace(/\{\{customCss\}\}/g, customCss)
    .replace(/\{\{hasSidebar\}\}/g, hasSidebar)
    .replace(/\{\{hasToc\}\}/g, hasToc)
    .replace(/\{\{base\}\}/g, basePath);
}

/**
 * Rebuilds only affected pages
 * @param {string} changedFile Absolute path to the changed file
 * @param {Object} options Build options (root, output, verbose)
 * @returns {Promise<Object>} Build result
 */
export async function buildIncremental(changedFile, options = {}) {
  const startTime = Date.now();

  const rootPath = options.root || ".";
  const userConfig = await loadConfig(rootPath);
  const config = {
    root: path.resolve(rootPath),
    src: path.resolve(rootPath, userConfig.src || "./src"),
    output: path.resolve(options.output || "./build"),
    verbose: options.verbose || false,
    base: userConfig.base || "/",
    indexPage: userConfig.indexPage,
    layoutInheritance: userConfig.layoutInheritance,
    maxMergeDepth: userConfig.maxMergeDepth,
    pdfQuality: userConfig.pdfQuality,
    sidebar: userConfig.sidebar,
    toc: userConfig.toc,
    theme: userConfig.theme,
  };

  const pagesDir = path.join(config.src, PAGES_DIR_NAME);
  const assetsDir = path.join(config.src, ASSETS_DIR_NAME);

  const relativePath = path.relative(config.root, changedFile);
  const srcRelative = path.relative(config.root, config.src);
  const assetsRelative = path.join(srcRelative, ASSETS_DIR_NAME);

  if (relativePath.startsWith(assetsRelative + path.sep)) {
    const outputAssetsDir = path.join(config.output, ASSETS_DIR_NAME);
    const relativeToAssets = path.relative(assetsDir, changedFile);
    const outputPath = path.join(outputAssetsDir, relativeToAssets);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(changedFile, outputPath);

    return {
      success: true,
      pageCount: 0,
      assetCount: 1,
      duration: Date.now() - startTime,
      errors: [],
    };
  }

  if (!changedFile.endsWith(".typ")) {
    return {
      success: true,
      pageCount: 0,
      assetCount: 0,
      duration: Date.now() - startTime,
      errors: [],
    };
  }

  const pagesTree = readTree(pagesDir, { extensions: [".typ", ".css"] });
  const depGraph = buildCompleteDependencyGraph(config, pagesTree);

  const changedFileRelativeToSrc = normalizePath(
    path.relative(config.src, changedFile)
  );
  const pagesRelativeToSrc = normalizePath(path.relative(config.src, pagesDir));

  const affectedPages = findAffectedPages(
    changedFileRelativeToSrc,
    depGraph,
    pagesTree,
    pagesRelativeToSrc
  );

  const errors = [];
  let pageCount = 0;

  for (const page of affectedPages) {
    try {
      await buildPage(page.pathArray, page.content, pagesTree, config);
      pageCount++;

      if (config.verbose) {
        const route = pathToRoute(page.pathArray);
        console.log(`✓ Rebuilt ${route}`);
      }
    } catch (error) {
      errors.push(
        `Failed to rebuild ${page.pathArray.join("/")}: ${error.message}`
      );
    }
  }

  return {
    success: errors.length === 0,
    pageCount,
    assetCount: 0,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Generate sidebar structure from pages tree
 * @param {Object} pagesTree Pages tree object
 * @param {string} currentRoute Current page route for active highlighting
 * @param {Object} config User config
 * @returns {Array} Sidebar structure
 */
function generateSidebarStructure(pagesTree, currentRoute = "/", config = {}) {
  function processNode(node, pathArray = [], depth = 0) {
    const items = [];

    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith(".typ")) {
        if (
          key === "index.typ" &&
          typeof value === "string" &&
          isLayoutFile(value)
        ) {
          continue;
        }

        const pageName = key.replace(".typ", "");
        const pagePath = [...pathArray, key];
        let route = pathToRoute(pagePath);

        if (config.indexPage && key === config.indexPage) {
          route = "/";
        }

        if (config.sidebar?.exclude?.includes(route)) {
          continue;
        }

        let title = pageName
          .replace(/[-_]/g, " ")
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");

        items.push({
          type: "page",
          title,
          route,
          active: route === currentRoute,
          depth,
        });
      } else if (typeof value === "object" && !Buffer.isBuffer(value)) {
        const folderPath = [...pathArray, key];
        const children = processNode(value, folderPath, depth + 1);

        if (children.length > 0) {
          let title = key
            .replace(/[-_]/g, " ")
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

          items.push({
            type: "folder",
            title,
            children,
            depth,
          });
        }
      }
    }

    return items;
  }

  const structure = processNode(pagesTree);

  structure.sort((a, b) => {
    if (a.type === "page" && a.route === "/") return -1;
    if (b.type === "page" && b.route === "/") return 1;
    return 0;
  });

  return structure;
}

/**
 * Generate Typst source for sidebar
 * @param {Array} structure Sidebar structure
 * @param {Object} theme Theme options
 * @returns {string} Typst source
 */
function generateSidebarTypst(structure, theme = {}) {
  const bgColor = theme.sidebarBg || "#f8f9fa";
  const textColor = theme.sidebarTextColor || "#333";
  const activeColor = theme.sidebarActiveColor || "#007bff";
  const font = theme.sidebarFont || "Libertinus Serif";
  const fontSize = theme.sidebarFontSize || "10pt";
  const fontWeight = theme.sidebarFontWeight || "regular";
  const folderFontSize = theme.sidebarFolderFontSize || "11pt";
  const folderFontWeight = theme.sidebarFolderFontWeight || "bold";
  const activeFontWeight = theme.sidebarActiveFontWeight || "bold";
  const linkColor = theme.sidebarLinkColor || "#2c3e50";
  const marginX = theme.sidebarMarginX || "1em";
  const marginY = theme.sidebarMarginY || "1em";

  let typst = `#set page(
      width: 250pt, 
      height: auto, 
      margin: (
        x: ${marginX}, 
        y: ${marginY}
      ), 
      fill: rgb("${bgColor}")
    )

    #set text(
      font: "${font}", 
      size: ${fontSize}, 
      weight: "${fontWeight}", 
      fill: rgb("${textColor}")
    )

    #set par(leading: 0.65em)
  `;

  function renderItem(item, isFirst = false) {
    if (item.type === "folder") {
      let result = "";
      if (!isFirst) result += "#v(0.5em)\n";
      result += `#text(
        weight: "${folderFontWeight}", 
        size: ${folderFontSize}, 
        fill: rgb("${textColor}")
      )[${item.title}]\n\n`;
      result += "#v(0.3em)\n\n";
      item.children.forEach((child) => {
        result += renderItem(child);
      });
      return result;
    } else {
      const indent = "  ".repeat(item.depth);
      if (item.active) {
        return `${indent}#text(
          fill: rgb("${activeColor}"), 
          weight: "${activeFontWeight}"
        )[#link("tssg:sametab:${item.route}", [${item.title}])]\n\n`;
      } else {
        return `${indent}#text(
          fill: rgb("${linkColor}")
        )[#link("tssg:sametab:${item.route}", [${item.title}])]\n\n`;
      }
    }
  }

  structure.forEach((item, idx) => {
    typst += renderItem(item, idx === 0);
  });

  return typst;
}

/**
 * Extract headings from Typst source
 * @param {string} source Typst source
 * @param {number} minLevel Minimum heading level
 * @param {number} maxLevel Maximum heading level
 * @returns {Array} Heading structure
 */
function extractHeadings(source, minLevel = 1, maxLevel = 4) {
  const headings = [];
  const headingRegex = /^(={1,6})\s+(.+)$/gm;

  let match;
  while ((match = headingRegex.exec(source)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();

    if (level >= minLevel && level <= maxLevel) {
      headings.push({
        level,
        text,
        id: text
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^\w-]/g, ""),
      });
    }
  }

  return headings;
}

/**
 * Generate Typst source for table of contents
 * @param {Array} headings Heading structure
 * @param {Object} theme Theme options
 * @returns {string} Typst source
 */
function generateTocTypst(headings, theme = {}) {
  const bgColor = theme.tocBg || "#f8f9fa";
  const textColor = theme.tocTextColor || "#333";
  const font = theme.tocFont || "Libertinus Serif";
  const fontSize = theme.tocFontSize || "9pt";
  const fontWeight = theme.tocFontWeight || "regular";
  const titleFontSize = theme.tocTitleFontSize || "10pt";
  const titleFontWeight = theme.tocTitleFontWeight || "bold";
  const marginX = theme.tocMarginX || "1em";
  const marginY = theme.tocMarginY || "1em";

  let typst = `#set page(
      width: 200pt, 
      height: auto, 
      margin: (
        x: ${marginX},
        y: ${marginY}
      ), 
      fill: rgb("${bgColor}")
    )
    #set text(
      font: "${font}", 
      size: ${fontSize}, 
      weight: "${fontWeight}", 
      fill: rgb("${textColor}")
    )
    #set par(leading: 0.65em)

    #text(
      weight: "${titleFontWeight}", 
      size: ${titleFontSize}
    )[On this page]

    #v(0.5em)
  `;

  headings.forEach((heading) => {
    const indent = "  ".repeat(heading.level - 1);
    const size = Math.max(8, 10 - heading.level);
    typst += `${indent}#text(
      size: ${size}pt
    )[${heading.text}]\n\n`;
  });

  return typst;
}
