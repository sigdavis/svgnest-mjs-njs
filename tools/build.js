import esbuild from "esbuild";
import fs from "fs";
import path from "path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

async function build() {
  // Build ESM version
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/index.js")],
    bundle: true,
    format: "esm",
    outfile: path.join(distDir, "svgnest.mjs"),
    platform: "browser",
    sourcemap: true,
    external: ["url", "path", "web-worker"],
  });

  // Build CJS version
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/index.js")],
    bundle: true,
    format: "cjs",
    outfile: path.join(distDir, "svgnest.cjs"),
    platform: "browser",
    sourcemap: true,
    external: ["url", "path", "web-worker"],
  });

  // Build standalone Worker
  await esbuild.build({
    entryPoints: [path.join(rootDir, "src/util/nestWorker.js")],
    bundle: true,
    format: "iife",
    outfile: path.join(distDir, "nestWorker.js"),
    platform: "browser",
    target: "esnext",
  });

  console.log("Build complete! Files are in dist/");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
