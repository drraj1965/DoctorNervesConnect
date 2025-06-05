
// scripts/ffmpeg-fix.js
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// Source: where @ffmpeg/core is actually installed by npm/yarn (e.g., node_modules/@ffmpeg/core/dist)
const ffmpegCoreSourceDistPath = path.join(projectRoot, 'node_modules', '@ffmpeg', 'core', 'dist');

// Target: The path implied by the error message, relative to where @ffmpeg/ffmpeg is trying to import from.
// Error originates from: @ffmpeg/ffmpeg/src/browser
// It tries to resolve: './node_modules/@ffmpeg/core/dist/ffmpeg-core.js'
// So, the target is: [PROJECT_ROOT]/node_modules/@ffmpeg/ffmpeg/src/browser/node_modules/@ffmpeg/core/dist/
const ffmpegPackagePath = path.join(projectRoot, 'node_modules', '@ffmpeg', 'ffmpeg');
const srcBrowserDirectoryPath = path.join(ffmpegPackagePath, 'src', 'browser');
const targetNodeModulesInSrcBrowser = path.join(srcBrowserDirectoryPath, 'node_modules');
const targetAtFfmpegInSrcBrowserNodeModules = path.join(targetNodeModulesInSrcBrowser, '@ffmpeg');
const targetCoreInSrcBrowserNodeModules = path.join(targetAtFfmpegInSrcBrowserNodeModules, 'core');
const targetCoreDistInSrcBrowserNodeModules = path.join(targetCoreInSrcBrowserNodeModules, 'dist');

const filesToCopy = [
  'ffmpeg-core.js',
  'ffmpeg-core.wasm',
  'ffmpeg-core.worker.js',
];

function copyFile(source, target) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, target);
    console.log(`Copied ${path.basename(source)} to ${target}`);
  } else {
    console.warn(`Source file not found: ${source}. Cannot copy.`);
  }
}

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

try {
  console.log('Running ffmpeg-fix postinstall script (targeting path relative to @ffmpeg/ffmpeg/src/browser)...');

  // 1. Check if the source @ffmpeg/core/dist exists
  if (!fs.existsSync(ffmpegCoreSourceDistPath)) {
    console.error(`Source @ffmpeg/core/dist directory not found: ${ffmpegCoreSourceDistPath}.`);
    console.error('Make sure @ffmpeg/core is installed correctly. Skipping ffmpeg-fix.');
    process.exit(0); 
  }
  
  // 2. Check if the path node_modules/@ffmpeg/ffmpeg/src/browser exists, as we need to create subdirs within it.
  if (!fs.existsSync(srcBrowserDirectoryPath)) {
    console.warn(`Path ${srcBrowserDirectoryPath} not found. @ffmpeg/ffmpeg might not be installed or structured as expected. Skipping ffmpeg-fix script.`);
    process.exit(0);
  }

  // 3. Ensure the deeply nested target directory structure exists
  ensureDirExists(targetNodeModulesInSrcBrowser);
  ensureDirExists(targetAtFfmpegInSrcBrowserNodeModules);
  ensureDirExists(targetCoreInSrcBrowserNodeModules);
  ensureDirExists(targetCoreDistInSrcBrowserNodeModules);

  // 4. Copy the files
  filesToCopy.forEach(fileName => {
    const sourceFile = path.join(ffmpegCoreSourceDistPath, fileName);
    const targetFile = path.join(targetCoreDistInSrcBrowserNodeModules, fileName);
    copyFile(sourceFile, targetFile);
  });

  console.log('ffmpeg-fix postinstall script (targeting path relative to @ffmpeg/ffmpeg/src/browser) completed.');
  console.log(`Files should now be available in: ${targetCoreDistInSrcBrowserNodeModules}`);

} catch (error) {
  console.error('Error during ffmpeg-fix postinstall script (targeting path relative to @ffmpeg/ffmpeg/src/browser):', error);
  // Don't fail the install, but log the error. The user will see this.
}
