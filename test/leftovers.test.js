'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLeftoverScanner, keysFor } = require('../src/main/services/leftovers');

const env = {
  SystemRoot: 'C:\\Windows',
  SystemDrive: 'C:',
  USERPROFILE: 'C:\\Users\\Ann',
  LOCALAPPDATA: 'C:\\Users\\Ann\\AppData\\Local',
  APPDATA: 'C:\\Users\\Ann\\AppData\\Roaming',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  PUBLIC: 'C:\\Users\\Public',
};

/** Fake filesystem: list of absolute paths; trailing "\\" marks folders. */
function fakeFs(entries) {
  const dirs = new Set();
  const files = new Set();
  const original = new Map();
  for (const e of entries) {
    const isDir = e.endsWith('\\');
    const p = isDir ? e.slice(0, -1) : e;
    (isDir ? dirs : files).add(p.toLowerCase());
    original.set(p.toLowerCase(), p);
    let parent = path.win32.dirname(p);
    while (parent && parent !== path.win32.dirname(parent)) {
      dirs.add(parent.toLowerCase());
      original.set(parent.toLowerCase(), parent);
      parent = path.win32.dirname(parent);
    }
  }
  const all = [...dirs, ...files];
  return {
    listDir: async (dir) => {
      const d = dir.toLowerCase();
      return all
        .filter((p) => path.win32.dirname(p) === d)
        .map((p) => ({ name: path.win32.basename(original.get(p) || p), isDir: dirs.has(p), isFile: files.has(p) }));
    },
    exists: async (p) => dirs.has(p.toLowerCase()) || files.has(p.toLowerCase()),
  };
}

function scanner(entries, registryTree = {}) {
  const fs = fakeFs(entries);
  return createLeftoverScanner({
    platform: 'win32',
    env,
    home: 'C:\\Users\\Ann',
    listDir: fs.listDir,
    exists: fs.exists,
    fileSize: async () => 100,
    folderSizes: async (paths) => Object.fromEntries(paths.map((p) => [p, 1000])),
    registry: {
      listSubkeys: async (keys) => Object.fromEntries(keys.map((k) => [k, registryTree[k] || []])),
      keyExists: async (k) => k.endsWith('\\Cortex'),
    },
  });
}

const cortex = {
  id: 'cortex', name: 'Razer Cortex (x64)', publisher: 'Razer Inc.',
  installLocation: 'C:\\Program Files\\Razer\\Razer Cortex',
  registryKey: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Cortex',
};
const synapse = {
  id: 'synapse', name: 'Razer Synapse', publisher: 'Razer Inc.', installLocation: 'C:\\Program Files\\Razer\\Synapse3',
};
const steam = { id: 'steam', name: 'Steam', publisher: 'Valve Corporation', installLocation: 'C:\\Program Files (x86)\\Steam' };

test('builds match keys from name, publisher and folder', () => {
  const k = keysFor(cortex);
  assert.ok(k.top.has('razercortex'));
  assert.ok(k.inner.has('cortex'));
  assert.ok(!k.top.has('cortex'), 'short name only matches inside the publisher folder');
  assert.equal(k.publisher, 'razer');
  assert.ok(!keysFor({ name: 'Launcher', publisher: '' }).top.has('launcher'), 'generic words are ignored');
});

test('finds leftovers but never touches folders of other installed programs', async () => {
  const s = scanner([
    'C:\\Program Files\\Razer\\Razer Cortex\\',
    'C:\\Program Files\\Razer\\Synapse3\\',
    'C:\\ProgramData\\Razer\\Cortex\\',
    'C:\\ProgramData\\Razer\\Synapse3\\',
    'C:\\Users\\Ann\\AppData\\Roaming\\Razer Cortex\\',
    'C:\\Users\\Ann\\AppData\\Local\\Steam\\',
    'C:\\Users\\Public\\Desktop\\Razer Cortex.lnk',
    'C:\\Users\\Ann\\Desktop\\Steam.lnk',
  ], {
    'HKCU\\Software': ['Razer', 'Valve'],
    'HKCU\\Software\\Razer': ['Cortex', 'Synapse3'],
    'HKLM\\SOFTWARE': ['Razer Cortex'],
  });
  const items = await s.scan([cortex], [cortex, synapse, steam]);
  const paths = items.map((i) => i.path).sort();
  assert.deepEqual(paths, [
    'C:\\Program Files\\Razer\\Razer Cortex',
    'C:\\ProgramData\\Razer\\Cortex',
    'C:\\Users\\Ann\\AppData\\Roaming\\Razer Cortex',
    'C:\\Users\\Public\\Desktop\\Razer Cortex.lnk',
    'HKCU\\Software\\Razer\\Cortex',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Cortex',
    'HKLM\\SOFTWARE\\Razer Cortex',
  ].sort());
  assert.ok(items.every((i) => i.checked), 'exact matches are pre-selected');
  assert.equal(items.find((i) => i.kind === 'folder').size, 1000);
});

test('offers the whole publisher folder only when no other program uses it', async () => {
  const s = scanner([
    'C:\\Program Files\\Razer\\Razer Cortex\\',
    'C:\\ProgramData\\Razer\\Cortex\\',
    'C:\\ProgramData\\Razer\\Logs\\',
  ]);
  const items = await s.scan([cortex], [cortex, steam]);
  const vendor = items.find((i) => i.path === 'C:\\ProgramData\\Razer');
  assert.ok(vendor, 'publisher folder offered');
  assert.equal(vendor.confidence, 'medium', 'contains unrelated data, so it needs review');
  assert.equal(vendor.checked, false);
});

test('never offers protected locations', async () => {
  const s = scanner(['C:\\Program Files\\Windows\\']);
  const items = await s.scan([{ id: 'w', name: 'Windows', publisher: 'Microsoft Corporation', installLocation: 'C:\\Windows' }], []);
  assert.deepEqual(items, []);
});
