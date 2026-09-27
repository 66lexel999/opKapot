'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('opk', {
  app: {
    info: () => invoke('app:info'),
    openExternal: (url) => invoke('shell:open-external', url),
    copy: (text) => invoke('clipboard:write', text),
  },
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggle-maximize'),
    close: () => invoke('win:close'),
    onMaximizeChange: (cb) => on('win:maximized', cb),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  history: {
    list: () => invoke('history:list'),
    clear: () => invoke('history:clear'),
  },
  sys: {
    drives: () => invoke('sys:drives'),
  },
  programs: {
    list: () => invoke('programs:list'),
    sizes: () => invoke('programs:sizes'),
    usage: () => invoke('programs:usage'),
    icons: (ids) => invoke('programs:icons', ids),
    openLocation: (id) => invoke('programs:open-location', id),
    searchOnline: (id) => invoke('programs:search-online', id),
    removeEntry: (id) => invoke('programs:remove-entry', id),
  },
  uninstall: {
    run: (ids, options) => invoke('uninstall:run', ids, options),
    skipWait: (id) => invoke('uninstall:skip-wait', id),
    cancel: () => invoke('uninstall:cancel'),
    onProgress: (cb) => on('uninstall:progress', cb),
  },
  leftovers: {
    scan: (ids) => invoke('leftovers:scan', ids),
    remove: (token, ids, options) => invoke('leftovers:delete', token, ids, options),
  },
  apps: {
    list: () => invoke('apps:list'),
    remove: (ids) => invoke('apps:remove', ids),
    onProgress: (cb) => on('apps:progress', cb),
  },
  files: {
    scan: (jobId, params) => invoke('files:scan', jobId, params),
    duplicates: (jobId, params) => invoke('files:duplicates', jobId, params),
    folder: (jobId, root) => invoke('files:folder', jobId, root),
    remove: (items, options) => invoke('files:delete', items, options),
    reveal: (p) => invoke('files:reveal', p),
    open: (p) => invoke('files:open', p),
    pickFolder: (defaultPath) => invoke('files:pick-folder', defaultPath),
  },
  jobs: {
    cancel: (jobId) => invoke('job:cancel', jobId),
    onProgress: (cb) => on('job:progress', cb),
  },
  junk: {
    scan: (jobId) => invoke('junk:scan', jobId),
    clean: (jobId, ids) => invoke('junk:clean', jobId, ids),
  },
});
