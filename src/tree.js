import fs from "fs";
import path from "path";

/**
 * Determines if the given value is a leaf node
 * @param {any} value Value to check
 * @returns {boolean}
 */
const isLeafNode = (value) =>
  typeof value === "string" ||
  value instanceof Buffer ||
  value instanceof Uint8Array;

/**
 * Reads a directory tree from the filesystem into a nested object
 * @param {string} rootPath Root directory path
 * @param {Object} options Options
 * @param {string[]} options.extensions List of file extensions to include
 * @param {string[]} options.ignore Patterns to ignore
 * @returns {Object} Nested object representing the directory tree
 */
export function readTree(rootPath, options = {}) {
  const { extensions = null, ignore = ["node_modules", ".git"] } = options;

  if (!fs.existsSync(rootPath)) {
    throw new Error(`Path does not exist: ${rootPath}`);
  }

  const stat = fs.statSync(rootPath);

  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${rootPath}`);
  }

  function shouldIgnore(name) {
    return ignore.some((pattern) => {
      return name === pattern || name.startsWith(pattern);
    });
  }

  function readDir(dirPath) {
    const result = {};
    let entries;

    try {
      entries = fs.readdirSync(dirPath);
    } catch (error) {
      console.warn(`Could not read directory ${dirPath}:`, error.message);
      return result;
    }

    for (const entry of entries) {
      if (shouldIgnore(entry)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry);
      let stat;

      try {
        stat = fs.statSync(fullPath);
      } catch (error) {
        console.warn(`Could not stat ${fullPath}:`, error.message);
        continue;
      }

      if (stat.isDirectory()) {
        result[entry] = readDir(fullPath);
      } else if (stat.isFile()) {
        if (extensions && !extensions.includes(path.extname(entry))) {
          continue;
        }

        try {
          result[entry] = fs.readFileSync(fullPath, "utf-8");
        } catch (error) {
          console.warn(`Could not read file ${fullPath}:`, error.message);
        }
      }
    }

    return result;
  }

  return readDir(rootPath);
}

/**
 * Writes nested object tree to the filesystem
 * @param {Object} tree Nested object to write
 * @param {string} outputPath Output directory path
 * @param {Object} options Options
 * @param {boolean} options.clean Clean output directory before writing
 * @returns {number} Number of files written
 */
export function writeTree(tree, outputPath, options = {}) {
  const { clean = false } = options;

  if (clean && fs.existsSync(outputPath)) {
    fs.rmSync(outputPath, { recursive: true, force: true });
  }

  fs.mkdirSync(outputPath, { recursive: true });
  let filesWritten = 0;

  function writeNode(node, currentPath) {
    for (const [key, value] of Object.entries(node)) {
      const fullPath = path.join(currentPath, key);

      if (typeof value === "string") {
        fs.writeFileSync(fullPath, value, "utf-8");
        filesWritten++;
      } else if (value instanceof Buffer || value instanceof Uint8Array) {
        fs.writeFileSync(fullPath, value);
        filesWritten++;
      } else if (typeof value === "object" && value !== null) {
        fs.mkdirSync(fullPath, { recursive: true });
        writeNode(value, fullPath);
      }
    }
  }

  writeNode(tree, outputPath);
  return filesWritten;
}

/**
 * Walks tree depth-first, calling callback for each node
 * @param {Object} tree Tree to walk
 * @param {Function} callback Callback(path, value, isLeaf)
 */
export function walkTree(tree, callback) {
  function walk(node, pathArray) {
    for (const [key, value] of Object.entries(node)) {
      const currentPath = [...pathArray, key];
      const isLeaf = isLeafNode(value);

      callback(currentPath, value, isLeaf);

      if (!isLeaf && typeof value === "object" && value !== null) {
        walk(value, currentPath);
      }
    }
  }

  walk(tree, []);
}

/**
 * Filters tree, keeps only nodes that match predicate
 * @param {Object} tree Tree to filter
 * @param {Function} predicate Predicate(path, value, isLeaf) => boolean
 * @returns {Object} Filtered tree
 */
export function filterTree(tree, predicate) {
  function filter(node, pathArray) {
    const result = {};

    for (const [key, value] of Object.entries(node)) {
      const currentPath = [...pathArray, key];
      const isLeaf = isLeafNode(value);

      if (predicate(currentPath, value, isLeaf)) {
        if (isLeaf) {
          result[key] = value;
        } else if (typeof value === "object" && value !== null) {
          const filtered = filter(value, currentPath);
          if (Object.keys(filtered).length > 0) {
            result[key] = filtered;
          }
        }
      }
    }

    return result;
  }

  return filter(tree, []);
}

/**
 * Maps tree, transforms values with mapper function
 * @param {Object} tree Tree to map
 * @param {Function} mapper Mapper(path, value, isLeaf) => newValue
 * @returns {Object} Transformed tree
 */
export function mapTree(tree, mapper) {
  function map(node, pathArray) {
    const result = {};

    for (const [key, value] of Object.entries(node)) {
      const currentPath = [...pathArray, key];
      const isLeaf = isLeafNode(value);

      if (isLeaf) {
        result[key] = mapper(currentPath, value, isLeaf);
      } else if (typeof value === "object" && value !== null) {
        result[key] = map(value, currentPath);
      }
    }

    return result;
  }

  return map(tree, []);
}
