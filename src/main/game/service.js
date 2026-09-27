'use strict';

const path = require('node:path');
const { runPs } = require('../security/runner');
const { run } = require('../lib/exec');
const { JsonStore } = require('../lib/store');
const { sleep } = require('../services/programs/common');
const { asObjects, str } = require('../security/analyze/common');
const K = require('./knowledge');
const net = require('./net');
const probe = require('./probe');
const G = require('./games');
const { buildPlan, parseTasklist, gameMatcher } = require('./plan');
const demoData = require('./demo');

const SPEED_BASE = 'https://speed.cloudflare.com';
const P = path.win32;
const LAUNCHER_IDS = Object.keys(K.LAUNCHERS);

const DEFAULTS = {
  selected: null,
  prefs: { unticked: [], ticked: [], untickedServices: [], tickedServices: [] },
  options: { power: true, priority: true, reopen: true, autoOff: true },
  active: null,
  lastTest: null,
};

/** Ping & Speed checker and Game Mode. */
class GameService {
  constructor({ demo, userDataDir, runAction, notify = () => {}, broadcast = () => {}, onModeChange = () => {}, addHistory = () => {}, selfPaths = [], env = process.env }) {
    this.demo = !!demo;
    this.platform = process.platform;
    this.env = env;
    this.runAction = runAction;
    this.notify = notify;
    this.broadcast = broadcast;
    this.onModeChange = onModeChange;
    this.addHistory = addHistory;
    this.selfPaths = selfPaths;
    this.store = new JsonStore(path.join(userDataDir, 'game.json'), DEFAULTS);
    this.detected = [];
    this.demoGameRunning = false;
    this.speedBase = SPEED_BASE;
    if (this.store.get().active) {
      this.onModeChange(true);
      this.startWatcher();
    }
  }

  get supported() {
    return this.demo || this.platform === 'win32';
  }

  get data() {
    return { ...DEFAULTS, ...this.store.get() };
  }

  save(patch) {
    this.store.set({ ...this.data, ...patch });
  }

  async collect(name, params = {}, opts = {}) {
    if (!this.demo) {
      if (this.platform !== 'win32') throw new Error('Game Booster needs Windows.');
      return runPs(name, params, opts);
    }
    await sleep(name === 'netinfo' ? 1200 : 300);
    if (name === 'gamescan') return { processes: demoData.processes({ gameRunning: this.demoGameRunning }), services: demoData.services, power: { active: `Power Scheme GUID: ${K.POWER.balanced}  (Balanced)`, list: [] } };
    if (name === 'netinfo') return demoData.netinfo();
    if (name === 'ping') {
      await sleep((params.count || 20) * Math.min(120, params.intervalMs || 200));
      return demoData.ping(params.targets || [], { loaded: params.loaded });
    }
    return {};
  }

  // ------------------------------------------------------------- games ---

  async games() {
    if (!this.supported) throw new Error('Game Booster needs Windows.');
    let detected = [];
    if (this.demo) {
      detected = demoData.games;
    } else {
      try {
        const raw = await this.collect('games', {}, { timeout: 60_000 });
        detected = G.detectGames(raw, { programData: this.env.ProgramData });
      } catch { /* nothing detected */ }
    }
    this.detected = detected;
    const presets = G.presetProfiles(detected);
    const presetExes = new Set(presets.map((p) => p.exe.toLowerCase()).filter(Boolean));
    return {
      presets,
      detected: detected.map(G.gameProfile).filter((g) => !presetExes.has(g.exe.toLowerCase())),
      selected: this.selected(presets),
      launchers: LAUNCHER_IDS.map((id) => ({ id, name: K.LAUNCHERS[id].name })),
    };
  }

