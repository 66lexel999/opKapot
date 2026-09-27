'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runJob } = require('./jobs');
const { powershell } = require('../lib/exec');

const HOUR = 3_600_000;

function listDirs(dir, filter = () => true) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && filter(e.name))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/** Cache folders of every profile in a Chromium-based browser. */
function chromiumCaches(userDataDir) {
  if (!userDataDir) return [];
  const targets = ['ShaderCache', 'GrShaderCache'].map((d) => path.join(userDataDir, d));
  const profiles = listDirs(userDataDir, (n) => n === 'Default' || /^Profile \d+$/.test(n) || n === 'Guest Profile');
  for (const profile of profiles) {
    for (const d of ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnWebGPUCache']) targets.push(path.join(profile, d));
  }
  return targets.map((root) => ({ root }));
}

function firefoxCaches(profilesDir) {
  return listDirs(profilesDir).flatMap((p) => [
    { root: path.join(p, 'cache2') },
    { root: path.join(p, 'startupCache') },
    { root: path.join(p, 'thumbnails') },
  ]);
}

function windowsCategories({ env, tempAgeMs, recycleRoots }) {
  const L = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const W = env.SystemRoot || 'C:\\Windows';
  const PD = env.ProgramData || 'C:\\ProgramData';
  const join = path.join;
  return [
    {
      id: 'user-temp', icon: 'temp', checked: true,
      name: 'User temporary files',
      description: 'Files programs left in your Temp folder.',
      targets: [{ root: os.tmpdir(), minAgeMs: tempAgeMs }],
    },
    {
      id: 'windows-temp', icon: 'windows', checked: true,
      name: 'Windows temporary files',
      description: 'Leftovers from Windows and installers.',
      targets: [{ root: join(W, 'Temp'), minAgeMs: tempAgeMs }],
    },
    {
      id: 'update-cache', icon: 'download', checked: true,
      name: 'Windows Update cache',
      description: 'Update packages that were already installed.',
      targets: [{ root: join(W, 'SoftwareDistribution', 'Download'), minAgeMs: 24 * HOUR }],
    },
    {
      id: 'error-reports', icon: 'bug', checked: true,
      name: 'Error reports & crash dumps',
      description: 'Windows Error Reporting files and memory dumps.',
      targets: [
        { root: join(PD, 'Microsoft', 'Windows', 'WER', 'ReportArchive') },
        { root: join(PD, 'Microsoft', 'Windows', 'WER', 'ReportQueue') },
        { root: join(L, 'Microsoft', 'Windows', 'WER') },
        { root: join(L, 'CrashDumps') },
        { root: join(W, 'Minidump') },
        { root: join(W, 'LiveKernelReports'), match: '\\.dmp$' },
        { file: join(W, 'MEMORY.DMP') },
      ],
    },
    {
      id: 'browser-cache', icon: 'globe', checked: true,
      name: 'Browser cache',
      description: 'Chrome, Edge, Brave, Opera and Firefox caches. Close your browsers first.',
      targets: [
        ...chromiumCaches(join(L, 'Google', 'Chrome', 'User Data')),
        ...chromiumCaches(join(L, 'Microsoft', 'Edge', 'User Data')),
        ...chromiumCaches(join(L, 'BraveSoftware', 'Brave-Browser', 'User Data')),
        ...chromiumCaches(join(L, 'Vivaldi', 'User Data')),
        { root: join(L, 'Opera Software', 'Opera Stable', 'Cache') },
        { root: join(L, 'Opera Software', 'Opera GX Stable', 'Cache') },
        ...firefoxCaches(join(L, 'Mozilla', 'Firefox', 'Profiles')),
      ],
    },
    {
      id: 'shader-cache', icon: 'gpu', checked: true,
      name: 'DirectX & GPU shader cache',
      description: 'Rebuilt automatically by your graphics driver.',
      targets: [
        { root: join(L, 'D3DSCache') },
        { root: join(L, 'NVIDIA', 'DXCache') },
        { root: join(L, 'NVIDIA', 'GLCache') },
        { root: join(L, 'AMD', 'DxCache') },
        { root: join(L, 'AMD', 'DxcCache') },
        { root: join(L, 'AMD', 'GLCache') },
        { root: join(L, 'Intel', 'ShaderCache') },
      ],
    },
    {
      id: 'thumbnails', icon: 'image', checked: false,
      name: 'Thumbnail cache',
      description: 'Explorer thumbnail and icon databases. Rebuilt as you browse.',
      targets: [{ root: join(L, 'Microsoft', 'Windows', 'Explorer'), match: '^(thumbcache|iconcache)_.*\\.db$', recursive: false }],
    },
    {
      id: 'delivery-optimization', icon: 'share', checked: false,
      name: 'Delivery Optimization files',
      description: 'Update pieces Windows shares with other PCs.',
      targets: [{ root: join(W, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache') }],
    },
    {
      id: 'logs', icon: 'log', checked: false,
      name: 'Old system log files',
      description: 'Windows log files older than a week.',
      targets: [{ root: join(W, 'Logs'), match: '\\.(log|etl|old|bak)$', minAgeMs: 7 * 24 * HOUR }],
    },
    {
      id: 'prefetch', icon: 'bolt', checked: false,
      name: 'Prefetch data',
      description: 'Launch-speed hints. Windows rebuilds them; apps may start slower once.',
      targets: [{ root: join(W, 'Prefetch'), match: '\\.pf$', recursive: false }],
    },
    {
      id: 'recycle-bin', icon: 'trash', checked: true,
      name: 'Recycle Bin',
      description: 'Files you deleted earlier. They cannot be restored after cleaning.',
      targets: recycleRoots.map((root) => ({ root })),
      special: 'recycle',
    },
  ];
}

function unixCategories({ platform, home, tempAgeMs }) {
  const join = path.join;
  if (platform === 'darwin') {
    return [
      { id: 'user-temp', icon: 'temp', checked: true, name: 'Temporary files', description: 'Files apps left in your temporary folder.', targets: [{ root: os.tmpdir(), minAgeMs: tempAgeMs, ownedOnly: true }] },
      { id: 'logs', icon: 'log', checked: true, name: 'User logs', description: 'Application log files.', targets: [{ root: join(home, 'Library', 'Logs') }] },
      { id: 'user-cache', icon: 'box', checked: false, name: 'Application cache', description: 'Cached data from apps. Rebuilt when needed.', targets: [{ root: join(home, 'Library', 'Caches') }] },
      { id: 'recycle-bin', icon: 'trash', checked: true, name: 'Trash', description: 'Files you deleted earlier.', targets: [{ root: join(home, '.Trash') }] },
    ];
  }
  const cache = join(home, '.cache');
  const browsers = ['google-chrome', 'chromium', 'BraveSoftware', 'microsoft-edge', 'vivaldi'].map((d) => join(cache, d));
  return [
    { id: 'user-temp', icon: 'temp', checked: true, name: 'Temporary files', description: 'Your files in /tmp and /var/tmp.', targets: ['/tmp', '/var/tmp'].map((root) => ({ root, minAgeMs: tempAgeMs, ownedOnly: true })) },
    { id: 'browser-cache', icon: 'globe', checked: true, name: 'Browser cache', description: 'Chrome, Chromium, Brave, Edge and Firefox caches. Close your browsers first.', targets: [...browsers.map((root) => ({ root })), ...listDirs(join(cache, 'mozilla', 'firefox')).map((p) => ({ root: join(p, 'cache2') }))] },
    { id: 'thumbnails', icon: 'image', checked: true, name: 'Thumbnail cache', description: 'Image previews. Rebuilt as you browse.', targets: [{ root: join(cache, 'thumbnails') }] },
    { id: 'user-cache', icon: 'box', checked: false, name: 'Application cache', description: 'Other cached data in ~/.cache. Rebuilt when needed.', targets: [{ root: cache, exclude: [...browsers, join(cache, 'mozilla'), join(cache, 'thumbnails')] }] },
    { id: 'crash', icon: 'bug', checked: true, name: 'Crash reports', description: 'Crash reports in /var/crash.', targets: [{ root: '/var/crash', ownedOnly: true }] },
    { id: 'recycle-bin', icon: 'trash', checked: true, name: 'Trash', description: 'Files you deleted earlier.', targets: [{ root: join(home, '.local', 'share', 'Trash') }] },
  ];
}

class JunkService {
  constructor({ getSettings, getRecycleRoots = async () => [], platform = process.platform, env = process.env, home = os.homedir() }) {
    this.getSettings = getSettings;
    this.getRecycleRoots = getRecycleRoots;
    this.platform = platform;
    this.env = env;
    this.home = home;
  }

  async categories() {
    const tempAgeMs = Math.max(0, Number(this.getSettings().tempMinAgeHours) || 0) * HOUR;
    if (this.platform === 'win32') {
      return windowsCategories({ env: this.env, tempAgeMs, recycleRoots: await this.getRecycleRoots() });
    }
    return unixCategories({ platform: this.platform, home: this.home, tempAgeMs });
  }

  async scan({ jobId, onProgress } = {}) {
    const categories = await this.categories();
    const { results, stopped } = await runJob('junkScan', {
      categories: categories.map(({ id, targets }) => ({ id, targets })),
    }, { jobId, onProgress });
    return {
      stopped,
      categories: categories.map(({ targets, special, ...c }) => ({
        ...c,
        paths: targets.map((t) => t.root || t.file),
        size: results[c.id]?.size || 0,
        count: results[c.id]?.count || 0,
      })),
    };
  }

  async clean(ids, { jobId, onProgress } = {}) {
    const wanted = new Set(ids);
    const categories = (await this.categories()).filter((c) => wanted.has(c.id));
    const normal = categories.filter((c) => c.special !== 'recycle' || this.platform !== 'win32');
    const recycle = categories.find((c) => c.special === 'recycle' && this.platform === 'win32');

    const { results } = await runJob('junkClean', {
      categories: normal.map(({ id, targets }) => ({ id, targets })),
    }, { jobId, onProgress });

    if (recycle) {
      // Emptying through the shell keeps Explorer's Recycle Bin icon in sync.
      const before = await runJob('junkScan', { categories: [{ id: recycle.id, targets: recycle.targets }] });
      onProgress?.({ category: recycle.id });
      await powershell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', { timeout: 300_000 });
      const after = await runJob('junkScan', { categories: [{ id: recycle.id, targets: recycle.targets }] });
      const b = before.results[recycle.id];
      const a = after.results[recycle.id];
      results[recycle.id] = { freed: Math.max(0, b.size - a.size), deleted: Math.max(0, b.count - a.count), failed: a.count };
    }

    let freed = 0;
    let deleted = 0;
    let failed = 0;
    for (const r of Object.values(results)) {
      freed += r.freed;
      deleted += r.deleted;
      failed += r.failed;
    }
    return { results, freed, deleted, failed };
  }
}

module.exports = { JunkService, chromiumCaches };
