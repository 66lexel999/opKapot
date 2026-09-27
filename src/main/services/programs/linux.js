'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../../lib/exec');

const DPKG_FORMAT = '${Package}\\t${Version}\\t${Installed-Size}\\t${Maintainer}\\t${db:Status-Abbrev}\\t${Priority}\\t${Homepage}\\t${binary:Summary}\\n';

async function mtimeOf(file) {
  try {
    return (await fs.promises.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function listDpkg() {
  const res = await run('dpkg-query', ['-W', `-f=${DPKG_FORMAT}`], { timeout: 60_000 });
  if (res.code !== 0) return [];
  const manual = new Set((await run('apt-mark', ['showmanual'], { timeout: 30_000 })).stdout.split('\n').map((s) => s.trim()).filter(Boolean));
  const programs = [];
  for (const line of res.stdout.split('\n')) {
    const [name, version, sizeKb, maintainer, status, priority, homepage, summary] = line.split('\t');
    if (!name || !status || !status.startsWith('ii')) continue;
    programs.push({
      id: `dpkg:${name}`,
      name,
      version,
      publisher: (maintainer || '').replace(/\s*<[^>]*>/, '').trim(),
      installDate: null,
      installTime: null,
      installTimePrecise: false,
      size: Number(sizeKb) > 0 ? Number(sizeKb) * 1024 : null,
      installLocation: '',
      description: summary || '',
      website: homepage || '',
      source: 'dpkg',
      sourceLabel: 'APT package',
      packageName: name,
      systemComponent: !manual.has(name) || priority === 'required' || priority === 'important',
      canUninstall: true,
      canRemoveEntry: false,
      lastUsed: null,
    });
  }
  await Promise.all(programs.map(async (p) => {
    const t = (await mtimeOf(`/var/lib/dpkg/info/${p.name}.list`))
      ?? (await mtimeOf(`/var/lib/dpkg/info/${p.name}:${os.arch() === 'x64' ? 'amd64' : os.arch()}.list`));
    p.installDate = t;
    p.installTime = t;
    p.installTimePrecise = !!t;
  }));
  return programs;
}

function parseHumanSize(text) {
  const m = /([\d.,]+)\s*([kmgt]?)b/i.exec(String(text || ''));
  if (!m) return null;
  const mult = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12 }[m[2].toLowerCase()];
  return Math.round(parseFloat(m[1].replace(',', '.')) * mult);
}

async function listFlatpak() {
  const res = await run('flatpak', ['list', '--app', '--columns=application,name,version,origin,installation,size'], { timeout: 30_000 });
  if (res.code !== 0) return [];
  const programs = [];
  for (const line of res.stdout.split('\n')) {
    const [appId, name, version, origin, installation, size] = line.split('\t');
    if (!appId) continue;
    const base = installation === 'user'
      ? path.join(os.homedir(), '.local/share/flatpak/app', appId)
      : path.join('/var/lib/flatpak/app', appId);
    const t = await mtimeOf(base);
    programs.push({
      id: `flatpak:${installation}:${appId}`,
      name: name || appId,
      version: version || '',
      publisher: origin || '',
      installDate: t,
      installTime: t,
      installTimePrecise: !!t,
      size: parseHumanSize(size),
      installLocation: base,
      description: appId,
      source: 'flatpak',
      sourceLabel: 'Flatpak',
      appId,
      installation,
      systemComponent: false,
      canUninstall: true,
      canRemoveEntry: false,
      lastUsed: null,
    });
  }
  return programs;
}

async function listSnap() {
  const res = await run('snap', ['list'], { timeout: 30_000 });
  if (res.code !== 0) return [];
  const programs = [];
  for (const line of res.stdout.split('\n').slice(1)) {
    const [name, version, rev, , publisher, notes = ''] = line.trim().split(/\s+/);
    if (!name) continue;
    const snapFile = `/var/lib/snapd/snaps/${name}_${rev}.snap`;
    let size = null;
    let t = null;
    try {
      const stat = await fs.promises.stat(snapFile);
      size = stat.size;
      t = stat.mtimeMs;
    } catch { /* ignore */ }
    programs.push({
      id: `snap:${name}`,
      name,
      version,
      publisher: (publisher || '').replace(/[✓✪*]$/, ''),
      installDate: t,
      installTime: t,
      installTimePrecise: !!t,
      size,
      installLocation: `/snap/${name}`,
      description: '',
      source: 'snap',
      sourceLabel: 'Snap',
      systemComponent: /base|core|snapd/.test(notes) || /^(core\d*|snapd|bare)$/.test(name),
      canUninstall: true,
      canRemoveEntry: false,
      lastUsed: null,
    });
  }
  return programs;
}

async function listPrograms() {
  const lists = await Promise.all([listDpkg(), listFlatpak(), listSnap()]);
  return lists.flat();
}

async function uninstall(program, { onStatus = () => {} } = {}) {
  let res;
  onStatus('running', 'Removing package…');
  if (program.source === 'dpkg') {
    res = await run('pkexec', ['apt-get', 'remove', '-y', program.packageName], { timeout: 0 });
  } else if (program.source === 'flatpak') {
    res = await run('flatpak', ['uninstall', '-y', '--noninteractive', `--${program.installation === 'user' ? 'user' : 'system'}`, program.appId], { timeout: 0 });
  } else if (program.source === 'snap') {
    res = await run('pkexec', ['snap', 'remove', program.name], { timeout: 0 });
  } else {
    return { status: 'failed', message: 'Unsupported package type.' };
  }
  if (res.code === 0) return { status: 'removed', message: 'Removed.' };
  if (res.code === 126 || res.code === 127) return { status: 'cancelled', message: 'Authorization was cancelled.' };
  const detail = (res.stderr || res.error?.message || '').trim().split('\n').pop();
  return { status: 'failed', message: detail || `Exited with code ${res.code}.` };
}

async function iconCandidates() {
  return [];
}

async function usage() {
  return {};
}

module.exports = { listPrograms, uninstall, iconCandidates, usage, parseHumanSize };
