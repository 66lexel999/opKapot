'use strict';

const { asArray, classifyIp } = require('./analyze/common');
const { matchRemoteTool } = require('./analyze/network');
const { TASK_NAME } = require('../services/autostart');

/** Reduce a guard.ps1 result to comparable sets. */
function snapshot(raw) {
  const s = {
    devices: new Map(),
    inbound: new Map(),
    listeners: new Map(),
    remoteTools: new Map(),
    run: new Map(),
    startup: new Set(asArray(raw?.startupFolder).map(String)),
    // opKapot's own "start with Windows" task is never news.
    tasks: new Set(asArray(raw?.tasks).map(String).filter((t) => t !== `\\${TASK_NAME}`)),
    rdp: asArray(raw?.rdpSessions).length > 0,
    threats: typeof raw?.threatCount === 'number' ? raw.threatCount : null,
  };
  for (const d of asArray(raw?.consent)) {
    const name = String(d.name).replace(/#/g, '\\').split('\\').pop().replace(/\.exe$/i, '').split('_')[0];
    s.devices.set(`${d.cap}|${d.name}`, { cap: d.cap, name });
  }
  const conns = asArray(raw?.connections);
  const listenPorts = new Set(conns.filter((c) => c.state === 'Listen').map((c) => c.localPort));
  for (const c of conns) {
    const local = classifyIp(c.localAddress);
    if (c.state === 'Listen' && local !== 'loopback' && c.pid > 4) s.listeners.set(`${c.name}|${c.localPort}`, c);
    if (c.state === 'Established' && listenPorts.has(c.localPort) && classifyIp(c.remoteAddress) === 'public') {
      s.inbound.set(`${c.pid}|${c.remoteAddress}|${c.localPort}`, c);
    }
  }
  for (const p of asArray(raw?.processes)) {
    const tool = matchRemoteTool(p);
    if (tool) s.remoteTools.set(tool.name, p);
  }
  for (const r of asArray(raw?.run)) s.run.set(`${r.key}|${r.name}`, r);
  return s;
}

/** Alerts for anything that appeared between two snapshots, except the Run entries in `expected`. */
function diffSnapshots(prev, next, expected = new Set()) {
  if (!prev) return [];
  const alerts = [];
  const added = (a, b) => [...b.keys()].filter((k) => !a.has(k));
  for (const k of added(prev.devices, next.devices)) {
    const d = next.devices.get(k);
    const device = d.cap === 'webcam' ? 'camera' : d.cap;
    alerts.push({ severity: 'warning', title: `${d.name} started using your ${device}`, body: 'If you didn\'t start a call or recording, check Camera & Mic.', view: 'security/privacy' });
  }
  for (const k of added(prev.inbound, next.inbound)) {
    const c = next.inbound.get(k);
    alerts.push({ severity: 'warning', title: `Incoming connection from ${c.remoteAddress}`, body: `${c.name || 'A program'} accepted a connection from the internet on port ${c.localPort}.`, view: 'security/network' });
  }
  for (const k of added(prev.remoteTools, next.remoteTools)) {
    alerts.push({ severity: 'danger', title: `${k} just started`, body: 'Remote-control software lets someone see and control your screen.', view: 'security/network' });
  }
  for (const k of added(prev.listeners, next.listeners)) {
    const c = next.listeners.get(k);
    alerts.push({ severity: 'notice', title: `${c.name || 'A program'} opened port ${c.localPort}`, body: 'It now accepts connections from other devices.', view: 'security/network' });
  }
  for (const k of added(prev.run, next.run)) {
    if (expected.has(k)) continue;
    const r = next.run.get(k);
    alerts.push({ severity: 'warning', title: `New startup program: ${r.name}`, body: r.command, view: 'security/startup' });
  }
  for (const f of next.startup) {
    if (!prev.startup.has(f)) alerts.push({ severity: 'warning', title: 'New file in your Startup folder', body: f, view: 'security/startup' });
  }
  for (const t of next.tasks) {
    if (!prev.tasks.has(t)) alerts.push({ severity: 'notice', title: 'New scheduled task', body: t, view: 'security/startup' });
  }
  if (next.rdp && !prev.rdp) {
    alerts.push({ severity: 'danger', title: 'Someone connected with Remote Desktop', body: 'A remote session just started on this PC.', view: 'security/hackcheck' });
  }
  if (prev.threats != null && next.threats != null && next.threats > prev.threats) {
    alerts.push({ severity: 'danger', title: 'Microsoft Defender found a threat', body: 'Open Virus Scan to see what was found.', view: 'security/scan' });
  }
  return alerts;
}

/** Periodically snapshots the PC and reports changes. */
class Guard {
  constructor({ collect, onAlerts, intervalMs = 30_000 }) {
    this.collect = collect;
    this.onAlerts = onAlerts;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.prev = null;
    this.running = false;
    this.lastTick = null;
    this.lastError = null;
    this.expected = new Set();
  }

  /** A Run entry the user just added in opKapot: don't alert when it appears. */
  expect(runKey) {
    this.expected.add(runKey);
  }

  get enabled() {
    return !!this.timer;
  }

  start(intervalMs = this.intervalMs) {
    this.stop();
    this.intervalMs = Math.max(10_000, intervalMs);
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.prev = null;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const next = snapshot(await this.collect());
      const alerts = diffSnapshots(this.prev, next, this.expected);
      for (const k of this.expected) if (next.run.has(k)) this.expected.delete(k);
      this.prev = next;
      this.lastTick = Date.now();
      this.lastError = null;
      if (alerts.length) this.onAlerts(alerts.map((a) => ({ ...a, time: Date.now() })));
    } catch (err) {
      this.lastError = err.message;
    } finally {
      this.running = false;
    }
  }
}

module.exports = { Guard, snapshot, diffSnapshots };
