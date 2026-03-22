/**
 * Build script for Electron desktop app.
 * 
 * Steps:
 * 1. Build the web client (Vite) → dist/public/
 * 2. Build the Express server → dist/index.cjs (fully self-contained, no externals)
 * 3. Compile Electron main + preload → dist/electron/
 * 
 * Unlike the regular build, the Electron server bundle has NO externals
 * (except Node.js built-ins) so the packaged app works without node_modules.
 */
import { build as esbuild, BuildOptions } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, mkdir, cp } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

async function buildAll() {
  console.log("=== Cortex Electron Build ===\n");

  // Clean dist
  await rm("dist", { recursive: true, force: true });

  // 1. Build client
  console.log("1/3  Building client (Vite)...");
  await viteBuild();

  // 2. Build server — fully bundled, no externals
  // The server bundle must be completely self-contained since the Electron
  // app doesn't ship node_modules. Only Node.js built-in modules are external.
  console.log("2/3  Building server (esbuild, fully bundled)...");

  const serverOpts: BuildOptions = {
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    // No external deps — everything is bundled into a single file.
    // This makes the server completely self-contained.
    external: [],
    logLevel: "info",
    // Suppress warnings for dynamic requires in deps (express, etc.)
    logOverride: {
      "commonjs-variable-in-esm": "silent",
    },
  };

  await esbuild(serverOpts);

  // 3. Build Electron main + preload
  console.log("3/3  Building Electron main process...");
  await esbuild({
    entryPoints: ["electron/main.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/electron/main.cjs",
    minify: false,
    external: ["electron"],
    logLevel: "info",
  });

  await esbuild({
    entryPoints: ["electron/preload.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/electron/preload.cjs",
    minify: false,
    external: ["electron"],
    logLevel: "info",
  });

  // Copy icons if they exist
  const iconsDir = path.resolve("electron/icons");
  if (existsSync(iconsDir)) {
    await mkdir("dist/icons", { recursive: true });
    await cp(iconsDir, "dist/icons", { recursive: true });
  }

  console.log("\n=== Build complete ===");
  console.log("  dist/public/        → Client assets");
  console.log("  dist/index.cjs      → Express server bundle (self-contained)");
  console.log("  dist/electron/      → Electron main.cjs + preload.cjs");
  console.log("\nRun `npx electron-builder` to package the desktop app.");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
