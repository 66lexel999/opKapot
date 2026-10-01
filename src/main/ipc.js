'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, ipcMain, shell, dialog, nativeImage, clipboard, Notification } = require('electron');

const { createState } = require('./services/state');
const { ProgramService } = require('./services/programs');
const { createDemoProvider } = require('./services/programs/demo');
const { JunkService } = require('./services/junk');
const { listDrives } = require('./services/drives');
const files = require('./services/files');
const { cancelJob } = require('./services/jobs');
const registry = require('./lib/registry');
const { sleep } = require('./services/programs/common');
const { SecurityService } = require('./security/service');
const { registerSecurityIpc } = require('./security/ipc');
const { GameService } = require('./game/service');
const { registerGameIpc } = require('./game/ipc');
const { Autostart } = require('./services/autostart');
const { runPs } = require('./security/runner');

const isWin = process.platform === 'win32';

const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

/** A full path on a local drive. Network (UNC) paths are refused so a click never contacts another computer. */
const isLocalPath = (p) => typeof p === 'string' && p.length < 4096 && !p.includes('\0')
  && (isWin ? /^[a-z]:[\\/]/i.test(p) : p.startsWith('/') && !p.startsWith('//'));

function registerIpc({ getWindow, demo, onGuardSettingsChanged = () => {}, onGameModeChanged = () => {} }) {
  const state = createState(app.getPath('userData'));
  const demoProvider = demo ? createDemoProvider() : null;
  const trash = (p) => shell.trashItem(p);
  const programs = new ProgramService({ demoProvider, trash });
  const windowsPrograms = isWin ? require('./services/programs/windows') : null;
  const windowsApps = isWin ? require('./services/windowsApps') : null;

  let sid = null;
  const junk = new JunkService({
    getSettings: state.getSettings,
    getRecycleRoots: async () => {
      if (!isWin) return [];
      sid ??= windowsPrograms.currentUserSid();
      const userSid = await sid;
      if (!userSid) return [];
      return (await listDrives()).map((d) => path.join(d.path, '$Recycle.Bin', userSid));
    },
  });

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  const handle = (channel, fn) => ipcMain.handle(channel, (_event, ...args) => fn(...args));
  const jobProgress = (jobId) => (data) => send('job:progress', { jobId, data });

  const notify = (alert) => {
    if (alert.severity === 'notice' || !Notification.isSupported()) return;
    const n = new Notification({ title: alert.title, body: alert.body || '', icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png') });
    n.on('click', () => {
      const win = getWindow();
      if (!win) return;
      win.show();
      win.focus();
      if (alert.view) send('app:navigate', alert.view);
    });
    n.show();
  };
  const selfPaths = [process.env.PORTABLE_EXECUTABLE_FILE, process.execPath].filter(Boolean);
  const security = new SecurityService({
    demo,
    selfPaths,
    // Demo results live apart so sample alerts never show up on the real PC.
    userDataDir: demo ? path.join(app.getPath('userData'), 'demo') : app.getPath('userData'),
    backupDir: state.backupDir,
    trash,
    getSettings: state.getSettings,
    addHistory: (entry) => state.addHistory(entry),
    notify,
    broadcast: (alerts) => send('security:alerts', alerts),
  });
  if (demo && !security.store.get().alerts.length) {
    const t = Date.now();
    security.store.set({
      ...security.store.get(),
      alerts: [
        { severity: 'warning', title: 'Discord started using your microphone', body: 'If you didn\'t start a call or recording, check Camera & Mic.', view: 'security/privacy', time: t - 25 * 60_000 },
        { severity: 'warning', title: 'New startup program: WindowsHelper', body: 'powershell.exe -w hidden -nop -enc SQBFAFgA…', view: 'security/startup', time: t - 3 * 3_600_000 },
        { severity: 'danger', title: 'Microsoft Defender found a threat', body: 'Open Virus Scan to see what was found.', view: 'security/scan', time: t - 12 * 86_400_000 },
      ],
    });
  }
  registerSecurityIpc({ handle, security, state, send });

  const game = new GameService({
    demo,
    userDataDir: demo ? path.join(app.getPath('userData'), 'demo') : app.getPath('userData'),
    runAction: (action) => security.runAction(action),
    notify,
    broadcast: (status) => {
      send('game:status', status);
      onGameModeChanged(status);
    },
    // The Guard checks less often while you play, so it never costs frames.
    onModeChange: (on) => security.setGameMode(on),
    addHistory: (entry) => state.addHistory(entry),
    selfPaths,
  });
  registerGameIpc({ handle, game, send });

  // A dev build (npm start) passes the app folder to electron.exe and never turns itself on.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
  const autostart = new Autostart({
    demo,
    state,
    runPs,
    runAction: (action) => security.runAction(action),
    launch: app.isPackaged ? { exe, args: '--background', auto: true } : { exe, args: `"${app.getAppPath()}" --background`, auto: false },
  });

  // ---------------------------------------------------------------- app ---
  handle('app:info', () => ({
    name: 'opKapot',
    version: app.getVersion(),
    platform: process.platform,
    demo: !!demo,
    exe,
    paths: {
      home: app.getPath('home'),
      downloads: app.getPath('downloads'),
      desktop: app.getPath('desktop'),
      documents: app.getPath('documents'),
      videos: app.getPath('videos'),
      userData: app.getPath('userData'),
    },
  }));
  handle('win:minimize', () => getWindow()?.minimize());
  handle('win:toggle-maximize', () => {
    const win = getWindow();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  handle('win:close', () => getWindow()?.close());
  handle('shell:open-external', (url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) return shell.openExternal(url);
    return null;
  });
  handle('clipboard:write', (text) => clipboard.writeText(String(text ?? '')));
  handle('app:autostart', async (enable) => {
    const result = await autostart.set(!!enable);
    onGuardSettingsChanged();
    return result;
  });

  handle('settings:get', () => state.publicSettings());
  handle('settings:set', (patch) => {
    const result = state.updateFromPage(patch);
    security.applyGuardSettings();
    onGuardSettingsChanged();
    return result;
  });
  handle('history:list', () => state.listHistory());
  handle('history:clear', () => state.clearHistory());
  handle('sys:drives', () => listDrives());

  // ----------------------------------------------------------- programs ---
  handle('programs:list', async () => {
    const list = await programs.list();
    return { programs: list, bundles: programs.bundles() };
  });
  handle('programs:sizes', () => programs.sizes());
  handle('programs:usage', () => programs.usage());

  const iconCache = new Map();
  handle('programs:icons', async (ids) => {
    const out = {};
    for (const id of strings(ids).slice(0, 60)) {
      if (!iconCache.has(id)) {
        let url = null;
        for (const file of await programs.iconCandidates(id)) {
          try {
            if (!fs.existsSync(file)) continue;
            let img = /\.ico$/i.test(file) ? nativeImage.createFromPath(file) : null;
            if (!img || img.isEmpty()) img = await app.getFileIcon(file, { size: 'large' });
            if (img && !img.isEmpty()) {
              url = img.toDataURL();
              break;
            }
          } catch { /* try the next candidate */ }
        }
        iconCache.set(id, url);
      }
      out[id] = iconCache.get(id);
    }
    return out;
  });

  const fileIconCache = new Map();
  handle('sys:file-icons', async (paths) => {
    const out = {};
    for (const file of strings(paths).slice(0, 80)) {
      if (!fileIconCache.has(file)) {
        let url = null;
        try {
          if (/^[a-z]:\\/i.test(file) || file.startsWith('/')) {
            if (fs.existsSync(file)) {
              const img = await app.getFileIcon(file, { size: 'normal' });
              if (img && !img.isEmpty()) url = img.toDataURL();
            }
          }
        } catch { /* no icon */ }
        fileIconCache.set(file, url);
      }
      out[file] = fileIconCache.get(file);
    }
    return out;
  });

  handle('programs:open-location', async (id) => {
    const p = programs.get(id);
    if (!p?.installLocation) return 'This program has no install folder.';
    return shell.openPath(p.installLocation);
  });
  handle('programs:search-online', (id) => {
    const p = programs.get(id);
    if (!p) return null;
    return shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(`${p.name} ${p.publisher || ''}`.trim())}`);
  });
  handle('programs:remove-entry', async (id) => {
    const p = programs.get(id);
    if (!p) throw new Error('Program not found. Refresh the list.');
    const result = await programs.removeEntry(p, state.backupDir);
    if (result.ok) state.addHistory({ type: 'force', title: p.name, detail: 'Registry entry removed', bytes: 0 });
    return result;
  });

  // ---------------------------------------------------------- uninstall ---
  let activeRun = null;
  handle('uninstall:run', async (ids, options = {}) => {
    if (activeRun) throw new Error('An uninstall is already running.');
    const settings = state.getSettings();
    const quiet = options.quiet ?? settings.quietUninstall;
    const restorePoint = options.restorePoint ?? settings.restorePoint;
    const run = { cancelled: false, skip: new Set() };
    activeRun = run;
    const results = [];
    try {
      if (restorePoint) {
        send('uninstall:progress', { phase: 'restore-point', status: 'running' });
        const rp = await programs.createRestorePoint();
        send('uninstall:progress', { phase: 'restore-point', status: rp.ok ? 'done' : 'failed', message: rp.error });
      }
      for (const id of strings(ids)) {
        const program = programs.get(id);
        let result;
        if (!program) {
          result = { status: 'failed', message: 'Program not found. Refresh the list.' };
        } else if (run.cancelled) {
          result = { status: 'skipped', message: 'Skipped.' };
        } else {
          send('uninstall:progress', { id, status: 'running', message: 'Starting…' });
          try {
            result = await programs.uninstall(program, {
              quiet,
              onStatus: (status, message) => send('uninstall:progress', { id, status, message }),
              shouldStopWaiting: () => run.skip.has(id) || run.cancelled,
            });
          } catch (err) {
            result = { status: 'failed', message: err.message };
          }
          if (result.status === 'removed') {
            state.addHistory({
              type: 'uninstall',
              title: program.name,
              detail: [program.version, program.publisher].filter(Boolean).join(' · '),
              bytes: program.size || 0,
            });
          }
        }
        results.push({ id, ...result });
        send('uninstall:progress', { id, ...result });
      }
    } finally {
      activeRun = null;
    }
    return results;
  });
  handle('uninstall:skip-wait', (id) => activeRun?.skip.add(id));
  handle('uninstall:cancel', () => {
    if (activeRun) activeRun.cancelled = true;
  });

  // ---------------------------------------------------------- leftovers ---
  const leftoverScans = new Map();
  let scanCounter = 0;
  handle('leftovers:scan', async (ids) => {
    const items = await programs.leftovers(strings(ids));
    const token = `scan-${++scanCounter}`;
    leftoverScans.set(token, new Map(items.map((i) => [i.id, i])));
    return { token, items };
  });
  handle('leftovers:delete', async (token, ids, options = {}) => {
    // Only items produced by our own scan can be deleted.
    const scan = leftoverScans.get(token);
    if (!scan) throw new Error('This leftover scan has expired. Please scan again.');
    const permanent = options.permanent ?? state.getSettings().deleteMode === 'permanent';
    const deleted = [];
    const failed = [];
    let freed = 0;
    const names = new Set();
    for (const id of strings(ids)) {
      const item = scan.get(id);
      if (!item) continue;
      let result;
      if (item.demo) {
        await sleep(60);
        result = { ok: true };
      } else if (item.kind === 'registry') {
        result = isWin ? await registry.deleteKey(item.path, state.backupDir) : { ok: false, error: 'Unsupported' };
      } else {
        const r = await files.deletePaths([item.path], { permanent, trash });
        result = r.deleted.length ? { ok: true } : { ok: false, error: r.failed[0]?.error };
      }
      if (result.ok) {
        deleted.push(id);
        freed += item.size || 0;
        names.add(item.programName);
      } else {
        failed.push({ id, error: result.error || 'Could not delete' });
      }
    }
    if (deleted.length) {
      state.addHistory({
        type: 'leftovers',
        title: `Removed ${deleted.length} leftover item${deleted.length === 1 ? '' : 's'}`,
        detail: [...names].join(', '),
        bytes: freed,
      });
    }
    return { deleted, failed, freed };
  });

  // ------------------------------------------------------- windows apps ---
  const appCache = new Map();
  handle('apps:list', async () => {
    let apps = [];
    if (demoProvider) apps = await demoProvider.listApps();
    else if (windowsApps) apps = await windowsApps.listApps();
    appCache.clear();
    for (const a of apps) appCache.set(a.id, a);
    return apps;
  });
  handle('apps:remove', async (ids) => {
    const results = [];
    for (const id of strings(ids)) {
      const item = appCache.get(id);
      if (!item) continue;
      send('apps:progress', { id, status: 'running' });
      let r;
      try {
        r = demoProvider ? await demoProvider.removeApp(item) : await windowsApps.removeApp(item);
      } catch (err) {
        r = { ok: false, error: err.message };
      }
      if (r.ok) state.addHistory({ type: 'app', title: item.name, detail: item.publisher, bytes: item.size || 0 });
      results.push({ id, ...r });
      send('apps:progress', { id, status: r.ok ? 'removed' : 'failed', message: r.error });
    }
    return results;
  });

  // -------------------------------------------------------------- files ---
  handle('files:scan', (jobId, params) => files.scanFiles(params || {}, { jobId, onProgress: jobProgress(jobId), settings: state.getSettings() }));
  handle('files:duplicates', (jobId, params) => files.findDuplicates(params || {}, { jobId, onProgress: jobProgress(jobId), settings: state.getSettings() }));
  handle('files:folder', (jobId, root) => files.folderContents(root, { jobId, onProgress: jobProgress(jobId) }));
  handle('job:cancel', (jobId) => cancelJob(jobId));
  handle('files:delete', async (items, options = {}) => {
    const list = (Array.isArray(items) ? items : []).filter((i) => i && typeof i.path === 'string');
    const permanent = options.permanent ?? state.getSettings().deleteMode === 'permanent';
    const result = await files.deletePaths(list.map((i) => i.path), { permanent, trash });
    const ok = new Set(result.deleted);
    const bytes = list.filter((i) => ok.has(i.path)).reduce((sum, i) => sum + (Number(i.size) || 0), 0);
    if (ok.size) {
      state.addHistory({
        type: 'files',
        title: `${permanent ? 'Deleted' : 'Recycled'} ${ok.size} item${ok.size === 1 ? '' : 's'}`,
        detail: options.label || '',
        bytes,
      });
    }
    return { ...result, bytes };
  });
  handle('files:reveal', (p) => typeof p === 'string' && shell.showItemInFolder(p));
  handle('files:open', (p) => (typeof p === 'string' ? shell.openPath(p) : null));
  // Clicking a part of an address: folders open in Explorer, files are shown
  // selected in their folder (never run).
  handle('files:open-location', async (p) => {
    if (!isLocalPath(p)) return 'This location can\'t be opened.';
    let stat;
    try {
      stat = await fs.promises.stat(p);
    } catch {
      return `${p} doesn't exist any more.`;
    }
    if (stat.isDirectory()) return (await shell.openPath(p)) || null;
    shell.showItemInFolder(p);
    return null;
  });
  handle('files:pick-exe', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose the game\'s program file',
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe'] }],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('files:pick-program', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose a program to start with Windows',
      properties: ['openFile'],
      filters: isWin ? [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd', 'com'] }] : [],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('files:pick-folder', async (defaultPath) => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Choose a folder to scan',
      properties: ['openDirectory'],
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
    });
    return res.canceled ? null : res.filePaths[0];
  });

  // --------------------------------------------------------------- junk ---
  handle('junk:scan', (jobId) => junk.scan({ jobId, onProgress: jobProgress(jobId) }));
  handle('junk:clean', async (jobId, ids) => {
    const result = await junk.clean(strings(ids), { jobId, onProgress: jobProgress(jobId) });
    if (result.deleted || result.freed) {
      state.addHistory({ type: 'junk', title: 'Cleaned junk files', detail: `${result.deleted.toLocaleString()} files removed`, bytes: result.freed });
    }
    return result;
  });

  return { state, security, game, autostart };
}

module.exports = { registerIpc };
