// scripts/copy-ffmpeg-core.js
const fs = require("fs");
const path = require("path");

const srcDir = path.join(__dirname, "../node_modules/@ffmpeg/core/dist");
const destDir = path.join(__dirname, "../public/ffmpeg");

const files = ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"];

if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

files.forEach(file => {
  const src = path.join(srcDir, file);
  const dest = path.join(destDir, file);
  fs.copyFileSync(src, dest);
  console.log(`✅ Copied ${file} to /public/ffmpeg/`);
});