'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');
const { registerIpc } = require('./ipc');
const { cancelAll } = require('./services/jobs');

const demo = process.argv.includes('--demo') || process.env.OPKAPOT_DEMO === '1';
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#121212',
    title: 'opKapot Uninstaller',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  const sendMaximized = () => mainWindow.webContents.send('win:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMaximized);
  mainWindow.on('unmaximize', sendMaximized);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // The UI is local-only: never navigate away or open new windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    registerIpc({ getWindow: () => mainWindow, demo });
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });

  app.on('before-quit', cancelAll);
  app.on('window-all-closed', () => app.quit());
}
