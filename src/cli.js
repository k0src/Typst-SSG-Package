#!/usr/bin/env node

import { Command } from "commander";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "./build.js";
import { dev } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
);
const program = new Command();

function copyTemplateFile(templateDir, targetDir, fromPath, toPath) {
  const sourcePath = path.join(templateDir, fromPath);
  const destPath = path.join(targetDir, toPath);

  if (fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, destPath);
    console.log(`✓ Created ${toPath}`);
    return true;
  }
  return false;
}

program
  .name("tssg")
  .description(
    "Typst Static Site Generator - Build beautiful static sites with Typst"
  )
  .version(packageJson.version);

program
  .command("build")
  .description("Build the static site")
  .option(
    "-r, --root <path>",
    "Root directory containing pages/ and assets/",
    "."
  )
  .option("-o, --output <path>", "Output directory for built site", "./build")
  .option("--no-clean", "Skip cleaning output directory before build")
  .option("-v, --verbose", "Show detailed build output", false)
  .action(async (options) => {
    console.log("Building static site...\n");

    try {
      const result = await build({
        root: options.root,
        output: options.output,
        clean: options.clean,
        verbose: options.verbose,
      });

      if (result.success) {
        console.log(
          `\n✓ Built ${result.pageCount} page(s) and ${
            result.assetCount
          } asset(s) in ${(result.duration / 1000).toFixed(2)}s`
        );
        console.log(`✓ Output: ${path.resolve(options.output)}`);
        process.exit(0);
      } else {
        console.error("\n✗ Build failed with errors:");
        result.errors.forEach((err) => console.error(`  ${err}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(`\n✗ Build failed: ${error.message}`);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command("dev")
  .description("Start development server with hot reload")
  .option(
    "-r, --root <path>",
    "Root directory containing pages/ and assets/",
    "."
  )
  .option("-o, --output <path>", "Output directory for built site", "./build")
  .option("-p, --port <number>", "Port for development server", "3000")
  .option(
    "-h, --host <address>",
    "Host address for development server",
    "localhost"
  )
  .option("--no-open", "Do not open browser automatically")
  .option("-v, --verbose", "Show detailed build output", false)
  .action(async (options) => {
    try {
      await dev({
        root: options.root,
        output: options.output,
        port: parseInt(options.port, 10),
        host: options.host,
        open: options.open,
        verbose: options.verbose,
      });
    } catch (error) {
      console.error(`\n✗ Dev server failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command("init [directory]")
  .description("Initialize a new Typst site")
  .action((directory) => {
    const targetDir = directory ? path.resolve(directory) : process.cwd();
    const projectName = directory || path.basename(targetDir);

    console.log(`Initializing new Typst site in ${targetDir}...\n`);

    if (fs.existsSync(targetDir)) {
      const files = fs.readdirSync(targetDir);
      if (files.length > 0) {
        console.error("✗ Directory is not empty. Use an empty directory.");
        process.exit(1);
      }
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const templateDir = path.join(__dirname, "templates", "init");

    const srcDir = path.join(targetDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    console.log(`✓ Created src/`);

    const dirs = ["pages", "assets", "util"];
    dirs.forEach((dir) => {
      const dirPath = path.join(srcDir, dir);
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`✓ Created src/${dir}/`);
    });

    const filesToCopy = [
      { from: "pages/index.typ", to: "src/pages/index.typ" },
      { from: "pages/home.typ", to: "src/pages/home.typ" },
      { from: "pages/about.typ", to: "src/pages/about.typ" },
      { from: "util/util.typ", to: "src/util/util.typ" },
      { from: "tssg.config.js", to: "tssg.config.js" },
      { from: ".gitignore", to: ".gitignore" },
      { from: "assets/.gitkeep", to: "src/assets/.gitkeep" },
    ];

    filesToCopy.forEach(({ from, to }) => {
      copyTemplateFile(templateDir, targetDir, from, to);
    });

    const packageJson = {
      name: projectName,
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "tssg dev",
        build: "tssg build",
      },
    };

    fs.writeFileSync(
      path.join(targetDir, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );
    console.log("✓ Created package.json");

    const readmeTemplate = fs.readFileSync(
      path.join(templateDir, "README.md"),
      "utf-8"
    );
    const readme = readmeTemplate.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
    fs.writeFileSync(path.join(targetDir, "README.md"), readme);
    console.log("✓ Created README.md");

    console.log("\n✓ Site initialized successfully\n");
    if (directory) {
      console.log(`  cd ${directory}`);
    }
    console.log("  npm install typst-ssg");
    console.log("  npm run dev\n");
  });

program.parse();
