// This file is copied to build/electron.js before packaging/dev launch.
// All paths are relative to the build/ directory (__dirname = build/).
const { app, BrowserWindow } = require('electron');
const path = require('path');

// Windows hybrid graphics: ask the OS for the high-performance GPU (e.g. GeForce)
// before Chromium initializes ANGLE/WebGL. Must run before app.ready.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('force_high_performance_gpu');
}

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    // In dev: build/ doesn't have logo yet, so look in public/
    // In prod: CRA copies public/ into build/, so logo512.png is in build/
    icon: isDev
      ? path.join(__dirname, '../public/logo512.png')
      : path.join(__dirname, 'logo512.png'),
    title: 'GameLab',
  });

  if (isDev) {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    // build/index.html is in the same directory as build/electron.js
    win.loadFile(path.join(__dirname, 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