  /** Programs with a window right now, for "pick the game that's running". */
  async running() {
    const raw = await this.collect('gamescan', {}, { timeout: 60_000 });
    const sys = `${String(this.env.SystemRoot || 'C:\\Windows').toLowerCase()}\\`;
    const seen = new Map();
    for (const p of asObjects(raw.processes)) {
      const file = str(p.path);
      if (!p.window || !file || file.toLowerCase().startsWith(sys) || this.selfPaths.some((s) => s.toLowerCase() === file.toLowerCase())) continue;
      if (!seen.has(file.toLowerCase())) seen.set(file.toLowerCase(), { name: str(p.title) || str(p.description) || str(p.name), process: str(p.name), exe: file, memory: 0 });
      seen.get(file.toLowerCase()).memory += Number(p.memory) || 0;
    }
    return [...seen.values()].sort((a, b) => b.memory - a.memory);
  }

  selected(presets = G.presetProfiles(this.detected)) {
    return this.data.selected || presets[0];
  }

  /** Remember the chosen game and which launchers it needs. */
  select(profile) {
    const exe = str(profile?.exe);
    const name = str(profile?.name).slice(0, 120) || P.basename(exe).replace(/\.exe$/i, '');
    if (!name) throw new Error('Choose a game first.');
    const processes = [...new Set([...(Array.isArray(profile.processes) ? profile.processes : []).map(str), P.basename(exe).replace(/\.exe$/i, '')].filter((n) => n && /^[\w .()+-]{1,80}$/.test(n)))];
    if (!processes.length) throw new Error('This game has no program file.');
    const launchers = [...new Set((Array.isArray(profile.launchers) ? profile.launchers : []).filter((l) => LAUNCHER_IDS.includes(l)))];
    // EA SPORTS FC always runs through the EA app, whichever store sold it.
    if (processes.some((n) => K.FC_PROCESS.test(n)) && !launchers.includes('ea')) launchers.unshift('ea');
    const game = { id: str(profile.id) || `custom:${exe.toLowerCase()}`, name, exe, processes, launchers, platform: str(profile.platform), preset: !!profile.preset };
    this.save({ selected: game });
    return game;
  }

  setOptions(patch = {}) {
    const options = { ...this.data.options };
    for (const k of Object.keys(DEFAULTS.options)) if (typeof patch[k] === 'boolean') options[k] = patch[k];
    this.save({ options });
    return options;
  }

  // ---------------------------------------------------------- Game Mode ---

  async scan() {
    const raw = await this.collect('gamescan', {}, { timeout: 60_000 });
    const game = this.selected();
    const plan = buildPlan({
      processes: raw.processes,
      services: raw.services,
      game,
      launchers: game.launchers,
      selfPaths: this.selfPaths,
      selfPids: [process.pid],
      systemRoot: this.env.SystemRoot || 'C:\\Windows',
      prefs: this.data.prefs,
    });
    return { raw, plan, game };
  }

  async plan() {
    if (!this.supported) throw new Error('Game Booster needs Windows.');
    const { plan, game } = await this.scan();
    return { ...plan, game, options: this.data.options, status: this.status() };
  }

