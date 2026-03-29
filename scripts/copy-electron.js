/**
 * copy-electron.js
 * Copies the Electron main process files into the build/ folder
 * so electron-builder packages them alongside the React output.
 * 
 * Run automatically as part of: npm run build:win / build:mac
 */

const fs   = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const SRC_MAIN  = path.join(__dirname, '..', 'src', 'main');

// Make sure build/ exists (react-scripts creates it, but just in case)
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

const filesToCopy = [
  { from: path.join(SRC_MAIN, 'main.js'),             to: path.join(BUILD_DIR, 'electron.js') },
  { from: path.join(SRC_MAIN, 'preload.js'),          to: path.join(BUILD_DIR, 'preload.js') },
  { from: path.join(SRC_MAIN, 'automationEngine.js'), to: path.join(BUILD_DIR, 'automationEngine.js') },
  { from: path.join(SRC_MAIN, 'aiService.js'),        to: path.join(BUILD_DIR, 'aiService.js') },
  { from: path.join(SRC_MAIN, 'specRunner.js'),       to: path.join(BUILD_DIR, 'specRunner.js') },
  { from: path.join(SRC_MAIN, 'updateChecker.js'),    to: path.join(BUILD_DIR, 'updateChecker.js') },
];

for (const { from, to } of filesToCopy) {
  if (!fs.existsSync(from)) {
    console.error(`[copy-electron] ERROR: Source file not found: ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
  console.log(`[copy-electron] Copied: ${path.basename(from)} → build/${path.basename(to)}`);
}

// Patch electron.js (the copied main.js) so its internal require paths
// point to the build/ folder instead of src/main/
const electronJsPath = path.join(BUILD_DIR, 'electron.js');
let content = fs.readFileSync(electronJsPath, 'utf8');

// Fix preload path — in production it lives in build/ alongside electron.js
content = content.replace(
  /path\.join\(__dirname,\s*['"]preload\.js['"]\)/g,
  `path.join(__dirname, 'preload.js')`
);

// Fix require paths for automationEngine and aiService
content = content.replace(/require\(['"]\.\/automationEngine['"]\)/g, `require('./automationEngine')`);
content = content.replace(/require\(['"]\.\/aiService['"]\)/g,        `require('./aiService')`);

fs.writeFileSync(electronJsPath, content, 'utf8');
console.log('[copy-electron] Patched require paths in electron.js');
console.log('[copy-electron] Done — Electron main files ready in build/');
