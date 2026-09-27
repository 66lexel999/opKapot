import { api, esc, h, formatBytes, relativeTime, errorMessage } from '../../util.js';
import { icon } from '../../icons.js';
import { openModal, toast, confirmDialog } from '../../components/overlay.js';
import { securityStore } from '../../securityStore.js';
import { viewHeader, loadingHtml } from '../common.js';
import { appIcon, notSupportedHtml } from '../security/shared.js';

const OPTIONS = [
  ['power', 'High performance power plan', 'Stops the CPU from slowing down to save power. Restored afterwards.'],
  ['priority', 'Give the game high priority', 'Windows serves the game first when the PC is busy.'],
  ['reopen', 'Reopen closed apps afterwards', 'When you turn Game Mode off, apps it closed start again.'],
  ['autoOff', 'Turn off when I close the game', 'Everything is restored automatically when the game exits.'],
];

/** Game Mode: one button that closes what the game doesn't need. */
export class GameModeView {
  constructor() {
    this.plan = null;
    this.games = null;
    this.busy = false;
    this.apps = new Map();
    this.services = new Map();
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'One button to give your game everything.',
        info: 'Closes apps and pauses background services your game doesn\'t need, switches to High performance and raises the game\'s priority. Your launcher, anti-cheat, drivers and antivirus keep running. Everything is restored when you turn it off.',
        actions: '<button class="btn" data-refresh>Refresh list</button>',
      })}
      <div class="gm-body">${loadingHtml('Looking at what\'s running…')}</div>
    </div>`);
    this.body = this.el.querySelector('.gm-body');
    this.el.querySelector('[data-refresh]').addEventListener('click', () => this.load());
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('change', (e) => this.onChange(e));
    api.game.onStatus(() => this.visible && !this.busy && this.load(true));
    securityStore.on('icons', () => this.visible && this.plan && this.render());
    return this.el;
  }

  onShow() {
    this.visible = true;
    this.load();
  }

  onHide() {
    this.visible = false;
  }

  refresh() {
    this.load();
  }

  async load(quiet = false) {
    if (!quiet && !this.plan) this.body.innerHTML = loadingHtml('Looking at what\'s running…');
    try {
      const [plan, games] = await Promise.all([api.game.plan(), this.games ? this.games : api.game.games()]);
      this.plan = plan;
      this.games = games;
      this.apps = new Map(plan.apps.map((a) => [a.id, this.apps.has(a.id) ? this.apps.get(a.id) : a.checked]));
      this.services = new Map(plan.services.map((s) => [s.name, this.services.has(s.name) ? this.services.get(s.name) : s.checked]));
      securityStore.loadIcons([plan.game?.exe, ...plan.apps.map((a) => a.path)]);
      this.render();
    } catch (err) {
      const msg = errorMessage(err);
      this.body.innerHTML = /needs Windows/i.test(msg) ? notSupportedHtml() : `<div class="empty-state">${icon('alert', { size: 40 })}<div>Could not read what's running.</div><div class="empty-sub">${esc(msg)}</div></div>`;
    }
  }

  get active() {
    return this.plan?.status?.active || null;
  }

  render() {
    const p = this.plan;
    if (!p) return;
    const a = this.active;
    const game = p.game || {};
    const chosenApps = p.apps.filter((x) => this.apps.get(x.id));
    const chosenServices = p.services.filter((x) => this.services.get(x.name));
    const freed = chosenApps.reduce((s, x) => s + x.memory, 0);
    const launchers = this.games?.launchers || [];
    const locked = !!a || this.busy;

    this.body.innerHTML = `
      <div class="gm-hero${a ? ' on' : ''}">
        <button class="gm-power${a ? ' on' : ''}" data-toggle ${this.busy ? 'disabled' : ''} aria-pressed="${!!a}" title="${a ? 'Turn Game Mode off' : 'Turn Game Mode on'}">
          ${this.busy ? '<span class="spin big"></span>' : icon('power', { size: 46 })}
          <span>${this.busy ? 'Working…' : a ? 'ON' : 'OFF'}</span>
        </button>
        <div class="gm-hero-text">
          <div class="hero-title">${a ? `Game Mode is on for ${esc(a.game)}` : `Ready to boost ${esc(game.name || 'your game')}`}</div>
          <div class="hero-sub">${a
            ? `On since ${esc(relativeTime(a.since).toLowerCase())}: ${a.closed} apps closed${a.freedBytes ? ` (${formatBytes(a.freedBytes)} of memory freed)` : ''}, ${a.stopped} services paused${a.power ? ', High performance power plan' : ''}.`
            : `Will close ${chosenApps.length} app${chosenApps.length === 1 ? '' : 's'} (about ${formatBytes(freed)} of memory) and pause ${chosenServices.length} service${chosenServices.length === 1 ? '' : 's'}.`}</div>
          ${a ? `<div class="hero-sub muted">${esc(p.options?.autoOff ? 'It turns off by itself when the game closes, or press the button.' : 'Press the button to put everything back.')}</div>`
            : `<div class="hero-sub muted">${p.gameRunning ? `${esc(game.name)} is running: it will get high priority straight away.` : 'Start your game before or after, either works.'}</div>`}
        </div>
      </div>

      <div class="gm-grid">
        <div class="gm-col">
          <div class="card">
            <div class="card-head"><span>Your game</span><button class="btn btn-sm" data-pick ${locked ? 'disabled' : ''}>${icon('swap', { size: 15 })}Change</button></div>
            <div class="game-tile">
              ${appIcon(game.exe, game.name, 44)}
              <div class="name-text">
                <div class="details-name">${esc(game.name || 'No game chosen')}</div>
                <div class="muted small trunc" title="${esc(game.exe)}">${esc(game.exe || (game.preset ? 'Not found on this PC yet. It will be recognised when it runs.' : ''))}</div>
                ${game.platform ? `<span class="pill violet">${esc(game.platform)}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><span>Keep running</span></div>
            <p class="muted small card-lead">Launchers your game needs. ${/FC/.test(game.name || '') ? 'EA SPORTS FC always needs the EA app; tick Steam or Epic if you bought it there.' : 'Tick every launcher the game needs to start.'}</p>
            <div class="chips">${launchers.map((l) => `<label class="chip${(game.launchers || []).includes(l.id) ? ' on' : ''}"><input type="checkbox" data-launcher="${l.id}" ${(game.launchers || []).includes(l.id) ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>${esc(l.name)}</span></label>`).join('')}</div>
            ${p.kept.length ? `<details class="kept"><summary>${p.kept.length} other programs are always kept (drivers, antivirus, controllers)</summary><div class="kept-list">${p.kept.map((k) => `<div><span class="trunc">${esc(k.name)}</span><span class="muted small">${esc(k.why)}</span></div>`).join('')}</div></details>` : ''}
          </div>

          <div class="card">
            <div class="card-head"><span>Also</span></div>
            ${OPTIONS.map(([key, label, hint]) => `<label class="setting slim"><div><div>${esc(label)}</div><div class="muted small">${esc(hint)}</div></div><input type="checkbox" class="switch" data-option="${key}" ${p.options?.[key] ? 'checked' : ''} ${locked ? 'disabled' : ''}></label>`).join('')}
          </div>
        </div>

        <div class="gm-col">
          <div class="card">
            <div class="card-head"><span>${a ? 'Closed apps' : `Apps to close (${chosenApps.length} of ${p.apps.length})`}</span>${a ? '' : `<span><button class="link-btn" data-all="apps">All</button> · <button class="link-btn" data-none="apps">None</button></span>`}</div>
            ${a ? `<div class="chips">${(a.closedApps || []).map((n) => `<span class="chip on static">${esc(n)}</span>`).join('') || '<span class="muted small">None</span>'}</div>`
              : p.apps.length ? `<div class="pick-list">${p.apps.map((x) => `
                <label class="pick-row">
                  <input type="checkbox" data-app="${esc(x.id)}" ${this.apps.get(x.id) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
                  ${appIcon(x.path, x.name, 28)}
                  <div class="name-text"><div class="trunc">${esc(x.label)}${x.pids.length > 1 ? ` <span class="muted small">(${x.pids.length})</span>` : ''}</div><div class="muted small trunc">${esc(x.hint || (x.window ? 'Open window' : 'Runs in the background'))}</div></div>
                  <span class="muted small mem">${formatBytes(x.memory)}</span>
                </label>`).join('')}</div>` : '<div class="muted small">Nothing to close: only your game, launchers and essentials are running.</div>'}
          </div>

          <div class="card">
            <div class="card-head"><span>${a ? 'Paused services' : `Services to pause (${chosenServices.length})`}</span>${a ? '' : `<span><button class="link-btn" data-all="services">All</button> · <button class="link-btn" data-none="services">None</button></span>`}</div>
            ${a ? `<div class="muted small">${a.stopped} Windows services are paused and start again when you turn Game Mode off.</div>`
              : p.services.length ? `<div class="pick-list">${p.services.map((s) => `
                <label class="pick-row">
                  <input type="checkbox" data-service="${esc(s.name)}" ${this.services.get(s.name) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
                  <span class="svc-ico">${icon('settings', { size: 16 })}</span>
                  <div class="name-text"><div class="trunc">${esc(s.label)}</div><div class="muted small trunc">${esc(s.why)}</div></div>
                </label>`).join('')}</div>` : '<div class="muted small">No background services worth pausing are running.</div>'}
          </div>
        </div>
      </div>`;
  }

  async onClick(e) {
    if (e.target.closest('[data-toggle]')) {
      this.toggle();
      return;
    }
    if (e.target.closest('[data-pick]')) {
      this.pickGame();
      return;
    }
    const all = e.target.closest('[data-all]')?.dataset.all;
    const none = e.target.closest('[data-none]')?.dataset.none;
    const which = all || none;
    if (which) {
      const map = which === 'apps' ? this.apps : this.services;
      for (const k of map.keys()) map.set(k, !!all);
      this.render();
    }
  }

  async onChange(e) {
    const t = e.target;
    if (t.dataset.app) {
      this.apps.set(t.dataset.app, t.checked);
      this.render();
    } else if (t.dataset.service) {
      this.services.set(t.dataset.service, t.checked);
      this.render();
    } else if (t.dataset.option) {
      await api.game.options({ [t.dataset.option]: t.checked });
      this.plan.options = { ...this.plan.options, [t.dataset.option]: t.checked };
    } else if (t.dataset.launcher) {
      const game = { ...this.plan.game };
      const set = new Set(game.launchers || []);
      if (t.checked) set.add(t.dataset.launcher);
      else set.delete(t.dataset.launcher);
      game.launchers = [...set];
      try {
        await api.game.select(game);
        await this.load(true);
      } catch (err) {
        toast(esc(errorMessage(err)), 'error');
      }
    }
  }

  async toggle() {
    if (this.busy) return;
    const a = this.active;
    if (!a) {
      const browsers = this.plan.apps.filter((x) => this.apps.get(x.id) && x.window && /^(msedge|chrome|firefox|brave|opera|vivaldi)$/i.test(x.name));
      if (browsers.length) {
        const { ok } = await confirmDialog({
          title: 'Close your browser too?',
          message: `<p>${esc(browsers.map((b) => b.label).join(', '))} will be closed. Your tabs usually come back when it reopens, but save anything you're typing first.</p>`,
          confirmLabel: 'Turn on Game Mode',
        });
        if (!ok) return;
      }
    }
    this.busy = true;
    this.render();
    try {
      const res = a ? await api.game.disable() : await api.game.enable({
        apps: [...this.apps].filter(([, v]) => v).map(([k]) => k),
        services: [...this.services].filter(([, v]) => v).map(([k]) => k),
      });
      toast(esc(res.message), res.ok === false ? 'warn' : 'success', 6000);
    } catch (err) {
      toast(esc(errorMessage(err)), 'error', 8000);
    } finally {
      this.busy = false;
      this.apps = new Map();
      this.services = new Map();
      await this.load(true);
    }
  }

  async pickGame() {
    const games = this.games || await api.game.games();
    const list = [...games.presets, ...games.detected];
    securityStore.loadIcons(list.map((g) => g.exe));
    const row = (g, i, kind) => `<div class="pick-game" data-kind="${kind}" data-i="${i}">
      ${appIcon(g.exe, g.name, 32)}
      <div class="name-text"><div class="trunc">${esc(g.name)}${g.preset ? ' <span class="pill violet">Main</span>' : ''}</div><div class="muted small trunc">${esc(g.platform || '')}${g.exe ? ` · ${esc(g.exe)}` : g.preset ? ' · not installed yet' : ''}</div></div>
      <button class="btn btn-sm btn-violet">Choose</button>
    </div>`;
    const body = h(`<div>
      <div class="seg" data-tab><button data-v="installed" class="on">Games on this PC</button><button data-v="running">Running now</button></div>
      <div class="pick-games" data-list>${list.map((g, i) => row(g, i, 'installed')).join('')}</div>
      <p class="muted small">Not listed? <button class="link-btn" data-browse>Browse for the game's .exe</button> or open the game and look under "Running now".</p>
    </div>`);
    let running = [];
    const modal = openModal({ title: 'Choose your game', width: 640, body, buttons: [{ label: 'Close', onClick: (m) => m.close() }] });
    const choose = async (profile) => {
      try {
        await api.game.select(profile);
        modal.close();
        this.games = null;
        await this.load(true);
        toast(`${esc(profile.name)} selected. Check the launchers it needs under "Keep running".`, 'success', 6000);
      } catch (err) {
        toast(esc(errorMessage(err)), 'error');
      }
    };
    body.addEventListener('click', async (e) => {
      const tab = e.target.closest('[data-tab] button');
      if (tab) {
        for (const b of body.querySelectorAll('[data-tab] button')) b.classList.toggle('on', b === tab);
        const listEl = body.querySelector('[data-list]');
        if (tab.dataset.v === 'running') {
          listEl.innerHTML = loadingHtml('Looking for open programs…');
          try {
            running = await api.game.running();
            securityStore.loadIcons(running.map((r) => r.exe));
            listEl.innerHTML = running.length ? running.map((r, i) => row({ name: r.name, exe: r.exe, platform: r.process }, i, 'running')).join('') : '<div class="muted small">No programs with a window are open.</div>';
          } catch (err) {
            listEl.innerHTML = `<div class="muted small">${esc(errorMessage(err))}</div>`;
          }
        } else {
          listEl.innerHTML = list.map((g, i) => row(g, i, 'installed')).join('');
        }
        return;
      }
      if (e.target.closest('[data-browse]')) {
        const exe = await api.files.pickExe();
        if (exe) {
          const name = exe.split('\\').pop().replace(/\.exe$/i, '');
          const lower = exe.toLowerCase();
          const launchersFor = lower.includes('\\steamapps\\') ? ['steam'] : lower.includes('\\epic games\\') ? ['epic'] : lower.includes('ea games') ? ['ea'] : [];
          choose({ name, exe, processes: [name], launchers: launchersFor, platform: 'Custom' });
        }
        return;
      }
      const item = e.target.closest('.pick-game');
      if (!item) return;
      const i = Number(item.dataset.i);
      if (item.dataset.kind === 'running') {
        const r = running[i];
        const lower = r.exe.toLowerCase();
        const launchersFor = lower.includes('\\steamapps\\') ? ['steam'] : lower.includes('\\epic games\\') ? ['epic'] : /ea games|electronic arts/.test(lower) ? ['ea'] : [];
        choose({ name: r.name, exe: r.exe, processes: [r.process], launchers: launchersFor, platform: 'Running program' });
      } else {
        choose(list[i]);
      }
    });
  }
}
