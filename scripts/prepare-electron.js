// Copies electron/main.js into build/electron.js so electron-builder can find it.
// Run this before launching Electron in dev mode or before electron-builder packages.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'electron', 'main.js'),
  path.join(root, 'build', 'electron.js')
);
console.log('Copied electron/main.js -> build/electron.js');