  async enable({ apps = [], services = [] } = {}) {
    if (!this.supported) throw new Error('Game Mode needs Windows.');
    if (this.data.active) throw new Error('Game Mode is already on.');
    const { plan, game } = await this.scan();
    const options = this.data.options;
    const wantApps = new Set(apps.map((a) => String(a).toLowerCase()));
    const wantServices = new Set(services.map((s) => String(s).toLowerCase()));

    // Remember choices so next time starts the same way.
    this.save({
      prefs: {
        unticked: plan.apps.filter((a) => !wantApps.has(a.id) && !a.voice).map((a) => a.name),
        ticked: plan.apps.filter((a) => wantApps.has(a.id) && a.voice).map((a) => a.name),
        untickedServices: plan.services.filter((s) => !wantServices.has(s.name.toLowerCase())).map((s) => s.name),
        tickedServices: plan.services.filter((s) => wantServices.has(s.name.toLowerCase())).map((s) => s.name),
      },
    });

    const result = { closed: [], stopped: [], power: null, priority: false, freedBytes: 0, problems: [] };
    const toClose = plan.apps.filter((a) => wantApps.has(a.id));
    if (toClose.length) {
      const res = await this.runAction({ type: 'close-apps', targets: toClose.flatMap((a) => a.targets) });
      const reported = Array.isArray(res.data?.closed) ? res.data.closed : res.data?.closed != null ? [res.data.closed] : [];
      const closedPids = new Set(this.demo ? toClose.flatMap((a) => a.pids) : reported.map(Number));
      for (const a of toClose) {
        if (a.pids.some((pid) => closedPids.has(pid))) {
          result.closed.push({ name: a.label || a.name, path: a.path, window: a.window, voice: a.voice });
          result.freedBytes += a.memory;
        }
      }
      if (!res.ok) result.problems.push(res.message);
    }
    const svc = plan.services.filter((s) => wantServices.has(s.name.toLowerCase())).map((s) => s.name);
    if (svc.length) {
      const res = await this.runAction({ type: 'services-stop', names: svc });
      result.stopped = this.demo ? svc : (Array.isArray(res.data?.stopped) ? res.data.stopped : []).map(str).filter(Boolean);
      if (!res.ok) result.problems.push(res.message);
    }
    if (options.power) {
      const res = await this.runAction({ type: 'power-high' });
      if (res.ok) result.power = this.demo ? { previous: K.POWER.balanced, active: K.POWER.high, created: '' } : res.data || null;
      else result.problems.push(res.message);
    }
    if (options.priority && plan.gamePids.length) {
      const res = await this.runAction({ type: 'priority-high', pids: plan.gamePids });
      result.priority = res.ok;
    }

    const active = {
      since: Date.now(),
      game: { id: game.id, name: game.name, processes: game.processes, exe: game.exe },
      closed: result.closed,
      stopped: result.stopped,
      power: result.power,
      boosted: plan.gamePids,
      seenGame: plan.gameRunning,
      missing: 0,
      freedBytes: result.freedBytes,
    };
    this.save({ active });
    this.onModeChange(true);
    this.startWatcher();
    this.addHistory({ type: 'game', title: `Game Mode on for ${game.name}`, detail: `${result.closed.length} apps closed, ${result.stopped.length} services paused`, bytes: 0 });
    this.broadcast(this.status());
    const bits = [
      result.closed.length ? `closed ${result.closed.length} app${result.closed.length === 1 ? '' : 's'}` : '',
      result.stopped.length ? `paused ${result.stopped.length} service${result.stopped.length === 1 ? '' : 's'}` : '',
      result.power ? 'switched to High performance' : '',
    ].filter(Boolean);
    return { ok: true, message: `Game Mode is on${bits.length ? `: ${bits.join(', ')}` : ''}.${result.problems.length ? ` Note: ${result.problems[0]}` : ''}`, result, status: this.status() };
  }

  async disable({ auto = false } = {}) {
    const a = this.data.active;
    if (!a) return { ok: true, message: 'Game Mode is already off.', status: this.status() };
    this.stopWatcher();
    const problems = [];
    if (a.stopped?.length) {
      const res = await this.runAction({ type: 'services-start', names: a.stopped });
      if (!res.ok) problems.push(res.message);
    }
    if (a.power?.previous) {
      const res = await this.runAction({ type: 'power-restore', previous: a.power.previous, created: a.power.created || '' });
      if (!res.ok) problems.push(res.message);
    }
    let reopened = 0;
    if (this.data.options.reopen && a.closed?.length) {
      // Store apps (WindowsApps) can't be started from their file, so they're left closed.
      const paths = [...new Set(a.closed.filter((c) => c.path && !/\\windowsapps\\/i.test(c.path)).map((c) => c.path))];
      if (paths.length) {
        const res = await this.runAction({ type: 'reopen-apps', paths });
        if (res.ok) reopened = paths.length;
      }
    }
    this.save({ active: null });
    this.onModeChange(false);
    this.addHistory({ type: 'game', title: 'Game Mode off', detail: auto ? `${a.game?.name || 'The game'} closed` : 'Turned off', bytes: 0 });
    const status = this.status();
    this.broadcast(status);
    const parts = [];
    if (a.stopped?.length) parts.push('services restarted');
    if (a.power) parts.push('power plan restored');
    if (reopened) parts.push(`${reopened} app${reopened === 1 ? '' : 's'} reopened`);
    const message = `Game Mode is off${parts.length ? `: ${parts.join(', ')}` : ''}.`;
    if (auto) this.notify({ severity: 'warning', title: 'Game Mode turned off', body: `${a.game?.name || 'Your game'} closed, so everything was restored.`, view: 'game/mode' });
    return { ok: problems.length === 0, message: problems.length ? `${message} ${problems[0]}` : message, status };
  }

