'use strict';

const path = require('node:path');
const { JsonStore } = require('../lib/store');

const DEFAULT_SETTINGS = {
  deleteMode: 'trash',            // 'trash' | 'permanent'
  restorePoint: false,            // create a System Restore point before uninstalling
  scanLeftovers: true,            // look for leftovers after uninstalling
  autoRemoveLeftovers: false,     // remove high-confidence leftovers without asking
  quietUninstall: false,          // use silent uninstall switches when available
  showSystemComponents: false,
  tempMinAgeHours: 24,
  largeFileThresholdMB: 100,
  maxFileResults: 100000,
  excludeSystemFolders: true,
  skipHidden: false,
  guardEnabled: true,             // real-time Guard: watch for new connections, startup items, camera/mic use
  guardIntervalSec: 30,
  guardAutostart: false,          // start opKapot when Windows starts (mirrors the scheduled task)
  autostartDefaulted: false,      // starting with Windows was turned on once for a new install
  closeToTray: true,              // keep running in the tray when the window is closed
  virusTotalKeyEnc: '',           // encrypted with Windows DPAPI via Electron safeStorage
};

// Settings the page may not change directly (they have dedicated handlers).
const PRIVATE_SETTINGS = new Set(['virusTotalKeyEnc', 'guardAutostart', 'autostartDefaulted']);

const HISTORY_LIMIT = 500;

function createState(userDataDir) {
  const settings = new JsonStore(path.join(userDataDir, 'settings.json'), DEFAULT_SETTINGS);
  const history = new JsonStore(path.join(userDataDir, 'history.json'), []);

  return {
    backupDir: path.join(userDataDir, 'registry-backups'),

    getSettings: () => settings.get(),

    /** Settings as the page sees them: secrets removed. */
    publicSettings() {
      const { virusTotalKeyEnc, ...rest } = settings.get();
      return { ...rest, hasVirusTotalKey: !!virusTotalKeyEnc };
    },

    updateFromPage(patch) {
      const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => !PRIVATE_SETTINGS.has(k)));
      this.updateSettings(clean);
      return this.publicSettings();
    },

    updateSettings(patch) {
      const next = { ...settings.get() };
      for (const [key, value] of Object.entries(patch || {})) {
        if (!(key in DEFAULT_SETTINGS)) continue;
        if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue;
        next[key] = value;
      }
      return settings.set(next);
    },

    listHistory: () => history.get(),

    addHistory(entry) {
      const list = [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, date: Date.now(), ...entry }, ...history.get()];
      history.set(list.slice(0, HISTORY_LIMIT));
    },

    clearHistory: () => history.set([]),
  };
}

module.exports = { createState, DEFAULT_SETTINGS };
