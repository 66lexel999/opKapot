'use strict';

// Decides what Game Mode keeps running and what it may close or pause.

const path = require('node:path');
const { asObjects, str } = require('../security/analyze/common');
const { LAUNCHERS, KEEP, VOICE_CHAT, APP_HINTS, SERVICES, FC_PROCESS } = require('./knowledge');

const P = path.win32;

// Companies whose background programs drive hardware (touchpads, hotkeys, fans,
// lighting, audio). Closing them can break input or sound, so they stay.
const DRIVER_VENDORS = /hewlett|hp inc|\bhp\b|dell|lenovo|logitech|razer|synaptics|elan micro|elantech|asustek|\basus\b|acer|intel|corsair|steelseries|alps|cypress|samsung|micro-star|\bmsi\b|toshiba|dynabook|fujitsu|roccat|turtle beach|wooting|hyperx|nvidia|advanced micro devices|\bamd\b|realtek|focaltech|huawei|xiaomi|gigabyte|avermedia|elgato|dolby|waves audio|conexant|qualcomm|broadcom|mediatek|rivet networks|killer|a-volute|nahimic|8bitdo|sony interactive|thrustmaster|logitech g|fanatec|moza/i;

function hintFor(name) {
  return APP_HINTS.find(([re]) => re.test(name))?.[1] || '';
}

/**
 * 'game' when a process is the chosen game itself, 'folder' when it lives in
 * the game's folder (anti-cheat, crash reporter), otherwise false.
 */
function gameMatcher(game) {
  const names = new Set((game?.processes || []).map((n) => String(n).toLowerCase()));
  const dir = game?.exe ? P.dirname(game.exe).toLowerCase() : '';
  const fc = /\bFC\b/i.test(game?.name || '') || [...names].some((n) => FC_PROCESS.test(n));
  return (proc) => {
    const n = str(proc.name).toLowerCase();
    if (names.has(n) || (fc && FC_PROCESS.test(n))) return 'game';
    const p = str(proc.path).toLowerCase();
    return !!dir && dir.length > 3 && p.startsWith(`${dir}\\`) ? 'folder' : false;
  };
}

/**
 * Split running processes into "keep" and "can close", and list the services
 * that can be paused. `prefs.unticked` / `prefs.untickedServices` hold the
 * user's earlier choices.
 */
