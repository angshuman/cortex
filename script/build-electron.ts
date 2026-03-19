/**
 * Build script for Electron desktop app.
 * 
 * Steps:
 * 1. Build the web client (Vite) → dist/public/
 * 2. Build the Express server → dist/index.cjs
 * 3. Compile Electron main + preload → dist/electron/
 * 
 * After this, run `npx electron-builder` to package.
 */
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, mkdir, cp } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// Server deps to bundle (same as main build.ts)
const serverAllowlist = [
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "@modelcontextprotocol/sdk",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "dotenv",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  console.log("=== Cortex Electron Build ===\n");

  // Clean dist
  await rm("dist", { recursive: true, force: true });

  // 1. Build client
  console.log("1/3  Building client (Vite)...");
  await viteBuild();

  // 2. Build server
  console.log("2/3  Building server (esbuild)...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !serverAllowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // 3. Build Electron main + preload
  console.log("3/3  Building Electron main process...");
  await esbuild({
    entryPoints: ["electron/main.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/electron/main.js",
    minify: false,
    external: ["electron"],
    logLevel: "info",
  });

  await esbuild({
    entryPoints: ["electron/preload.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/electron/preload.js",
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
  console.log("  dist/index.cjs      → Express server bundle");
  console.log("  dist/electron/      → Electron main + preload");
  console.log("\nRun `npx electron-builder` to package the desktop app.");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
