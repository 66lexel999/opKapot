'use strict';

const os = require('node:os');
const path = require('node:path');
const { runJob, cancelJob } = require('../services/jobs');
const { listDrives } = require('../services/drives');
const { mapDefender } = require('./analyze/defender');
const { sleep } = require('../services/programs/common');

const HOUR = 3_600_000;

/** Folders a Quick Scan covers: where malware lands and hides. */
function quickRoots(platform, env, home) {
  const j = path.join;
  if (platform !== 'win32') {
    return [
      { path: j(home, 'Downloads') }, { path: j(home, 'Desktop') }, { path: j(home, 'Documents'), depth: 2 },
      { path: os.tmpdir() }, { path: j(home, '.config', 'autostart') }, { path: j(home, '.local', 'bin') },
    ];
  }
  const profile = env.USERPROFILE || home;
  const roaming = env.APPDATA || j(profile, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || j(profile, 'AppData', 'Local');
  const sysRoot = env.SystemRoot || 'C:\\Windows';
  const programData = env.ProgramData || 'C:\\ProgramData';
  return [
    { path: j(profile, 'Downloads') },
    { path: j(profile, 'Desktop') },
    { path: j(profile, 'Documents'), depth: 2 },
    { path: env.TEMP || os.tmpdir() },
    { path: roaming, depth: 3 },
    { path: local, depth: 0 },
    { path: j(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') },
    { path: j(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup') },
    { path: env.PUBLIC || 'C:\\Users\\Public' },
    { path: programData, depth: 0 },
    { path: j(sysRoot, 'Temp') },
  ];
}

const DEFENDER_TYPES = { quick: 'QuickScan', full: 'FullScan', custom: 'CustomScan' };

/** Runs Microsoft Defender and opKapot's heuristics side by side. */
class VirusScanner {
  constructor({ demo, runPs, collect, platform = process.platform, env = process.env, home = os.homedir() }) {
    this.demo = demo;
    this.runPs = runPs;
    this.collect = collect;
    this.platform = platform;
    this.env = env;
    this.home = home;
    this.active = new Map();
  }

  get windows() {
    return this.platform === 'win32';
  }

  async roots(type, customPath) {
    if (type === 'custom') return [{ path: customPath }];
    if (type === 'full') {
      if (!this.windows) return [{ path: this.home }, { path: os.tmpdir() }];
      return (await listDrives()).map((d) => ({ path: d.path }));
    }
    return quickRoots(this.platform, this.env, this.home);
  }

  excludes() {
    if (!this.windows) return ['/proc', '/sys', '/dev', '/run', '/snap'];
    const drive = `${this.env.SystemDrive || 'C:'}\\`;
    return [path.join(this.env.SystemRoot || 'C:\\Windows', 'WinSxS'), path.join(drive, 'System Volume Information'), path.join(drive, '$Recycle.Bin')];
  }

  /**
   * Scan. Progress: { phase, scanned, flagged, currentDir, defender: 'running'|'done'|'unavailable'|'failed' }.
   * Resolves { rows, scanned, stopped, defender: { ran, error }, durationMs }.
   */
  async scan({ jobId, type, path: customPath, defenderAvailable }, onProgress = () => {}) {
    const started = Date.now();
    const control = { controller: new AbortController(), defenderRunning: false };
    this.active.set(jobId, control);
    let defenderState = defenderAvailable ? 'running' : 'unavailable';
    let lastHeur = { scanned: 0, flagged: 0, currentDir: '' };
    const report = () => onProgress({ ...lastHeur, defender: defenderState, elapsed: Date.now() - started });

    try {
      if (this.demo) return await this.demoScan(jobId, type, control, report, (h) => { lastHeur = h; }, started);

      const heuristics = runJob('malwareScan', { roots: await this.roots(type, customPath), exclude: this.excludes() }, {
        jobId,
        onProgress: (d) => {
          lastHeur = d;
          report();
        },
      });

      let defender = Promise.resolve(null);
      if (defenderAvailable && this.windows) {
        control.defenderRunning = true;
        defender = this.runPs('actions', { type: 'defender-scan', scanType: DEFENDER_TYPES[type], path: customPath || '' }, {
          timeout: type === 'full' ? 12 * HOUR : 3 * HOUR,
          signal: control.controller.signal,
        }).then((r) => {
          defenderState = r?.ok ? 'done' : 'failed';
          report();
          return r?.ok ? null : r?.message || 'Microsoft Defender could not scan.';
        }, (err) => {
          defenderState = 'failed';
          report();
          return err.message;
        }).finally(() => {
          control.defenderRunning = false;
        });
      }

      const [heur, defenderError] = await Promise.all([heuristics, defender]);
      let defenderRows = [];
      if (defenderAvailable && this.windows) {
        try {
          defenderRows = mapDefender(await this.collect('defender')).filter((r) => (r.time || 0) >= started - 5 * 60_000);
        } catch { /* history unavailable */ }
      }
      return {
        rows: mergeRows(heuristicRows(heur.findings), defenderRows),
        scanned: heur.scanned,
        stopped: heur.stopped || control.controller.signal.aborted,
        defender: { ran: !!defenderAvailable, error: control.controller.signal.aborted ? null : defenderError },
        durationMs: Date.now() - started,
      };
    } finally {
      this.active.delete(jobId);
    }
  }

  async cancel(jobId) {
    cancelJob(jobId);
    const control = this.active.get(jobId);
    if (!control) return;
    control.controller.abort();
    if (this.windows && !this.demo) {
      try {
        await this.runPs('actions', { type: 'defender-cancel' }, { timeout: 30_000 });
      } catch { /* nothing running */ }
    }
  }

  async demoScan(jobId, type, control, report, setHeur, started) {
    const demo = require('./demo');
    const total = type === 'full' ? 48_000 : 9_400;
    for (let scanned = 0; scanned <= total; scanned += Math.round(total / 24)) {
      if (control.controller.signal.aborted) break;
      setHeur({ scanned, flagged: scanned > total * 0.4 ? 2 : scanned > total * 0.2 ? 1 : 0, currentDir: `C:\\Users\\You\\${scanned % 2 ? 'Downloads' : 'AppData\\Roaming\\Microsoft'}` });
      report();
      await sleep(160);
    }
    const history = mapDefender(demo.defender());
    return {
      rows: mergeRows(heuristicRows(demo.SCAN_FINDINGS), history.slice(0, 1).map((r) => ({ ...r, time: Date.now() }))),
      scanned: total,
      stopped: control.controller.signal.aborted,
      defender: { ran: true, error: null },
      durationMs: Date.now() - started,
    };
  }
}

function heuristicRows(findings) {
  return (findings || []).map((f) => ({
    id: `heur:${f.path}`,
    engine: 'opKapot heuristics',
    name: f.hits[0]?.title || 'Suspicious file',
    type: f.hits.length > 1 ? `${f.hits.length} warning signs` : 'Suspicious file',
    meaning: f.hits.map((h) => h.why).filter(Boolean).join(' '),
    severity: f.severity,
    status: 'Active',
    active: true,
    time: f.mtime,
    path: f.path,
    size: f.size,
    hits: f.hits,
    sha256: f.sha256,
    origin: f.origin,
  }));
}

/** When both engines flag the same file, keep one row with both opinions. */
function mergeRows(heuristic, defender) {
  const byPath = new Map(defender.map((d) => [String(d.path).toLowerCase(), d]));
  const out = [...defender];
  for (const h of heuristic) {
    const d = byPath.get(String(h.path).toLowerCase());
    if (d) {
      d.hits = h.hits;
      d.sha256 = d.sha256 || h.sha256;
      d.origin = d.origin || h.origin;
    } else {
      out.push(h);
    }
  }
  const order = { danger: 0, warning: 1, notice: 2, ok: 3 };
  return out.sort((a, b) => (Number(b.active) - Number(a.active)) || (order[a.severity] - order[b.severity]));
}

module.exports = { VirusScanner, quickRoots, heuristicRows, mergeRows };
