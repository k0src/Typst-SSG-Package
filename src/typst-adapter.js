import { spawnSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Cleans up the input file
 * @param {string} inputPath Path to the input file
 */
function cleanupInputFile(inputPath) {
  try {
    if (fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }
  } catch (error) {
    console.warn(`Could not clean up input file: ${error.message}`);
  }
}

/**
 * Checks if Typst is installed
 * @returns {Object} { installed: boolean, version: string | null }
 */
export function checkTypstInstalled() {
  try {
    const result = spawnSync("typst", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });

    if (result.error) {
      return { installed: false, version: null };
    }

    if (result.status !== 0) {
      return { installed: false, version: null };
    }

    const versionMatch = result.stdout.match(/typst\s+([\d.]+)/i);
    const version = versionMatch ? versionMatch[1] : result.stdout.trim();

    return { installed: true, version: version };
  } catch (error) {
    return { installed: false, version: null };
  }
}

/**
 * Creates a temporary directory
 * @param {string} prefix Prefix for the temp directory name
 * @param {string | null} baseDir Base directory for temp directory (default: system temp)
 * @returns {string} Path to the created temp directory
 */
export function createTempDir(prefix = "tssg-", baseDir = null) {
  const tempBase = baseDir || os.tmpdir();
  return fs.mkdtempSync(path.join(tempBase, prefix));
}

/**
 * Cleans up a temporary directory
 * @param {string} tempDir Path to the temp directory
 */
export function cleanupTempDir(tempDir) {
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(
      `Could not clean up temp directory ${tempDir}: ${error.message}`
    );
  }
}

/**
 * Compiles Typst source to PDF
 * @param {Object} options Compilation options
 * @param {string} options.source Typst source code
 * @param {string} options.outputPath Path to output PDF file
 * @param {string} options.workDir Working directory for compilation
 * @param {string | null} options.rootDir Root directory for Typst (optional)
 * @param {number} options.timeout Timeout in milliseconds (default: 30000)
 * @returns {Promise<Object>} { success: boolean, outputPath: string, error?: string }
 */
export async function compileTypst({
  source,
  outputPath,
  workDir,
  rootDir = null,
  timeout = 30000,
}) {
  return new Promise((resolve, reject) => {
    const inputPath = path.join(workDir, "input.typ");

    try {
      fs.writeFileSync(inputPath, source, "utf-8");
    } catch (error) {
      return reject(new Error(`Failed to write input file: ${error.message}`));
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      try {
        fs.mkdirSync(outputDir, { recursive: true });
      } catch (error) {
        return reject(
          new Error(`Failed to create output directory: ${error.message}`)
        );
      }
    }

    const args = ["compile"];

    if (rootDir) {
      args.push("--root", rootDir);
    }
    args.push("input.typ", outputPath);

    const child = spawn("typst", args, {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      cleanupInputFile(inputPath);

      if (timedOut) {
        return resolve({
          success: false,
          outputPath,
          error: `Compilation timed out after ${timeout}ms`,
        });
      }

      if (code !== 0) {
        const errorMessage =
          stderr || stdout || `Typst exited with code ${code}`;
        return resolve({
          success: false,
          outputPath,
          error: errorMessage.trim(),
        });
      }

      resolve({
        success: true,
        outputPath,
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      cleanupInputFile(inputPath);
      reject(new Error(`Failed to spawn Typst process: ${error.message}`));
    });
  });
}
