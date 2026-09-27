'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compact, normalizePublisher, baseProgramName } = require('./programs/common');
const { GENERIC_PUBLISHERS } = require('./programs/bundles');
const { createSafety, isProtectedRegistryKey, normalizeRegistryKey } = require('../lib/safety');
const { GUID } = require('../lib/cmdline');

// Folder names too generic to identify a program on their own.
const GENERIC_WORDS = new Set([
  'app', 'apps', 'application', 'applications', 'bin', 'launcher', 'client', 'program', 'programs', 'common',
  'commonfiles', 'data', 'files', 'main', 'current', 'lib', 'sdk', 'tools', 'tool', 'update', 'updater',
  'service', 'services', 'helper', 'driver', 'drivers', 'runtime', 'installer', 'setup', 'cache', 'temp',
  'logs', 'config', 'settings', 'plugins', 'default', 'user', 'users', 'system', 'windows', 'microsoft',
  'google', 'shared', 'packages', 'package', 'local', 'roaming', 'desktop', 'documents',
]);

/** Name fragments that identify a program's files and registry keys. */
function keysFor(program) {
  const top = new Set();    // safe to match anywhere
  const inner = new Set();  // only safe inside the publisher's own folder
  const prefix = new Set(); // bundle/app ids; matched as prefixes
  const addTop = (s) => {
    const k = compact(s);
    if (k.length >= 3 && !GENERIC_WORDS.has(k)) top.add(k);
    if (k.length >= 3) inner.add(k);
  };
  const addInner = (s) => {
    const k = compact(s);
    if (k.length >= 3) inner.add(k);
  };

  const publisher = normalizePublisher(program.publisher);
  const base = baseProgramName(program.name);
  addTop(program.name);
  addTop(base);

  // "Razer Cortex" by "Razer Inc." → "Cortex" (inside a Razer folder).
  const words = base.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    const head = compact(words.slice(0, i).join(' '));
    if (publisher && (head === publisher || publisher.startsWith(head))) addInner(words.slice(i).join(' '));
  }

  if (program.keyName && !GUID.test(program.keyName)) addTop(program.keyName.replace(/_is1$/i, ''));
  if (program.installLocation) {
    const leaf = program.installLocation.split(/[\\/]/).filter(Boolean).pop();
    if (leaf) addTop(leaf.replace(/\.app$/i, ''));
  }
  if (program.packageName) {
    addTop(program.packageName);
    addTop(program.packageName.replace(/-(stable|beta|dev|bin|desktop|browser|nightly)$/, ''));
  }
  for (const id of [program.bundleId, program.appId]) {
    const k = compact(id);
    if (k.length >= 8) prefix.add(k);
  }
  return { top, inner, prefix, publisher };
}

function matchKey(name, set, prefix) {
  const k = compact(name);
  if (!k) return false;
  if (set.has(k)) return true;
  for (const key of set) {
    // "Synapse3" still belongs to "Synapse".
    if (k.startsWith(key) && /^\d{1,2}$/.test(k.slice(key.length))) return true;
  }
  if (prefix) {
    for (const p of prefix) if (k.startsWith(p)) return true;
  }
  return false;
}

async function defaultListDir(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => !e.isSymbolicLink())
      .map((e) => ({ name: e.name, isDir: e.isDirectory(), isFile: e.isFile() }));
  } catch {
    return [];
  }
}

async function defaultExists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function defaultFileSize(p) {
  try {
    return (await fs.promises.stat(p)).size;
  } catch {
    return null;
  }
}

