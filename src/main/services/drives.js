'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function usage(root) {
  try {
    const s = await withTimeout(fs.promises.statfs(root), 3000);
    if (!s || !s.blocks) return null;
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

/** Drives (Windows) or useful mount points (macOS/Linux) with free space. */
async function listDrives() {
  if (process.platform === 'win32') {
    const system = (process.env.SystemDrive || 'C:').toUpperCase();
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const found = await Promise.all(letters.map(async (letter) => {
      const root = `${letter}:\\`;
      const u = await usage(root);
      return u && { path: root, label: `${letter}:`, name: `Local Disk (${letter}:)`, system: `${letter}:` === system, ...u };
    }));
    return found.filter(Boolean);
  }

  const home = os.homedir();
  const candidates = [
    { path: '/', label: '/', name: 'System (/)', system: true },
    { path: home, label: '~', name: `Home (${home})`, system: false },
  ];
  const extraRoots = process.platform === 'darwin' ? ['/Volumes'] : [`/media/${os.userInfo().username}`, '/mnt'];
  for (const dir of extraRoots) {
    try {
      for (const name of await fs.promises.readdir(dir)) {
        const p = path.join(dir, name);
        if (process.platform === 'darwin' && name === 'Macintosh HD') continue;
        candidates.push({ path: p, label: name, name, system: false });
      }
    } catch { /* none */ }
  }
  const out = [];
  for (const c of candidates) {
    const u = await usage(c.path);
    if (u) out.push({ ...c, ...u });
  }
  return out;
}

module.exports = { listDrives };
