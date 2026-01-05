import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export { build } from "./build.js";
export { dev } from "./server.js";

export { readTree, writeTree, walkTree, filterTree, mapTree } from "./tree.js";
export {
  compileTypst,
  checkTypstInstalled,
  createTempDir,
  cleanupTempDir,
} from "./typst-adapter.js";
export {
  pathToRoute,
  routeToBuildPath,
  mapObject,
  mapValues,
  filterObject,
} from "./pipeline.js";

/**
 * Loads config from tssg.config.js
 * @param {string} rootPath - Root directory to search for config
 * @returns {Promise<Object>} Config object with defaults merged
 */
export async function loadConfig(rootPath = ".") {
  const defaultConfig = {
    src: "./src",
    output: "./build",
    base: "/",
    defaultLayout: null,
    indexPage: "index.typ",
    layoutInheritance: "fallback",
    maxMergeDepth: 5,
    pdfQuality: 2.0,
  };

  const configPath = path.resolve(rootPath, "tssg.config.js");

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const configUrl = pathToFileURL(configPath).href;
    const configModule = await import(configUrl);
    const userConfig = configModule.default || configModule;

    return {
      ...defaultConfig,
      ...userConfig,
    };
  } catch (error) {
    console.warn(`Failed to load config from ${configPath}: ${error.message}`);
    return defaultConfig;
  }
}
