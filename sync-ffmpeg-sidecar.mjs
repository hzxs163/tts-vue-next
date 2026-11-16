import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");

const targetTripleByPlatform = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm": "arm-unknown-linux-gnueabihf",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-ia32": "i686-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-ia32": "i686-pc-windows-msvc",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function resolveTargetTriple() {
  const key = `${process.platform}-${process.arch}`;
  const targetTriple = targetTripleByPlatform[key];
  if (!targetTriple) {
    throw new Error(`Unsupported FFmpeg sidecar platform: ${key}`);
  }
  return targetTriple;
}

function resolveRequestedTarget(hostTriple) {
  const targetFlagIndex = process.argv.indexOf("--target");
  if (targetFlagIndex === -1) {
    return hostTriple;
  }

  const requested = process.argv[targetFlagIndex + 1];
  if (!requested) {
    throw new Error("--target requires a Rust target triple");
  }

  return requested;
}

function syncFFmpegSidecar() {
  const hostTriple = resolveTargetTriple();
  const targetTriple = resolveRequestedTarget(hostTriple);
  if (targetTriple !== hostTriple) {
    throw new Error(
      `Cannot produce the FFmpeg sidecar for ${targetTriple} on a ${hostTriple} host.\n` +
        "Build on the matching platform, or place a prebuilt " +
        `ffmpeg-${targetTriple} binary in src-tauri/binaries manually.`,
    );
  }

  const sourcePath = ffmpegInstaller.path;
  const extension = process.platform === "win32" ? ".exe" : "";
  const targetDir = path.join(repoRoot, "src-tauri", "binaries");
  const targetPath = path.join(targetDir, `ffmpeg-${targetTriple}${extension}`);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);

  console.log(`Synced FFmpeg sidecar to ${targetPath}`);
}

syncFFmpegSidecar();