  status() {
    const a = this.data.active;
    return {
      supported: this.supported,
      demo: this.demo,
      active: a ? {
        since: a.since,
        game: a.game?.name || '',
        closed: a.closed?.length || 0,
        closedApps: (a.closed || []).map((c) => c.name),
        stopped: a.stopped?.length || 0,
        power: !!a.power,
        freedBytes: a.freedBytes || 0,
        gameRunning: !!a.seenGame && !a.missing,
      } : null,
      options: this.data.options,
    };
  }

  // Watches for the game starting (to raise its priority) and closing (to turn off).
  startWatcher() {
    this.stopWatcher();
    if (!this.data.active || this.demo || this.platform !== 'win32') return;
    this.watchTimer = setInterval(() => this.checkGame().catch(() => {}), 15_000);
  }

  stopWatcher() {
    clearInterval(this.watchTimer);
    this.watchTimer = null;
  }

  async checkGame() {
    const a = this.data.active;
    if (!a || this.checking) return;
    this.checking = true;
    try {
      const res = await run('tasklist.exe', ['/FO', 'CSV', '/NH'], { timeout: 20_000 });
      if (res.code !== 0) return;
      const isGame = gameMatcher({ ...a.game, exe: '' });
      const pids = parseTasklist(res.stdout).filter((p) => isGame(p) === 'game').map((p) => p.pid);
      if (pids.length) {
        const fresh = pids.filter((pid) => !(a.boosted || []).includes(pid));
        if (fresh.length && this.data.options.priority) await this.runAction({ type: 'priority-high', pids: fresh });
        this.save({ active: { ...a, boosted: pids, seenGame: true, missing: 0 } });
      } else if (a.seenGame) {
        const missing = (a.missing || 0) + 1;
        this.save({ active: { ...a, missing } });
        if (missing >= 2 && this.data.options.autoOff) await this.disable({ auto: true });
      }
    } finally {
      this.checking = false;
    }
  }

  // ------------------------------------------------------ Ping & Speed ---