function locationsFor(platform, env, home) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const join = (...parts) => (parts.every(Boolean) ? P.join(...parts) : null);
  if (platform === 'win32') {
    const profile = env.USERPROFILE || home;
    const startMenu = [
      join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ];
    return {
      folders: [
        env.ProgramFiles, env['ProgramFiles(x86)'],
        join(env.ProgramFiles, 'Common Files'), join(env['ProgramFiles(x86)'], 'Common Files'),
        env.ProgramData, env.APPDATA, env.LOCALAPPDATA,
        join(env.LOCALAPPDATA, 'Programs'), join(profile, 'AppData', 'LocalLow'),
        ...startMenu,
      ].filter(Boolean),
      shortcuts: [join(profile, 'Desktop'), join(env.PUBLIC, 'Desktop'), ...startMenu].filter(Boolean),
      shortcutExt: /\.(lnk|url)$/i,
    };
  }
  if (platform === 'darwin') {
    const lib = P.join(home, 'Library');
    return {
      folders: ['Application Support', 'Caches', 'Logs', 'Containers', 'Saved Application State', 'HTTPStorages', 'WebKit']
        .map((d) => P.join(lib, d)),
      shortcuts: [P.join(lib, 'Preferences'), P.join(lib, 'LaunchAgents')],
      shortcutExt: /\.plist$/i,
    };
  }
  return {
    folders: ['.config', '.local/share', '.cache', '.var/app'].map((d) => P.join(home, d)),
    shortcuts: [P.join(home, '.local/share/applications'), P.join(home, 'Desktop'), P.join(home, '.config/autostart')],
    shortcutExt: /\.desktop$/i,
  };
}

const REGISTRY_ROOTS = ['HKCU\\Software', 'HKLM\\SOFTWARE', 'HKLM\\SOFTWARE\\WOW6432Node'];

/**
 * Finds files, folders, shortcuts and registry keys a program left behind.
 * All I/O is injectable for testing.
 */
