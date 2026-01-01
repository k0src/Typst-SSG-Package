/**
 * Pipeline utils for object transformations and routing
 */

import path from "path";

/**
 * Maps over object entries, transforms keys and values
 * @param {Object} obj Object to map
 * @param {Function} fn Mapper function (value, key, obj) => newValue
 * @returns {Object} New object with transformed values
 */
export function mapObject(obj, fn) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = fn(value, key, obj);
  }
  return result;
}

/**
 * Maps over object values, preserves keys
 * @param {Object} obj Object to map
 * @param {Function} fn Mapper function (value) => newValue
 * @returns {Object} New object with transformed values
 */
export function mapValues(obj, fn) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = fn(value);
  }
  return result;
}

/**
 * Filters object entries based on predicate
 * @param {Object} obj Object to filter
 * @param {Function} predicate Predicate function (value, key) => boolean
 * @returns {Object} New object with filtered entries
 */
export function filterObject(obj, predicate) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (predicate(value, key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Converts file path array to route string
 * @param {string[]} filePath Path array (e.g., ['blog', 'post.typ'])
 * @returns {string} Route string (e.g., '/blog/post/')
 */
export function pathToRoute(filePath) {
  if (!Array.isArray(filePath) || filePath.length === 0) {
    return "/";
  }

  const filename = filePath[filePath.length - 1];
  const isIndex = filename === "index.typ";

  if (isIndex) {
    const parentPath = filePath.slice(0, -1);
    if (parentPath.length === 0) {
      return "/";
    }
    return "/" + parentPath.join("/") + "/";
  } else {
    const stem = path.basename(filename, path.extname(filename));
    const dirPath = filePath.slice(0, -1);

    if (dirPath.length === 0) {
      return "/" + stem + "/";
    }
    return "/" + dirPath.join("/") + "/" + stem + "/";
  }
}

/**
 * Convert route to build output paths
 * @param {string} route - Route string (e.g., '/blog/post/')
 * @returns {Object} Build paths { dir, pdfPath, htmlPath }
 */
export function routeToBuildPath(route) {
  let cleanRoute = route.replace(/^\/+|\/+$/g, "");

  if (cleanRoute === "") {
    return {
      dir: "",
      pdfPath: "index.pdf",
      htmlPath: "index.html",
    };
  }

  return {
    dir: cleanRoute,
    pdfPath: cleanRoute + "/index.pdf",
    htmlPath: cleanRoute + "/index.html",
  };
}