  /** Full connection test. `onProgress` gets { step, text, ... } as it goes. */
  async netTest(onProgress = () => {}, { speed = true, signal } = {}) {
    if (!this.supported) throw new Error('The ping checker needs Windows.');
    const t0 = Date.now();
    onProgress({ step: 1, text: 'Looking at your connection…' });
    const raw = await this.collect('netinfo', {}, { timeout: 60_000 });
    const info = net.connectionInfo(raw);
    const game = this.selected();
    const live = net.gameServers(raw, gameMatcher(game));

    onProgress({ step: 2, text: 'Pinging your router, the internet and game-server regions…' });
    const targets = [
      info.gateway ? { id: 'router', host: info.gateway } : null,
      { id: 'cloudflare', host: '1.1.1.1' },
      { id: 'google', host: '8.8.8.8' },
    ].filter(Boolean);
    const [pingRaw, regions, liveServers] = await Promise.all([
      this.collect('ping', { targets, count: 24, intervalMs: 250, timeoutMs: 1000 }, { timeout: 90_000 }),
      this.regionPings(),
      this.demo ? [] : Promise.all(live.servers.map(async (s) => ({ ...s, ms: probe.bestOf((await probe.tcpPing(s.ip, s.port, { count: 3 })).samples) }))),
    ]);
    const results = new Map(asObjects(pingRaw.results).map((r) => [str(r.id), r]));
    const router = results.has('router') ? { ...net.pingStats(results.get('router').samples), samples: results.get('router').samples } : null;
    const cf = net.pingStats(results.get('cloudflare')?.samples);
    const gg = net.pingStats(results.get('google')?.samples);
    const bestId = (cf.avg ?? Infinity) <= (gg.avg ?? Infinity) ? 'cloudflare' : 'google';
    const internet = { ...(bestId === 'cloudflare' ? cf : gg), host: bestId === 'cloudflare' ? '1.1.1.1' : '8.8.8.8', samples: results.get(bestId)?.samples || [] };

    let speedResult = null;
    let loaded = null;
    if (speed && !signal?.aborted) {
      onProgress({ step: 3, text: 'Measuring download speed (and ping while busy)…' });
      const [down, loadedRaw] = await Promise.all([
        this.speedRun('down', onProgress, signal),
        this.collect('ping', { targets: [{ id: 'loaded', host: internet.host }], count: 22, intervalMs: 300, timeoutMs: 1500, loaded: true }, { timeout: 90_000 }),
      ]);
      const ls = asObjects(loadedRaw.results)[0]?.samples;
      loaded = { ...net.pingStats(ls), samples: ls || [] };
      onProgress({ step: 4, text: 'Measuring upload speed…' });
      const up = await this.speedRun('up', onProgress, signal);
      speedResult = { download: down.mbps, upload: up.mbps };
    }

    onProgress({ step: 5, text: 'Working out what could cause lag…' });
    const gameInfo = { running: live.running || (this.demo && this.demoGameRunning), servers: liveServers };
    const findings = net.diagnose({ info, router, internet, loaded, regions, speed: speedResult, game: gameInfo });
    const result = {
      time: Date.now(),
      durationMs: Date.now() - t0,
      demo: this.demo,
      info,
      router,
      internet,
      loaded,
      bufferbloat: net.bufferbloat(internet.avg, loaded?.avg),
      regions,
      game: { name: game.name, ...gameInfo },
      speed: speedResult,
      findings,
    };
    this.save({ lastTest: { time: result.time, ping: internet.avg, jitter: internet.jitter, loss: internet.loss, download: speedResult?.download ?? null, upload: speedResult?.upload ?? null, grade: result.bufferbloat?.grade || null } });
    return result;
  }

  async regionPings() {
    if (this.demo) {
      await sleep(900);
      return K.REGIONS.map((r) => ({ id: r.id, name: r.name, ms: demoData.REGION_MS[r.id] + Math.round(Math.random() * 3) }));
    }
    const out = await Promise.all(K.REGIONS.map(async (r) => {
      const res = await probe.tcpPing(r.host, r.port, { count: 3, timeoutMs: 2500 });
      return { id: r.id, name: r.name, ms: probe.bestOf(res.samples) };
    }));
    return out.sort((a, b) => (a.ms ?? 9999) - (b.ms ?? 9999));
  }

  async speedRun(direction, onProgress, signal) {
    const seconds = direction === 'down' ? 8 : 6;
    if (this.demo) {
      const target = direction === 'down' ? 74.3 : 18.6;
      for (let t = 0; t < seconds * 4; t++) {
        await sleep(250);
        onProgress({ step: direction === 'down' ? 3 : 4, speed: { direction, mbps: Math.round(target * Math.min(1, (t + 2) / 8) * (0.93 + Math.random() * 0.1) * 10) / 10 } });
      }
      return { mbps: target };
    }
    return probe.transfer({
      base: this.speedBase,
      direction,
      seconds,
      streams: direction === 'down' ? 6 : 4,
      signal,
      onProgress: (p) => onProgress({ step: direction === 'down' ? 3 : 4, speed: { direction, mbps: Math.round(p.mbps * 10) / 10 } }),
    });
  }

  lastTest() {
    return this.data.lastTest;
  }

  async netAction(kind) {
    const types = { 'dns-flush': 'dns-flush', 'net-reset': 'net-reset' };
    if (!types[kind]) throw new Error('Unknown action.');
    return this.runAction({ type: types[kind] });
  }
}

module.exports = { GameService };
