import http from "http";
import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import { build, buildIncremental } from "./build.js";
import { loadConfig } from "./index.js";

/**
 * Starts development server with file watching and hot rebuild
 */
export async function dev(options = {}) {
  const config = {
    root: options.root || ".",
    output: options.output || "./build",
    port: options.port || 3000,
    host: options.host || "localhost",
    open: options.open !== false,
    verbose: options.verbose || false,
  };

  console.log("Starting development server...\n");

  try {
    const result = await build({
      root: config.root,
      output: config.output,
      clean: true,
      verbose: config.verbose,
    });

    if (!result.success) {
      console.error("\n✗ Initial build failed");
      result.errors.forEach((err) => console.error(`  ${err}`));
      process.exit(1);
    }

    console.log(
      `\n✓ Built ${result.pageCount} pages in ${(
        result.duration / 1000
      ).toFixed(2)}s\n`
    );
  } catch (error) {
    console.error("✗ Initial build failed:", error.message);
    process.exit(1);
  }

  const server = startServer({
    root: config.output,
    port: config.port,
    host: config.host,
  });

  console.log(`✓ Server running at http://${config.host}:${config.port}`);
  console.log("✓ Watching for changes...\n");

  const userConfig = await loadConfig(config.root);
  const srcDir = path.resolve(config.root, userConfig.src || "./src");
  const watchPaths = [srcDir];

  const debouncedRebuild = debounce(async (changedPath) => {
    console.log(`\nFile changed: ${path.relative(config.root, changedPath)}`);

    try {
      const result = await buildIncremental(changedPath, {
        root: config.root,
        output: config.output,
        verbose: config.verbose,
      });

      if (result.success) {
        if (result.pageCount > 0) {
          console.log(
            `✓ Rebuilt ${result.pageCount} page(s) in ${(
              result.duration / 1000
            ).toFixed(2)}s`
          );
        } else if (result.assetCount > 0) {
          console.log(
            `✓ Copied ${result.assetCount} asset(s) in ${(
              result.duration / 1000
            ).toFixed(2)}s`
          );
        }

        server.notifyReload();
      } else {
        console.error("✗ Rebuild failed");
        result.errors.forEach((err) => console.error(`  ${err}`));
      }
    } catch (error) {
      console.error("✗ Rebuild failed:", error.message);
    }
  }, 100);

  const watcher = watchFiles({ paths: watchPaths }, debouncedRebuild);

  const cleanup = () => {
    console.log("\n\nShutting down...");
    watcher.close();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return {
    close: cleanup,
    server,
    watcher,
  };
}

/**
 * Starts static file server
 */
export function startServer(options = {}) {
  const config = {
    root: options.root || "./build",
    port: options.port || 3000,
    host: options.host || "localhost",
  };

  const reloadClients = [];

  const send404 = (res) => {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 Not Found");
  };

  const server = http.createServer((req, res) => {
    if (req.url === "/__reload") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      reloadClients.push(res);

      req.on("close", () => {
        const index = reloadClients.indexOf(res);
        if (index !== -1) {
          reloadClients.splice(index, 1);
        }
      });

      return;
    }

    let filePath = path.join(config.root, req.url);

    if (filePath.endsWith("/") || filePath.endsWith("\\")) {
      filePath = path.join(filePath, "index.html");
    }

    if (!fs.existsSync(filePath)) {
      send404(res);
      return;
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      if (!fs.existsSync(filePath)) {
        send404(res);
        return;
      }
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html",
      ".pdf": "application/pdf",
      ".css": "text/css",
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".wasm": "application/wasm",
      ".ico": "image/x-icon",
    };

    const contentType = contentTypes[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });

    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(config.port, config.host);

  server.notifyReload = () => {
    reloadClients.forEach((client) => {
      client.write("data: reload\n\n");
    });
  };

  return server;
}

/**
 * Watches files for changes
 */
export function watchFiles(options = {}, onChange) {
  const config = {
    paths: options.paths || ["."],
    ignored: options.ignored || [
      "**/node_modules/**",
      "**/.git/**",
      "**/build/**",
    ],
  };

  const watcher = chokidar.watch(config.paths, {
    ignored: config.ignored,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  watcher.on("change", onChange);
  watcher.on("add", onChange);
  watcher.on("unlink", onChange);

  return watcher;
}

function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
