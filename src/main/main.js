'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const { registerIpc } = require('./ipc');
const { cancelAll } = require('./services/jobs');

const demo = process.argv.includes('--demo') || process.env.OPKAPOT_DEMO === '1';
const background = process.argv.includes('--background');
const ICON = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');

// Keep settings, history and quarantine where 1.x stored them.
app.setPath('userData', path.join(app.getPath('appData'), 'opKapot Uninstaller'));
app.setAppUserModelId('com.opkapot.uninstaller');

let mainWindow = null;
let tray = null;
let quitting = false;
let services = null;

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 1000,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#121212',
    title: 'opKapot',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (show) mainWindow.show();
  });
  const sendMaximized = () => mainWindow.webContents.send('win:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMaximized);
  mainWindow.on('unmaximize', sendMaximized);
  mainWindow.on('close', (event) => {
    // With the Guard on, closing the window keeps protection running in the tray.
    const s = services?.state.getSettings();
    if (!quitting && s?.closeToTray && services?.security.guard.enabled) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // The UI is local-only: never navigate away or open new windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function showWindow() {
  if (!mainWindow) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function quit() {
  quitting = true;
  app.quit();
}

function updateTray() {
  const s = services.state.getSettings();
  const wanted = services.security.supported && s.guardEnabled;
  if (!wanted) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.on('click', showWindow);
  }
  tray.setToolTip(`opKapot${services.security.guard.enabled ? ': real-time Guard is on' : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open opKapot', click: showWindow },
    { type: 'separator' },
    {
      label: 'Real-time Guard',
      type: 'checkbox',
      checked: !!s.guardEnabled,
      click: (item) => {
        services.state.updateSettings({ guardEnabled: item.checked });
        services.security.applyGuardSettings();
        mainWindow?.webContents.send('settings:changed', services.state.publicSettings());
        updateTray();
      },
    },
    { type: 'separator' },
    { label: 'Quit opKapot', click: quit },
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    services = registerIpc({ getWindow: () => mainWindow, demo, onGuardSettingsChanged: () => updateTray() });
    services.security.applyGuardSettings();
    createWindow({ show: !background });
    updateTray();
    app.on('activate', showWindow);
  });

  app.on('before-quit', () => {
    quitting = true;
    cancelAll();
  });
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
}
