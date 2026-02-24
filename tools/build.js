import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
		platform: "node", // <-- Tells esbuild this is for Node.js
		packages: "external", // <-- Prevents bundling node_modules like jsdom
		sourcemap: true,
	});

	// Build CJS version
	await esbuild.build({
		entryPoints: [path.join(rootDir, "src/index.js")],
		bundle: true,
		format: "cjs",
		outfile: path.join(distDir, "svgnest.cjs"),
		platform: "node",
		packages: "external",
		sourcemap: true,
	});

	// Build standalone Worker
	await esbuild.build({
		entryPoints: [path.join(rootDir, "src/util/nestWorker.js")],
		bundle: true,
		format: "esm",
		outfile: path.join(distDir, "nestWorker.js"),
		platform: "node",
		packages: "external",
		target: "node18",
	});

	console.log("Build complete! Files are in dist/");
}

build().catch((err) => {
	console.error(err);
	process.exit(1);
});
