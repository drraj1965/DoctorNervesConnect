
// scripts/ffmpeg-fix.js
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// Source: where @ffmpeg/core is actually installed by npm/yarn
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
    try {
      fs.copyFileSync(source, target);
      console.log(`✅ [ffmpeg-fix] Copied ${path.basename(source)} to ${target}`);
    } catch (copyError) {
      console.error(`❌ [ffmpeg-fix] FAILED to copy ${path.basename(source)} from ${source} to ${target}:`, copyError);
      process.exit(1); // Exit if a critical copy fails
    }
  } else {
    console.error(`❌ [ffmpeg-fix] Source file NOT FOUND: ${source}. Cannot copy.`);
    console.error("   This usually means @ffmpeg/core was not installed correctly or is missing its 'dist' files.");
    console.error("   Please ensure '@ffmpeg/core': '0.11.0' is in your package.json and run 'npm install' again after deleting node_modules and package-lock.json.");
    process.exit(1); // Exit if source file is missing
  }
}

function ensureDirExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`✅ [ffmpeg-fix] Created directory: ${dirPath}`);
    } catch (mkdirError) {
      console.error(`❌ [ffmpeg-fix] FAILED to create directory ${dirPath}:`, mkdirError);
      process.exit(1); // Exit if directory creation fails
    }
  }
}

try {
  console.log('🚀 [ffmpeg-fix] Starting postinstall script to fix FFmpeg paths...');
  console.log(`   Project root: ${projectRoot}`);
  console.log(`   Source for @ffmpeg/core/dist: ${ffmpegCoreSourceDistPath}`);
  console.log(`   Target for nested @ffmpeg/core/dist: ${targetCoreDistInSrcBrowserNodeModules}`);

  // 1. Check if the source @ffmpeg/core/dist exists
  if (!fs.existsSync(ffmpegCoreSourceDistPath)) {
    console.error(`❌ [ffmpeg-fix] CRITICAL: Source @ffmpeg/core/dist directory not found: ${ffmpegCoreSourceDistPath}.`);
    console.error("   Ensure '@ffmpeg/core': '0.11.0' is in package.json and dependencies are installed.");
    console.error("   Run: rm -rf node_modules package-lock.json && npm install");
    process.exit(1); // Critical error, cannot proceed
  } else {
    console.log(`   Source @ffmpeg/core/dist found at ${ffmpegCoreSourceDistPath}.`);
  }
  
  // 2. Check if the base @ffmpeg/ffmpeg/src/browser directory exists
  if (!fs.existsSync(srcBrowserDirectoryPath)) {
    console.warn(`⚠️ [ffmpeg-fix] Path ${srcBrowserDirectoryPath} not found. @ffmpeg/ffmpeg might not be installed or structured as expected. Attempting to continue but this is unusual.`);
    // Don't exit here, as the script's job is to create the nested structure if possible.
    // The ensureDirExists calls below will handle creating the necessary parent dirs.
  } else {
    console.log(`   Base @ffmpeg/ffmpeg/src/browser found at ${srcBrowserDirectoryPath}.`);
  }

  // 3. Ensure the deeply nested target directory structure exists
  console.log('   Ensuring target directory structure exists...');
  ensureDirExists(targetNodeModulesInSrcBrowser);
  ensureDirExists(targetAtFfmpegInSrcBrowserNodeModules);
  ensureDirExists(targetCoreInSrcBrowserNodeModules);
  ensureDirExists(targetCoreDistInSrcBrowserNodeModules);

  // 4. Copy the files
  console.log('   Copying FFmpeg core files...');
  filesToCopy.forEach(fileName => {
    const sourceFile = path.join(ffmpegCoreSourceDistPath, fileName);
    const targetFile = path.join(targetCoreDistInSrcBrowserNodeModules, fileName);
    copyFile(sourceFile, targetFile);
  });

  console.log('✅ [ffmpeg-fix] Postinstall script completed successfully.');
  console.log(`   Files should now be available in: ${targetCoreDistInSrcBrowserNodeModules}`);

} catch (error) {
  console.error('❌ [ffmpeg-fix] UNEXPECTED ERROR during postinstall script:', error);
  process.exit(1); // Exit with error for any other unexpected issue
}
