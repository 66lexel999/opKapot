'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runPs } = require('./runner');
const demoData = require('./demo');
const { analyzeAudit, summarize, auditFiles, crashFinding } = require('./analyze/audit');
const { analyzeConnections, matchRemoteTool } = require('./analyze/network');
const { analyzeAutoruns, autorunFiles } = require('./analyze/autoruns');
const { scanExtensions } = require('./analyze/extensions');
const { analyzePrivacy } = require('./analyze/privacy');
const { mapDefender } = require('./analyze/defender');
const { removeHostsLines } = require('./analyze/hosts');
const { asArray, asObjects, str, sectionError, pathKind } = require('./analyze/common');
const { Quarantine } = require('./quarantine');
const { VirusScanner } = require('./virus');
const { Guard } = require('./guard');
const virustotal = require('./virustotal');
const { JsonStore } = require('../lib/store');
const { sleep } = require('../services/programs/common');

const DAY = 86_400_000;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const CRITICAL = /^(system|smss|csrss|wininit|winlogon|services|lsass|svchost|dwm|fontdrvhost|lsaiso|registry|memory compression|secure system|msmpeng|nissrv|securityhealthservice)$/i;

function productOn(state) {
  return ((Number(state) >> 12) & 0xf) === 1;
}

class SecurityService {
  constructor({ demo, userDataDir, backupDir, trash, getSettings, addHistory, notify = () => {}, broadcast = () => {}, selfPaths = [] }) {
    this.demo = !!demo;
    this.selfPaths = selfPaths;
    this.platform = process.platform;
    this.env = this.demo ? demoData.ENV : process.env;
    this.backupDir = backupDir;
    this.trash = trash;
    this.getSettings = getSettings;
    this.addHistory = addHistory;
    this.notify = notify;
    this.broadcast = broadcast;
    this.sigCache = new Map();
    this.fixes = { token: null, actions: new Map() };
    this.autorunIndex = new Map();
    this.networkIndex = new Map();
    this.store = new JsonStore(path.join(userDataDir, 'security.json'), { lastScan: null, lastAudit: null, alerts: [], ignored: [], ignoredFiles: [] });
    this.quarantine = new Quarantine(path.join(userDataDir, 'quarantine'));
    this.scanner = new VirusScanner({ demo: this.demo, runPs, collect: (n) => this.collect(n), env: this.env });
    this.guard = new Guard({ collect: () => this.collect('guard', {}, { timeout: 60_000 }), onAlerts: (a) => this.onAlerts(a) });
    this.demoState = { autoruns: null, autorunsDisabled: new Set(), blocked: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'] };
    this.blockedIndex = new Map();
  }

  get supported() {
    return this.demo || this.platform === 'win32';
  }

  get windows() {
    return this.platform === 'win32' && !this.demo;
  }

  // ------------------------------------------------------------ plumbing ---

  async collect(name, params = {}, opts = {}) {
    if (!this.demo) {
      if (this.platform !== 'win32') throw new Error('These security checks need Windows.');
      return runPs(name, params, opts);
    }
    await sleep(name === 'audit' ? 900 : 250);
    switch (name) {
      case 'audit': return demoData.audit();
      case 'autoruns': return structuredClone(this.demoAutoruns());
      case 'network': return demoData.network();
      case 'status': return demoData.status();
      case 'defender': return demoData.defender();
      case 'upnp': return { upnp: demoData.UPNP };
      case 'guard': {
        const net = demoData.network();
        const procs = net.processes;
        return {
          consent: demoData.status().consent.filter((c) => c.start && !c.stop),
          connections: net.tcp.map((c) => ({ ...c, name: procs[String(c.pid)]?.name, path: procs[String(c.pid)]?.path })),
          processes: demoData.audit().processes,
          run: demoData.autoruns().run.entries,
          startupFolder: demoData.autoruns().startupFolder.map((f) => f.path),
          tasks: demoData.autoruns().tasks.map((t) => `${t.path}${t.name}`),
          rdpSessions: [],
          threatCount: 2,
        };
      }
      default: return {};
    }
  }

  /** The demo PC's startup items, which Startup Manager can change. */
  demoAutoruns() {
    this.demoState.autoruns ??= demoData.autoruns();
    return this.demoState.autoruns;
  }

  /** Digital signatures for files, cached for the session. */
  async signatures(files) {
    const unique = [...new Set(files.filter((f) => f && /^[a-z]:\\/i.test(f)))];
    if (this.demo) return Object.fromEntries(unique.map((f) => [f, demoData.SIGNATURES[f]]).filter(([, s]) => s));
    const missing = unique.filter((f) => !this.sigCache.has(f.toLowerCase()));
    for (let i = 0; i < missing.length; i += 150) {
      try {
        const res = await runPs('signatures', { paths: missing.slice(i, i + 150) }, { timeout: 180_000 });
        for (const [file, sig] of Object.entries(res || {})) this.sigCache.set(file.toLowerCase(), sig);
      } catch { /* leave unknown */ }
    }
    const out = {};
    for (const f of unique) {
      const sig = this.sigCache.get(f.toLowerCase());
      if (sig) out[f] = sig;
    }
    return out;
  }

  async runAction(action) {
    if (this.demo) {
      await sleep(700);
      return { ok: true, message: 'Done. (Demo mode: nothing on your PC was changed.)' };
    }
    if (action.type === 'hosts-remove') return this.removeHostsLines(action);
    if (action.type === 'trash-file') {
      await this.trash(action.path);
      return { ok: true, message: 'Moved to the Recycle Bin.' };
    }
    if (this.platform !== 'win32') return { ok: false, message: 'Only available on Windows.' };
    const timeout = /defender-(update|remove)/.test(action.type) ? 900_000 : 180_000;
    const res = await runPs('actions', { ...action, backupDir: this.backupDir }, { timeout });
    const r = Array.isArray(res) ? res.filter((x) => x && typeof x.ok === 'boolean').pop() : res;
    return { ok: !!r?.ok, message: r?.message || (r?.ok ? 'Done.' : 'It didn\'t work.'), data: r?.data };
  }

  hostsPath() {
    return this.platform === 'win32' ? path.join(this.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : '/etc/hosts';
  }

  readHosts() {
    if (this.demo) return { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts', text: demoData.HOSTS };
    try {
      return { path: this.hostsPath(), text: fs.readFileSync(this.hostsPath(), 'utf8') };
    } catch {
      return { path: this.hostsPath(), text: null };
    }
  }

  removeHostsLines({ lines }) {
    const file = this.hostsPath();
    const text = fs.readFileSync(file, 'utf8');
    fs.mkdirSync(this.backupDir, { recursive: true });
    fs.writeFileSync(path.join(this.backupDir, `hosts-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`), text);
    fs.writeFileSync(file, removeHostsLines(text, lines));
    return { ok: true, message: 'Lines removed. A backup of the old hosts file was saved.' };
  }

  extensionsList() {
    if (this.demo) return demoData.EXTENSIONS;
    return scanExtensions({ platform: this.platform, env: this.env, home: os.homedir() });
  }

  // -------------------------------------------------------------- status ---

  async status() {
    if (!this.supported) return { supported: false, platform: this.platform };
    const raw = await this.collect('status', {}, { timeout: 90_000 });
    const d = raw.defender && !sectionError(raw.defender) ? raw.defender : null;
    const avs = asArray(raw.avProducts).map((p) => ({ name: p.name, on: productOn(p.state) }));
    const other = avs.find((a) => a.on && !/defender|windows security/i.test(a.name));
    const fw = asArray(raw.firewall);
    const fwOther = asArray(raw.firewallProducts).find((p) => productOn(p.state) && !/windows|defender/i.test(p.name));
    const tools = new Set();
    for (const p of asArray(raw.processes)) {
      const t = matchRemoteTool(p);
      if (t) tools.add(t.name);
    }
    const devices = analyzePrivacy(raw.consent).filter((r) => r.inUse && r.cap !== 'location');
    const store = this.store.get();
    const sigAge = d?.signatureUpdated ? Math.floor((Date.now() - d.signatureUpdated) / DAY) : null;
    const antivirus = {
      on: !!(d && d.antivirusEnabled && d.realTime) || !!other,
      name: other ? other.name : 'Microsoft Defender',
      defender: d ? { active: !!(d.antivirusEnabled && d.realTime), realTime: !!d.realTime, tamper: !!d.tamper, mode: d.runningMode, signatureVersion: d.signatureVersion, signatureUpdated: d.signatureUpdated, signatureAgeDays: sigAge, quickScanEnd: d.quickScanEnd, fullScanEnd: d.fullScanEnd } : null,
    };
    const firewall = { on: !!fwOther || (fw.length > 0 && fw.every((p) => String(p.enabled) === 'True')), name: fwOther ? fwOther.name : 'Windows Firewall' };
    const rdp = { on: raw.rdp?.deny === 0, sessions: asArray(raw.rdpSessions).filter((l) => /rdp-tcp#/i.test(l)).length };
    const lastScanTime = Math.max(store.lastScan?.time || 0, antivirus.defender?.quickScanEnd || 0, antivirus.defender?.fullScanEnd || 0) || null;

    const issues = [];
    if (!antivirus.on) issues.push(['danger', 'Real-time virus protection is off']);
    if (rdp.sessions) issues.push(['danger', 'Someone is connected with Remote Desktop']);
    if ((store.lastAudit?.counts?.danger || 0) > 0) issues.push(['danger', `Hack Check found ${plural(store.lastAudit.counts.danger, 'serious problem')}`]);
    if ((store.lastScan?.threats || 0) > 0) issues.push(['danger', `Last virus scan found ${plural(store.lastScan.threats, 'threat')}`]);
    if (!firewall.on) issues.push(['warning', 'Firewall is off']);
    if (sigAge != null && sigAge > 3 && antivirus.defender?.active) issues.push(['warning', 'Virus definitions are out of date']);
    if (tools.size) issues.push(['warning', `${[...tools].join(', ')} running`]);
    if (devices.length) issues.push(['warning', `${devices.map((x) => x.name).join(', ')} using camera/mic`]);
    if ((store.lastAudit?.counts?.warning || 0) > 0) issues.push(['warning', `Hack Check found ${plural(store.lastAudit.counts.warning, 'warning')}`]);
    if (!lastScanTime || Date.now() - lastScanTime > 14 * DAY) issues.push(['notice', 'No virus scan in the last 2 weeks']);
    if (!store.lastAudit) issues.push(['notice', 'Hack Check has not been run yet']);
    const overall = issues.some((i) => i[0] === 'danger') ? 'danger' : issues.some((i) => i[0] === 'warning') ? 'warning' : 'ok';

    return {
      supported: true,
      demo: this.demo,
      overall,
      issues: issues.map(([severity, text]) => ({ severity, text })),
      antivirus,
      firewall,
      rdp,
      remoteTools: [...tools],
      devicesInUse: devices.map((x) => ({ name: x.name, device: x.device })),
      lastScan: store.lastScan,
      lastScanTime,
      lastAudit: store.lastAudit,
      quarantined: this.quarantine.list().length,
      alerts: store.alerts.slice(0, 30),
      guard: { enabled: this.guard.enabled, lastTick: this.guard.lastTick, error: this.guard.lastError },
    };
  }

  // ---------------------------------------------------------- Hack Check ---

  async audit(onProgress = () => {}) {
    if (!this.supported) throw new Error('Hack Check needs Windows.');
    const env = this.env;
    onProgress({ step: 1, text: 'Collecting information from Windows…' });
    const soft = (p) => p.catch((err) => ({ error: err.message }));
    const [audit, autorunsRaw, networkRaw, statusRaw, upnpRaw] = await Promise.all([
      this.collect('audit', {}, { timeout: 240_000 }),
      soft(this.collect('autoruns', {}, { timeout: 240_000 })),
      soft(this.collect('network', {}, { timeout: 90_000 })),
      soft(this.collect('status', {}, { timeout: 90_000 })),
      soft(this.collect('upnp', {}, { timeout: 25_000 })),
    ]);
    // Every step falls back to "nothing found" and reports itself, so one
    // surprise in Windows' data can't stop the whole check.
    const problems = [];
    const step = (category, fallback, run) => {
      try {
        return run();
      } catch (err) {
        problems.push(crashFinding(category, err));
        return fallback;
      }
    };
    onProgress({ step: 2, text: 'Checking browsers and the hosts file…' });
    const extensions = step('browser', [], () => this.extensionsList());
    const hosts = step('network', { text: '', path: this.hostsPath() }, () => this.readHosts());
    onProgress({ step: 3, text: 'Checking digital signatures…' });
    const files = [
      ...step('protection', [], () => auditFiles(audit, env)),
      ...step('startup', [], () => autorunFiles(autorunsRaw, env)),
      ...step('remote', [], () => Object.values(networkRaw?.processes || {}).map((p) => (typeof p?.path === 'string' ? p.path : '')).filter(Boolean)),
    ];
    let sigs = {};
    try {
      sigs = await this.signatures(files);
    } catch { /* unsigned-file checks are skipped */ }
    onProgress({ step: 4, text: 'Analyzing…' });
    const connections = step('remote', [], () => analyzeConnections(networkRaw, { sigs, env }));
    const autoruns = step('startup', [], () => analyzeAutoruns(autorunsRaw, { sigs, env, selfPaths: this.selfPaths }));
    const privacy = step('keylogger', [], () => analyzePrivacy(statusRaw?.consent));
    const ignored = new Set(this.store.get().ignored);
    const findings = [...analyzeAudit({
      audit, connections, autoruns, extensions, privacy, sigs, env,
      hostsText: hosts.text, hostsPath: hosts.path, upnp: upnpRaw?.upnp, localIps: asArray(networkRaw?.localIps),
    }), ...problems].map((f) => ({ ...f, ignored: ignored.has(f.id) }));
    if (sectionError(autorunsRaw)) findings.push({ id: 'audit:autoruns-failed', category: 'startup', severity: 'notice', title: 'Startup items could not be checked', summary: autorunsRaw.error, evidence: [] });

    const token = `audit-${Date.now()}`;
    this.fixes = { token, actions: new Map(findings.filter((f) => f.fix).map((f) => [f.id, f.fix.action])) };
    const summary = summarize(findings.filter((f) => !f.ignored));
    this.store.set({ ...this.store.get(), lastAudit: { time: Date.now(), counts: summary.counts, status: summary.status } });
    return {
      token,
      time: Date.now(),
      summary,
      findings: findings.map((f) => ({ ...f, fix: f.fix ? { label: f.fix.label, confirm: f.fix.confirm } : null })),
    };
  }

  async fix(token, id) {
    if (token !== this.fixes.token) throw new Error('These results are out of date. Run the check again.');
    const action = this.fixes.actions.get(id);
    if (!action) throw new Error('This problem has no automatic fix.');
    const result = await this.runAction(action);
    if (result.ok) this.addHistory({ type: 'security', title: 'Security fix applied', detail: result.message, bytes: 0 });
    return result;
  }

  setIgnored(id, on) {
    const s = this.store.get();
    const set = new Set(s.ignored);
    if (on) set.add(id);
    else set.delete(id);
    this.store.set({ ...s, ignored: [...set] });
  }

  // ------------------------------------------------------------ Network ---

  async network() {
    const raw = await this.collect('network', {}, { timeout: 90_000 });
    const paths = Object.values(raw.processes || {}).map((p) => p?.path).filter(Boolean);
    const sigs = await this.signatures(paths);
    const rows = analyzeConnections(raw, { sigs, env: this.env });
    this.networkIndex = new Map(rows.map((r) => [r.id, r]));
    return { rows, localIps: asArray(raw.localIps), time: Date.now() };
  }

  async networkAction(rowId, kind) {
    const row = this.networkIndex.get(rowId);
    if (!row) throw new Error('That connection is gone. Refresh the list.');
    if (row.pid <= 4 || (CRITICAL.test(row.process) && pathKind(row.path, this.env) === 'windows')) {
      throw new Error(`${row.process} is part of Windows and must not be stopped or blocked.`);
    }
    if (kind === 'kill') return this.runAction({ type: 'kill-process', pid: row.pid });
    if (kind === 'block') {
      if (!row.path) throw new Error('The program\'s file is unknown, so it can\'t be blocked.');
      const res = await this.runAction({ type: 'block-program', path: row.path });
      if (res.ok && this.demo && !this.demoState.blocked.includes(row.path)) this.demoState.blocked.push(row.path);
      return res;
    }
    throw new Error('Unknown action.');
  }

  /** Programs opKapot has blocked in Windows Firewall, one row per program. */
  async blocked() {
    let rules;
    if (this.demo) {
      rules = this.demoState.blocked.flatMap((p, i) => ['Inbound', 'Outbound'].map((direction) => ({ name: `demo-${i}-${direction}`, direction, program: p, enabled: 'True' })));
    } else {
      const raw = await this.collect('firewall', {}, { timeout: 60_000 });
      if (sectionError(raw.blocked)) throw new Error(`Windows Firewall could not be read: ${sectionError(raw.blocked)}`);
      rules = asObjects(raw.blocked);
    }
    const byProgram = new Map();
    for (const r of rules) {
      const program = str(r.program) && str(r.program) !== 'Any' ? str(r.program) : '';
      const id = (program || str(r.displayName) || str(r.name)).toLowerCase();
      if (!byProgram.has(id)) {
        byProgram.set(id, {
          id,
          path: program,
          name: program ? path.win32.basename(program) : str(r.displayName).replace(/^opKapot block - /, '') || 'Unknown program',
          rules: [],
          inbound: false,
          outbound: false,
        });
      }
      const b = byProgram.get(id);
      b.rules.push(str(r.name));
      if (/^in/i.test(str(r.direction))) b.inbound = true;
      if (/^out/i.test(str(r.direction))) b.outbound = true;
    }
    const list = [...byProgram.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.blockedIndex = new Map(list.map((b) => [b.id, b]));
    return list;
  }

  async unblock(id) {
    const b = this.blockedIndex.get(id);
    if (!b) throw new Error('That block is already gone. Refresh the list.');
    const res = await this.runAction({ type: 'unblock-program', rules: b.rules.filter(Boolean) });
    if (res.ok) {
      if (this.demo) this.demoState.blocked = this.demoState.blocked.filter((p) => p.toLowerCase() !== b.path.toLowerCase());
      this.addHistory({ type: 'security', title: `Unblocked ${b.name}`, detail: 'Internet access restored', bytes: 0 });
    }
    return res;
  }

  // ------------------------------------------------------------ Startup ---

  async autoruns() {
    const raw = await this.collect('autoruns', {}, { timeout: 240_000 });
    const sigs = await this.signatures(autorunFiles(raw, this.env));
    const entries = analyzeAutoruns(raw, { sigs, env: this.env, selfPaths: this.selfPaths });
    for (const e of entries) if (this.demo && this.demoState.autorunsDisabled.has(e.id)) e.enabled = false;
    this.autorunIndex = new Map(entries.map((e) => [e.id, e]));
    return entries.map(({ actions, ...e }) => ({
      ...e,
      canDisable: !!actions.disable, canEnable: !!actions.enable, canRemove: !!actions.remove,
    }));
  }

  async autorunAction(id, which) {
    const entry = this.autorunIndex.get(id);
    const action = entry?.actions?.[which];
    if (!action) throw new Error('That can\'t be done for this item.');
    const result = await this.runAction(action);
    if (result.ok && this.demo) {
      if (which === 'disable') this.demoState.autorunsDisabled.add(id);
      if (which === 'enable') this.demoState.autorunsDisabled.delete(id);
      if (which === 'remove') {
        const a = this.demoAutoruns();
        a.run.entries = a.run.entries.filter((e) => `run|${e.key}|${e.name}` !== id);
        a.startupFolder = a.startupFolder.filter((f) => `startup|${f.path}` !== id);
      }
    }
    if (result.ok) this.addHistory({ type: 'security', title: `${which === 'remove' ? 'Removed' : which === 'disable' ? 'Disabled' : 'Enabled'} startup item`, detail: entry.name, bytes: 0 });
    return result;
  }

  /** Start a program of your choice when you sign in (your account's Run key). */
  async autorunAdd({ path: file, name, args } = {}) {
    file = typeof file === 'string' ? file.trim() : '';
    name = typeof name === 'string' ? name.trim() : '';
    args = typeof args === 'string' ? args.trim() : '';
    if (!this.supported) throw new Error('Only available on Windows.');
    const local = this.demo ? path.isAbsolute(file) && !file.startsWith('\\\\') : /^[a-z]:\\/i.test(file);
    if (!local) throw new Error('Choose a program on this PC.');
    if (!this.demo && !/\.(exe|bat|cmd|com)$/i.test(file)) throw new Error('Choose a program (.exe, .bat or .cmd file).');
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error('That program doesn\'t exist any more.');
    if (!name || name.length > 80 || /[\\\x00-\x1f]/.test(name)) throw new Error('Give it a name of up to 80 characters, without backslashes.');
    if (args.length > 500 || /[\x00-\x1f]/.test(args)) throw new Error('The arguments must be one line of up to 500 characters.');
    const command = `"${file}"${args ? ` ${args}` : ''}`;
    const runKey = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
    if (this.demo && this.demoAutoruns().run.entries.some((e) => e.key === runKey && e.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, message: `There is already a startup entry called "${name}".` };
    }
    const result = await this.runAction({ type: 'run-add', name, command });
    if (!result.ok) return result;
    if (this.demo) {
      this.demoAutoruns().run.entries.push({ hive: 'HKCU', key: runKey, kind: 'Run', name, command });
      this.demoState.autorunsDisabled.delete(`run|${runKey}|${name}`);
      result.message = 'Added. It will start the next time you sign in to Windows. (Demo mode: nothing on your PC was changed.)';
    }
    // You added it yourself, so the Guard shouldn't warn about it.
    this.guard.expect(`${runKey}|${name}`);
    this.addHistory({ type: 'security', title: 'Added startup item', detail: name, bytes: 0 });
    return result;
  }

  // ----------------------------------------------------- Extensions, Mic ---

  extensions() {
    return this.extensionsList();
  }

  async privacy() {
    const raw = await this.collect('status', {}, { timeout: 90_000 });
    return analyzePrivacy(raw.consent);
  }

  // --------------------------------------------------------- Virus scan ---

  async engines() {
    const settings = this.getSettings();
    let defender = { available: false, active: false, reason: this.supported ? '' : 'Microsoft Defender is part of Windows.' };
    if (this.supported) {
      try {
        const raw = await this.collect('status', {}, { timeout: 90_000 });
        const d = raw.defender && !sectionError(raw.defender) ? raw.defender : null;
        const other = asArray(raw.avProducts).find((p) => productOn(p.state) && !/defender|windows security/i.test(p.name));
        defender = d
          ? { available: true, active: !!d.antivirusEnabled, realTime: !!d.realTime, mode: d.runningMode, signatureVersion: d.signatureVersion, signatureUpdated: d.signatureUpdated, reason: d.antivirusEnabled ? '' : other ? `Resting because ${other.name} is your antivirus.` : 'Microsoft Defender is turned off.' }
          : { available: false, active: false, reason: other ? `${other.name} is your antivirus; use it for full scans.` : 'Microsoft Defender is not available.' };
      } catch (err) {
        defender = { available: false, active: false, reason: err.message };
      }
    }
    return { defender, heuristics: true, virustotal: !!settings.virusTotalKey, platform: this.platform, demo: this.demo };
  }

  async scan({ jobId, type, path: scanPath }, onProgress) {
    const engines = await this.engines();
    const result = await this.scanner.scan({ jobId, type, path: scanPath, defenderAvailable: engines.defender.active }, onProgress);
    const ignoredFiles = new Set(this.store.get().ignoredFiles);
    const rows = result.rows.map((r) => ({ ...r, ignored: ignoredFiles.has(r.sha256 || r.path) }));
    const threats = rows.filter((r) => r.active && !r.ignored).length;
    if (!result.stopped) {
      this.store.set({ ...this.store.get(), lastScan: { type, time: Date.now(), threats, scanned: result.scanned, durationMs: result.durationMs } });
      this.addHistory({ type: 'scan', title: `${type[0].toUpperCase()}${type.slice(1)} virus scan`, detail: threats ? `${plural(threats, 'threat')} found` : 'No threats found', bytes: 0 });
    }
    return { ...result, rows, engines };
  }

  cancelScan(jobId) {
    return this.scanner.cancel(jobId);
  }

  async defenderHistory() {
    if (!this.supported) return [];
    return mapDefender(await this.collect('defender', {}, { timeout: 90_000 }));
  }

  setIgnoredFile(key, on) {
    const s = this.store.get();
    const set = new Set(s.ignoredFiles);
    if (on) set.add(key);
    else set.delete(key);
    this.store.set({ ...s, ignoredFiles: [...set] });
  }

  async quarantineFile(file, meta, { killFirst = false } = {}) {
    if (this.demo) {
      await sleep(500);
      const entry = { id: `demo-${Date.now()}`, originalPath: file, name: path.win32.basename(file), size: meta.size || 0, sha256: meta.sha256 || '', threat: meta.threat || '', engine: meta.engine || '', date: Date.now(), demo: true };
      this.demoQuarantine = [entry, ...(this.demoQuarantine || [])];
      return entry;
    }
    if (killFirst && this.windows) await this.runAction({ type: 'kill-path', path: file });
    const entry = await this.quarantine.add(file, meta);
    this.addHistory({ type: 'quarantine', title: `Quarantined ${entry.name}`, detail: meta.threat || '', bytes: entry.size });
    return entry;
  }

  quarantineList() {
    return this.demo ? (this.demoQuarantine || []) : this.quarantine.list();
  }

  async quarantineRestore(id) {
    if (this.demo) {
      this.demoQuarantine = (this.demoQuarantine || []).filter((e) => e.id !== id);
      return { ok: true };
    }
    return this.quarantine.restore(id);
  }

  async quarantineDelete(id) {
    if (this.demo) {
      this.demoQuarantine = (this.demoQuarantine || []).filter((e) => e.id !== id);
      return { ok: true };
    }
    return this.quarantine.remove(id);
  }

  virusTotal(sha256, apiKey) {
    if (this.demo && !apiKey) return Promise.resolve({ found: true, malicious: 54, suspicious: 2, harmless: 16, total: 72, label: 'trojan.agenttesla/msil', name: 'Invoice.pdf.exe', demo: true });
    return virustotal.lookup(sha256, apiKey);
  }

  // --------------------------------------------------------------- Guard ---

  applyGuardSettings() {
    const s = this.getSettings();
    if (this.supported && s.guardEnabled) {
      const ms = Math.max(10, Number(s.guardIntervalSec) || 30) * 1000;
      const interval = this.gameMode ? Math.max(ms, 120_000) : ms;
      if (!this.guard.enabled || this.guard.intervalMs !== interval) this.guard.start(interval);
    } else {
      this.guard.stop();
    }
  }

  /** While Game Mode is on the Guard checks every 2 minutes instead of every 30 seconds. */
  setGameMode(on) {
    this.gameMode = !!on;
    this.applyGuardSettings();
  }

  onAlerts(alerts) {
    const s = this.store.get();
    this.store.set({ ...s, alerts: [...alerts, ...s.alerts].slice(0, 100) });
    for (const a of alerts) this.notify(a);
    this.broadcast(alerts);
  }

  clearAlerts() {
    this.store.set({ ...this.store.get(), alerts: [] });
  }
}

module.exports = { SecurityService };