function createLeftoverScanner({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  listDir = defaultListDir,
  exists = defaultExists,
  fileSize = defaultFileSize,
  folderSizes = async () => ({}),
  registry = null,
  safety = createSafety({ platform, env, home }),
} = {}) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const locations = locationsFor(platform, env, home);
  const stripExt = (name) => name.replace(/\.[^.]+$/, '');

  async function scan(targets, installed) {
    const targetIds = new Set(targets.map((t) => t.id));
    const others = installed.filter((p) => !targetIds.has(p.id));
    const otherTop = new Set();
    const otherInnerByPublisher = new Map();
    const otherPublishers = new Set();
    for (const o of others) {
      const k = keysFor(o);
      k.top.forEach((x) => otherTop.add(x));
      if (k.publisher) {
        otherPublishers.add(k.publisher);
        if (!otherInnerByPublisher.has(k.publisher)) otherInnerByPublisher.set(k.publisher, new Set());
        k.inner.forEach((x) => otherInnerByPublisher.get(k.publisher).add(x));
      }
    }
    const otherLocations = others.map((o) => o.installLocation).filter(Boolean).map(safety.key);

    const items = [];
    const seen = new Set();
    const push = (program, kind, p, confidence, reason) => {
      const id = kind === 'registry' ? normalizeRegistryKey(p).toLowerCase() : safety.key(p);
      if (seen.has(id)) return;
      if (kind === 'registry') {
        if (isProtectedRegistryKey(p)) return;
      } else {
        if (safety.isProtectedPath(p)) return;
        const k = safety.key(p);
        if (otherLocations.some((o) => o === k || safety.isInside(o, k) || safety.isInside(k, o))) return;
      }
      seen.add(id);
      items.push({ programId: program.id, programName: program.name, kind, path: p, confidence, reason, size: null });
    };

    for (const program of targets) {
      const keys = keysFor(program);
      const vendorIsOurs = !!keys.publisher && keys.publisher.length >= 3
        && !GENERIC_PUBLISHERS.has(keys.publisher) && !otherPublishers.has(keys.publisher);
      const takenInner = otherInnerByPublisher.get(keys.publisher) || new Set();
      const isOursTop = (name) => matchKey(name, keys.top, keys.prefix) && !matchKey(name, otherTop);
      const isOursInner = (name) => matchKey(name, keys.inner) && !matchKey(name, takenInner) && !matchKey(name, otherTop);

      if (program.installLocation && await exists(program.installLocation)) {
        push(program, 'folder', program.installLocation, program.locationGuessed ? 'medium' : 'high', 'Install folder');
      }

      for (const base of locations.folders) {
        for (const entry of await listDir(base)) {
          if (!entry.isDir) continue;
          const full = P.join(base, entry.name);
          if (isOursTop(entry.name)) {
            push(program, 'folder', full, 'high', `Named after ${program.name}`);
          } else if (keys.publisher && normalizePublisher(entry.name) === keys.publisher) {
            const inside = (await listDir(full)).filter((e) => e.isDir);
            const ours = inside.filter((e) => isOursInner(e.name));
            if (vendorIsOurs) {
              const confidence = ours.length && ours.length === inside.length ? 'high' : 'medium';
              push(program, 'folder', full, confidence, `Publisher folder (${program.publisher})`);
            } else {
              for (const e of ours) push(program, 'folder', P.join(full, e.name), 'high', `Named after ${program.name}`);
            }
          }
        }
      }

      for (const dir of locations.shortcuts) {
        for (const entry of await listDir(dir)) {
          if (entry.isFile && locations.shortcutExt.test(entry.name) && isOursTop(stripExt(entry.name))) {
            push(program, 'shortcut', P.join(dir, entry.name), 'high', 'Shortcut');
          } else if (entry.isDir && platform === 'win32' && dir.endsWith('Programs') && isOursTop(entry.name)) {
            push(program, 'folder', P.join(dir, entry.name), 'high', 'Start menu folder');
          }
        }
      }
    }

    if (registry && platform === 'win32') await scanRegistry(targets, keysByTarget(targets), push, { otherTop, otherInnerByPublisher, otherPublishers });

    // Sizes: folders in one background pass, files individually.
    const folders = items.filter((i) => i.kind === 'folder').map((i) => i.path);
    const sizes = folders.length ? await folderSizes(folders) : {};
    for (const item of items) {
      if (item.kind === 'folder') item.size = sizes[item.path] ?? null;
      else if (item.kind !== 'registry') item.size = await fileSize(item.path);
    }
    return items.map((item, i) => ({ ...item, id: `l${i}`, checked: item.confidence === 'high' }));
  }

  function keysByTarget(targets) {
    return new Map(targets.map((t) => [t.id, keysFor(t)]));
  }

  async function scanRegistry(targets, keyMap, push, { otherTop, otherInnerByPublisher, otherPublishers }) {
    const level1 = await registry.listSubkeys(REGISTRY_ROOTS);
    const expand = new Set();
    for (const root of REGISTRY_ROOTS) {
      for (const name of level1[root] || []) {
        const pub = normalizePublisher(name);
        if (targets.some((t) => keyMap.get(t.id).publisher === pub)) expand.add(`${root}\\${name}`);
      }
    }
    const level2 = await registry.listSubkeys([...expand]);

    for (const program of targets) {
      const keys = keyMap.get(program.id);
      const vendorIsOurs = !!keys.publisher && !GENERIC_PUBLISHERS.has(keys.publisher) && !otherPublishers.has(keys.publisher);
      const takenInner = otherInnerByPublisher.get(keys.publisher) || new Set();

      if (program.registryKey && (await registry.keyExists(program.registryKey)) === true) {
        push(program, 'registry', program.registryKey, 'high', 'Uninstall entry');
      }
      for (const root of REGISTRY_ROOTS) {
        for (const name of level1[root] || []) {
          const full = `${root}\\${name}`;
          if (matchKey(name, keys.top, keys.prefix) && !matchKey(name, otherTop)) {
            push(program, 'registry', full, 'high', `Named after ${program.name}`);
          } else if (expand.has(full) && normalizePublisher(name) === keys.publisher) {
            const inside = level2[full] || [];
            const ours = inside.filter((n) => matchKey(n, keys.inner) && !matchKey(n, takenInner) && !matchKey(n, otherTop));
            if (vendorIsOurs) {
              push(program, 'registry', full, ours.length && ours.length === inside.length ? 'high' : 'medium', `Publisher key (${program.publisher})`);
            } else {
              for (const n of ours) push(program, 'registry', `${full}\\${n}`, 'high', `Named after ${program.name}`);
            }
          }
        }
      }
    }
  }

  return { scan };
}

module.exports = { createLeftoverScanner, keysFor, matchKey };