function buildPlan({ processes, services, game, launchers = [], selfPaths = [], selfPids = [], systemRoot = 'C:\\Windows', prefs = {} }) {
  const isGame = gameMatcher(game);
  const launcherRes = launchers.map((l) => LAUNCHERS[l]).filter(Boolean);
  const self = new Set(selfPaths.map((p) => String(p).toLowerCase()));
  const selfPidSet = new Set(selfPids);
  const unticked = new Set((prefs.unticked || []).map((n) => String(n).toLowerCase()));
  const ticked = new Set((prefs.ticked || []).map((n) => String(n).toLowerCase()));
  const sysRoot = `${String(systemRoot).toLowerCase().replace(/\\+$/, '')}\\`;

  const procs = asObjects(processes).filter((p) => p.pid > 4);
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const keptPids = new Set();
  const kept = new Map();
  const keep = (p, why) => {
    keptPids.add(p.pid);
    const key = `${str(p.name).toLowerCase()}|${why}`;
    if (!kept.has(key)) kept.set(key, { name: str(p.name), why, path: str(p.path) });
  };

  const gamePids = [];
  for (const p of procs) {
    const name = str(p.name);
    const file = str(p.path);
    const lower = file.toLowerCase();
    if (selfPidSet.has(p.pid) || self.has(lower) || /^opkapot/i.test(name)) keep(p, 'opKapot');
    else if (isGame(p)) {
      keep(p, 'Your game');
      if (isGame(p) === 'game') gamePids.push(p.pid);
    } else if (launcherRes.some((l) => l.processes.test(name))) keep(p, launcherRes.find((l) => l.processes.test(name)).name);
    else if (!file) keep(p, 'Windows');
    else if (lower.startsWith(sysRoot)) keep(p, 'Windows');
    else if (KEEP.some((re) => re.test(name))) keep(p, 'Drivers, security or Windows');
    else if (DRIVER_VENDORS.test(`${str(p.company)}`)) keep(p, 'Hardware software');
  }
  // Children of the game or a launcher (anti-cheat, crash handlers, web helpers) stay too.
  for (const p of procs) {
    if (keptPids.has(p.pid)) continue;
    let parent = byPid.get(p.parent);
    for (let hops = 0; parent && hops < 4; hops++) {
      if (gamePids.includes(parent.pid) || (keptPids.has(parent.pid) && launcherRes.some((l) => l.processes.test(str(parent.name))))) {
        keep(p, 'Started by your game or launcher');
        break;
      }
      parent = byPid.get(parent.parent);
    }
  }

  // Helpers (browser tabs, web helpers) are grouped under the app that started them.
  const rootOf = (p) => {
    let root = p;
    for (let hops = 0; hops < 5; hops++) {
      const parent = byPid.get(root.parent);
      if (!parent || keptPids.has(parent.pid) || parent.pid === root.pid) break;
      root = parent;
    }
    return root;
  };
  const apps = new Map();
  for (const p of procs) {
    if (keptPids.has(p.pid)) continue;
    const top = rootOf(p);
    const key = str(top.path).toLowerCase();
    if (!apps.has(key)) {
      const name = str(top.name);
      const voice = VOICE_CHAT.test(name);
      const label = str(top.description) || name;
      apps.set(key, {
        id: key,
        name,
        label,
        company: str(top.company),
        path: str(top.path),
        pids: [],
        targets: [],
        helpers: [],
        memory: 0,
        window: false,
        title: '',
        hint: voice ? 'Voice chat: kept unless you tick it' : hintFor(name),
        voice,
        checked: ticked.has(name.toLowerCase()) ? true : unticked.has(name.toLowerCase()) ? false : !voice,
      });
    }
    const a = apps.get(key);
    a.pids.push(p.pid);
    a.targets.push({ pid: p.pid, path: str(p.path) });
    if (p !== top && !a.helpers.includes(str(p.name))) a.helpers.push(str(p.name));
    a.memory += Number(p.memory) || 0;
    if (p.window) {
      a.window = true;
      a.title = a.title || str(p.title);
    }
  }

  const running = new Map(asObjects(services).map((s) => [str(s.name).toLowerCase(), s]));
  const untickedSvc = new Set((prefs.untickedServices || []).map((n) => String(n).toLowerCase()));
  const tickedSvc = new Set((prefs.tickedServices || []).map((n) => String(n).toLowerCase()));
  const svcRows = [];
  const seenSvc = new Set();
  for (const def of SERVICES) {
    const matches = def.prefix
      ? [...running.values()].filter((s) => str(s.name).toLowerCase().startsWith(def.name.toLowerCase()))
      : [running.get(def.name.toLowerCase())].filter(Boolean);
    for (const s of matches) {
      const n = str(s.name);
      if (seenSvc.has(n.toLowerCase()) || s.canStop === false) continue;
      seenSvc.add(n.toLowerCase());
      const l = n.toLowerCase();
      svcRows.push({ name: n, label: def.label, why: def.why, checked: tickedSvc.has(l) ? true : untickedSvc.has(l) ? false : def.default });
    }
  }

  const appList = [...apps.values()].sort((a, b) => (b.window - a.window) || (b.memory - a.memory));
  return {
    apps: appList,
    kept: [...kept.values()].filter((k) => k.why !== 'Windows').sort((a, b) => a.why.localeCompare(b.why) || a.name.localeCompare(b.name)),
    services: svcRows,
    gameRunning: gamePids.length > 0,
    gamePids,
  };
}

/** Parse `tasklist /FO CSV /NH` output into [{ name, pid }]. Works in any language. */
function parseTasklist(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m) out.push({ name: m[1].replace(/\.exe$/i, ''), pid: Number(m[2]) });
  }
  return out;
}

module.exports = { buildPlan, gameMatcher, parseTasklist, DRIVER_VENDORS };
