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
    // While opKapot has a tray icon, closing the window keeps it running there.
    const s = services?.state.getSettings();
    if (!quitting && s?.closeToTray && tray) {
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

function sendSettings() {
  mainWindow?.webContents.send('settings:changed', services.state.publicSettings());
}

function updateTray() {
  const s = services.state.getSettings();
  const gameOn = !!services.game.status().active;
  // Started with Windows, the tray icon is the way back into opKapot.
  const wanted = services.security.supported && (s.guardEnabled || gameOn || s.guardAutostart);
  if (!wanted) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.on('click', showWindow);
  }
  tray.setToolTip(`opKapot${gameOn ? ': Game Mode is on' : services.security.guard.enabled ? ': real-time Guard is on' : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open opKapot', click: showWindow },
    { type: 'separator' },
    {
      label: 'Game Mode',
      type: 'checkbox',
      checked: gameOn,
      click: () => toggleGameMode(),
    },
    {
      label: 'Real-time Guard',
      type: 'checkbox',
      checked: !!s.guardEnabled,
      click: (item) => {
        services.state.updateSettings({ guardEnabled: item.checked });
        services.security.applyGuardSettings();
        sendSettings();
        updateTray();
      },
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: !!s.guardAutostart,
      click: (item) => {
        services.autostart.set(item.checked).catch(() => {}).finally(() => {
          sendSettings();
          updateTray();
        });
      },
    },
    { type: 'separator' },
    { label: 'Quit opKapot', click: quit },
  ]));
}

/** Tray toggle: uses the choices saved on the Game Mode page. */
async function toggleGameMode() {
  const g = services.game;
  try {
    if (g.status().active) await g.disable();
    else {
      const plan = await g.plan();
      await g.enable({ apps: plan.apps.filter((a) => a.checked).map((a) => a.id), services: plan.services.filter((x) => x.checked).map((x) => x.name) });
    }
  } catch { /* the page shows errors; the tray stays quiet */ }
  mainWindow?.webContents.send('game:status', g.status());
  updateTray();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    services = registerIpc({ getWindow: () => mainWindow, demo, onGuardSettingsChanged: () => updateTray(), onGameModeChanged: () => updateTray() });
    services.security.applyGuardSettings();
    updateTray();
    // Started with Windows: stay in the tray (or show the window if there's no tray to come back to).
    createWindow({ show: !background || !tray });
    app.on('activate', showWindow);
    // Turn on "start with Windows" for a new install and keep the task pointing at this exe.
    services.autostart.sync().then((changed) => {
      if (!changed) return;
      sendSettings();
      updateTray();
    }).catch(() => {});
  });

  let restoring = false;
  app.on('before-quit', (event) => {
    quitting = true;
    cancelAll();
    // Quitting while Game Mode is on puts services and the power plan back first.
    if (services?.game.status().active && !restoring) {
      restoring = true;
      event.preventDefault();
      services.game.disable().catch(() => {}).finally(() => app.quit());
    }
  });
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
}
