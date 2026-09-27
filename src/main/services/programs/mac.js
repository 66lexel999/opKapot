'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../../lib/exec');

async function readPlist(file) {
  try {
    const raw = await fs.promises.readFile(file);
    if (raw.subarray(0, 6).toString() === 'bplist') {
      const res = await run('plutil', ['-convert', 'json', '-o', '-', file], { timeout: 10_000 });
      return res.code === 0 ? JSON.parse(res.stdout) : {};
    }
    const text = raw.toString('utf8');
    const out = {};
    for (const key of ['CFBundleName', 'CFBundleDisplayName', 'CFBundleShortVersionString', 'CFBundleVersion', 'CFBundleIdentifier']) {
      const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(text);
      if (m) out[key] = m[1];
    }
    return out;
  } catch {
    return {};
  }
}

async function listPrograms() {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
  const programs = [];
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    await Promise.all(entries.filter((e) => e.endsWith('.app')).map(async (entry) => {
      const appPath = path.join(dir, entry);
      const info = await readPlist(path.join(appPath, 'Contents', 'Info.plist'));
      let born = null;
      try {
        const stat = await fs.promises.stat(appPath);
        born = stat.birthtimeMs || stat.mtimeMs;
      } catch { /* ignore */ }
      const bundleId = info.CFBundleIdentifier || '';
      programs.push({
        id: `app:${appPath}`,
        name: info.CFBundleDisplayName || info.CFBundleName || entry.replace(/\.app$/, ''),
        version: info.CFBundleShortVersionString || info.CFBundleVersion || '',
        publisher: bundleId.split('.').slice(1, 2).join('') || '',
        installDate: born,
        installTime: born,
        installTimePrecise: !!born,
        size: null,
        installLocation: appPath,
        bundleId,
        source: 'app',
        sourceLabel: 'Application',
        systemComponent: bundleId.startsWith('com.apple.'),
        canUninstall: true,
        canRemoveEntry: false,
        lastUsed: null,
      });
    }));
  }
  return programs;
}

function createUninstaller(trash) {
  return async function uninstall(program, { onStatus = () => {} } = {}) {
    onStatus('running', 'Moving to Trash…');
    try {
      await trash(program.installLocation);
      return { status: 'removed', message: 'Moved to Trash.' };
    } catch (err) {
      return { status: 'failed', message: err.message };
    }
  };
}

async function iconCandidates(program) {
  return program.installLocation ? [program.installLocation] : [];
}

async function usage(programs) {
  const result = {};
  await Promise.all(programs.map(async (p) => {
    try {
      const macos = path.join(p.installLocation, 'Contents', 'MacOS');
      let last = 0;
      for (const f of await fs.promises.readdir(macos)) {
        last = Math.max(last, (await fs.promises.stat(path.join(macos, f))).atimeMs);
      }
      result[p.id] = last || null;
    } catch {
      result[p.id] = null;
    }
  }));
  return result;
}

module.exports = { listPrograms, createUninstaller, iconCandidates, usage };
