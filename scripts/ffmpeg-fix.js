// scripts/ffmpeg-fix.js
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const ffmpegCoreDistPath = path.join(projectRoot, 'node_modules', '@ffmpeg', 'core', 'dist');
const targetDirBase = path.join(projectRoot, 'node_modules', '@ffmpeg', 'ffmpeg', 'node_modules');
const targetFfmpegCoreDir = path.join(targetDirBase, '@ffmpeg', 'core');
const targetFfmpegCoreDistPath = path.join(targetFfmpegCoreDir, 'dist');

const filesToCopy = [
  'ffmpeg-core.js',
  'ffmpeg-core.wasm',
  'ffmpeg-core.worker.js',
];

function copyFile(source, target) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, target);
    console.log(`Copied ${source} to ${target}`);
  } else {
    console.warn(`Source file not found: ${source}`);
  }
}

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

try {
  console.log('Running ffmpeg-fix postinstall script...');

  // Check if source @ffmpeg/core/dist exists
  if (!fs.existsSync(ffmpegCoreDistPath)) {
    console.error(`Source directory not found: ${ffmpegCoreDistPath}. Make sure @ffmpeg/core is installed correctly.`);
    process.exit(0); // Exit gracefully if source is missing, npm install might fix it later.
  }
  
  // Check if node_modules/@ffmpeg/ffmpeg exists
  if (!fs.existsSync(path.join(projectRoot, 'node_modules', '@ffmpeg', 'ffmpeg'))) {
    console.log(`Path node_modules/@ffmpeg/ffmpeg not found. Skipping ffmpeg-fix script.`);
    process.exit(0);
  }

  // Ensure the target directory structure exists
  // node_modules/@ffmpeg/ffmpeg/node_modules/
  ensureDirExists(targetDirBase);
  // node_modules/@ffmpeg/ffmpeg/node_modules/@ffmpeg/
  ensureDirExists(path.join(targetDirBase, '@ffmpeg'));
  // node_modules/@ffmpeg/ffmpeg/node_modules/@ffmpeg/core/
  ensureDirExists(targetFfmpegCoreDir);
  // node_modules/@ffmpeg/ffmpeg/node_modules/@ffmpeg/core/dist/
  ensureDirExists(targetFfmpegCoreDistPath);

  filesToCopy.forEach(fileName => {
    const sourceFile = path.join(ffmpegCoreDistPath, fileName);
    const targetFile = path.join(targetFfmpegCoreDistPath, fileName);
    copyFile(sourceFile, targetFile);
  });

  console.log('ffmpeg-fix postinstall script completed.');
} catch (error) {
  console.error('Error during ffmpeg-fix postinstall script:', error);
  // Don't fail the install, but log the error
}
