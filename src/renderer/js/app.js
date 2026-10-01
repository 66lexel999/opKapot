import { api, esc, h, formatBytes, relativeTime } from './util.js';
import { icon } from './icons.js';
import { appState, programsStore } from './store.js';
import { securityStore } from './securityStore.js';
import { setNavigator } from './router.js';
import { closeMenu, closeTopModal, hasOpenModal, openLocation, showMenu, toast } from './components/overlay.js';
import { ProgramsView } from './views/programs.js';
import { FilesView } from './views/files.js';
import { DuplicatesView } from './views/duplicates.js';
import { AnalyzerView } from './views/analyzer.js';
import { JunkView } from './views/junk.js';
import { AppsView } from './views/apps.js';
import { HistoryView } from './views/history.js';
import { SecurityCenterView } from './views/security/center.js';
import { VirusScanView } from './views/security/scan.js';
import { HackCheckView } from './views/security/hackcheck.js';
import { NetworkView } from './views/security/network.js';
import { StartupView } from './views/security/startup.js';
import { ExtensionsView } from './views/security/extensions.js';
import { PrivacyView } from './views/security/privacy.js';
import { QuarantineView } from './views/security/quarantine.js';
import { GameModeView } from './views/game/mode.js';
import { PingView } from './views/game/ping.js';
import { openAbout, openSettings } from './dialogs/settings.js';

// Three sections; each child view belongs to exactly one.
const SECTIONS = [
  {
    id: 'security', label: 'Security', icon: 'shieldFill', tone: 'green',
    groups: [{
      items: [
        ['security/center', 'Security Center', 'shieldOk', () => new SecurityCenterView()],
        ['security/scan', 'Virus Scan', 'virus', () => new VirusScanView()],
        ['security/hackcheck', 'Hack Check', 'hacker', () => new HackCheckView()],
        ['security/network', 'Network Monitor', 'network', () => new NetworkView()],
        ['security/startup', 'Startup Manager', 'rocket', () => new StartupView()],
        ['security/extensions', 'Browser Extensions', 'puzzle', () => new ExtensionsView()],
        ['security/privacy', 'Camera & Mic', 'camera', () => new PrivacyView()],
        ['security/quarantine', 'Quarantine', 'vault', () => new QuarantineView()],
      ],
    }],
  },
  {
    id: 'uninstaller', label: 'Uninstaller', icon: 'trash', tone: 'orange',
    groups: [
      {
        caption: 'Programs',
        items: [
          ['programs/all', 'All Programs', 'programs', () => new ProgramsView('all')],
          ['programs/bundleware', 'Bundleware', 'box', () => new ProgramsView('bundleware')],
          ['programs/recent', 'Recently Installed', 'download', () => new ProgramsView('recent')],
          ['programs/large', 'Large Programs', 'disk', () => new ProgramsView('large')],
          ['programs/infrequent', 'Infrequently Used', 'history', () => new ProgramsView('infrequent')],
          ['apps', 'Windows Apps', 'windows', () => new AppsView()],
        ],
      },
      {
        caption: 'Files',
        items: [
          ['files/all', 'All Files', 'folder', () => new FilesView('all')],
          ['files/large', 'Large Files', 'file', () => new FilesView('large')],
          ['files/duplicates', 'Duplicate Files', 'copy', () => new DuplicatesView()],
          ['files/analyzer', 'Space Analyzer', 'pie', () => new AnalyzerView()],
        ],
      },
      {
        caption: 'Clean up',
        items: [
          ['junk', 'Junk Cleaner', 'broom', () => new JunkView()],
          ['history', 'History', 'log', () => new HistoryView()],
        ],
      },
    ],
  },
  {
    id: 'game', label: 'Game Booster', icon: 'gamepad', tone: 'violet',
    groups: [{
      items: [
        ['game/mode', 'Game Mode', 'bolt', () => new GameModeView()],
        ['game/ping', 'Ping & Speed', 'gauge', () => new PingView()],
      ],
    }],
  },
];

const factories = new Map();
const sectionOf = new Map();
for (const section of SECTIONS) {
  for (const group of section.groups) {
    for (const [id, , , make] of group.items) {
      factories.set(id, make);
      sectionOf.set(id, section.id);
    }
  }
}

const views = new Map();
let current = null;
let currentId = null;
const collapsed = new Set();
const lastInSection = new Map();
try {
  for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem('opk:last-in-section') || '{}'))) if (factories.has(v)) lastInSection.set(k, v);
} catch { /* storage unavailable */ }

function sectionBadge(id) {
  if (id === 'security') {
    const st = securityStore.status;
    if (st?.overall === 'danger') return '<span class="nav-dot" title="Problems found"></span>';
    if (st?.overall === 'warning') return '<span class="nav-dot warn" title="Needs attention"></span>';
  }
  if (id === 'game' && gameActive) return '<span class="nav-on">ON</span>';
  if (id === 'uninstaller' && unseenHistory) return '<span class="nav-dot" title="New in History"></span>';
  return '';
}

function renderNav() {
  const nav = document.getElementById('nav');
  const currentSection = sectionOf.get(currentId);
  nav.innerHTML = SECTIONS.map((section) => {
    const here = currentSection === section.id;
    const open = here && !collapsed.has(section.id);
    const head = `<button class="sec-head${here ? ' here' : ''}" data-section="${section.id}" aria-expanded="${open}">
      <span class="sec-badge">${icon(section.icon, { size: 18 })}</span><span class="sec-label">${esc(section.label)}</span>${sectionBadge(section.id)}
      <span class="nav-chev">${icon(open ? 'chevronDown' : 'chevronRight', { size: 15 })}</span></button>`;
    const body = open ? `<div class="sec-children">${section.groups.map((g) => `
      ${g.caption ? `<div class="sec-caption">${esc(g.caption)}</div>` : ''}
      ${g.items.map(([id, label, ic]) => `<div class="nav-item${currentId === id ? ' active' : ''}" data-go="${id}">${icon(ic, { size: 17 })}<span>${esc(label)}</span>${id === 'history' && unseenHistory ? '<span class="nav-dot"></span>' : ''}</div>`).join('')}`).join('')}
    </div>` : '';
    return `<div class="nav-section tone-${section.tone}${open ? ' open' : ''}${here ? ' here' : ''}">${head}${body}</div>`;
  }).join('');
}

function onSectionClick(sectionId) {
  const section = SECTIONS.find((x) => x.id === sectionId);
  if (!section) return;
  if (sectionOf.get(currentId) === sectionId) {
    if (collapsed.has(sectionId)) collapsed.delete(sectionId);
    else collapsed.add(sectionId);
    renderNav();
    return;
  }
  collapsed.delete(sectionId);
  navigate(lastInSection.get(sectionId) || section.groups[0].items[0][0]);
}

function navigate(id) {
  if (!factories.has(id) || id === currentId) return;
  closeMenu();
  current?.onHide?.();
  if (!views.has(id)) views.set(id, factories.get(id)());
  current = views.get(id);
  currentId = id;
  if (id === 'history') unseenHistory = false;
  lastInSection.set(sectionOf.get(id), id);
  try {
    localStorage.setItem('opk:last-in-section', JSON.stringify(Object.fromEntries(lastInSection)));
  } catch { /* storage unavailable */ }
  const host = document.getElementById('view-host');
  host.replaceChildren(current.mount());
  current.onShow?.();
  renderNav();
  renderBottomBar();
  try {
    localStorage.setItem('opk:view', id);
  } catch { /* storage unavailable */ }
}

// ------------------------------------------------------------ bottom bar ---

function ring(pct) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const color = pct >= 90 ? 'var(--danger)' : pct >= 75 ? 'var(--orange)' : 'var(--accent)';
  return `<svg class="ring" width="56" height="56" viewBox="0 0 56 56">
    <circle cx="28" cy="28" r="${r}" stroke="#2c2c2c" stroke-width="6" fill="none"/>
    <circle cx="28" cy="28" r="${r}" stroke="${color}" stroke-width="6" fill="none" stroke-linecap="round"
      stroke-dasharray="${(c * pct) / 100} ${c}" transform="rotate(-90 28 28)"/>
    <text x="28" y="32.5" text-anchor="middle" fill="#eee" font-size="13" font-weight="600">${Math.round(pct)}%</text></svg>`;
}

function renderSecurityBar(bar) {
  const st = securityStore.status;
  if (!st || !st.supported) {
    bar.innerHTML = '';
    return;
  }
  const guardOn = appState.settings.guardEnabled && st.guard.enabled;
  const tone = st.overall === 'danger' ? 'danger' : st.overall === 'warning' ? 'warning' : 'ok';
  const title = { danger: 'Your PC needs attention', warning: 'A few things need your attention', ok: 'Your PC is protected' }[tone];
  const parts = [
    st.antivirus.on ? `${esc(st.antivirus.name)} is on` : 'Antivirus is off',
    guardOn ? 'Real-time Guard is watching' : 'Real-time Guard is off',
    `Last virus scan: ${st.lastScanTime ? esc(relativeTime(st.lastScanTime).toLowerCase()) : 'never'}`,
  ];
  bar.innerHTML = `
    <div class="bb-shield sec-${tone}">${icon(tone === 'ok' ? 'shieldOk' : 'shieldAlert', { size: 34 })}</div>
    <div class="bb-text"><div class="bb-title">${esc(title)}</div><div class="bb-sub">${parts.join(' · ')}</div></div>
    <div class="bb-actions">${currentId === 'security/center'
    ? '<button class="btn btn-orange" data-go="security/scan">Virus Scan</button><a class="link" data-go="security/network">Who is connected?</a>'
    : '<button class="btn btn-orange" data-go="security/center" data-smart-scan>Smart Scan</button><a class="link" data-go="security/hackcheck">Run Hack Check</a>'}</div>`;
}

let gameStatus = null;
let lastNetTest = null;

function renderGameBar(bar) {
  const a = gameStatus?.active;
  if (!gameStatus?.supported) {
    bar.innerHTML = '';
    return;
  }
  const t = lastNetTest;
  const net = t ? `Last test: ${t.ping ?? '?'} ms ping, ${t.jitter ?? '?'} ms jitter${t.download != null ? `, ${t.download} Mbps down` : ''} (${esc(relativeTime(t.time).toLowerCase())})` : 'Run Ping & Speed to see what causes lag.';
  bar.innerHTML = `
    <div class="bb-shield ${a ? 'tone-violet on' : 'tone-violet'}">${icon(a ? 'bolt' : 'gamepad', { size: 30 })}</div>
    <div class="bb-text"><div class="bb-title">${a ? `Game Mode is on for ${esc(a.game)}` : 'Game Mode is off'}</div>
      <div class="bb-sub">${a ? `${a.closed} apps closed · ${a.stopped} services paused${a.power ? ' · High performance' : ''} · ${esc(relativeTime(a.since).toLowerCase())}` : net}</div></div>
    <div class="bb-actions">${currentId === 'game/mode'
    ? '<button class="btn btn-orange btn-violet" data-go="game/ping">Test my ping</button><a class="link" data-go="security/network">Who is connected?</a>'
    : `<button class="btn btn-orange btn-violet" data-go="game/mode">${a ? 'Game Mode: ON' : 'Open Game Mode'}</button><a class="link" data-go="security/center">Security Center</a>`}</div>`;
}

function renderBottomBar() {
  const bar = document.getElementById('bottom-bar');
  if (currentId?.startsWith('security/')) {
    renderSecurityBar(bar);
    return;
  }
  if (currentId?.startsWith('game/')) {
    renderGameBar(bar);
    return;
  }
  const drive = appState.systemDrive;
  if (!drive) {
    bar.innerHTML = '';
    return;
  }
  const pct = drive.total ? ((drive.total - drive.free) / drive.total) * 100 : 0;
  const label = appState.isWindows ? `${drive.label.replace(':', '')} Drive` : 'Disk';
  const title = pct >= 75 ? `${label} ${Math.round(pct)}% full? Reclaim your space in seconds!` : `${label}: ${formatBytes(drive.free)} free of ${formatBytes(drive.total)}`;
  bar.innerHTML = `
    ${ring(pct)}
    <div class="bb-text"><div class="bb-title">${esc(title)}</div>
      <div class="bb-sub">Remove stubborn, unused or massive apps in one click, find large files and clean junk. ${pct >= 75 ? `${esc(formatBytes(drive.free))} free of ${esc(formatBytes(drive.total))}.` : ''}</div></div>
    <div class="bb-actions"><button class="btn btn-orange" data-go="junk">Clean Junk Now</button><a class="link" data-go="files/large">Find Large Files</a></div>`;
}

// ------------------------------------------------------------- title bar ---

function wireTitleBar() {
  const maxBtn = document.getElementById('win-max');
  const setMax = (maximized) => {
    maxBtn.innerHTML = icon(maximized ? 'restore' : 'maximize', { size: 16 });
    maxBtn.title = maximized ? 'Restore' : 'Maximize';
  };
  setMax(false);
  document.getElementById('win-min').innerHTML = icon('minimize', { size: 16 });
  document.getElementById('win-close').innerHTML = icon('close', { size: 16 });
  document.getElementById('btn-refresh').innerHTML = icon('refresh', { size: 19 });
  document.getElementById('btn-settings').innerHTML = icon('settings', { size: 19 });
  document.getElementById('btn-menu').innerHTML = icon('menu', { size: 20 });

  document.getElementById('win-min').addEventListener('click', () => api.win.minimize());
  maxBtn.addEventListener('click', async () => setMax(await api.win.toggleMaximize()));
  document.getElementById('win-close').addEventListener('click', () => api.win.close());
  api.win.onMaximizeChange(setMax);
  document.querySelector('.titlebar').addEventListener('dblclick', async (e) => {
    if (!e.target.closest('button')) setMax(await api.win.toggleMaximize());
  });

  document.getElementById('btn-refresh').addEventListener('click', () => current?.refresh?.());
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-menu').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.right - 220, r.bottom + 4, [
      { label: 'Settings', icon: 'settings', onClick: openSettings },
      { label: 'History', icon: 'history', onClick: () => navigate('history') },
      { label: 'Security Center', icon: 'shieldOk', onClick: () => navigate('security/center') },
      { label: 'Refresh program list', icon: 'refresh', onClick: () => programsStore.load(true) },
      '-',
      { label: 'About opKapot', icon: 'info', onClick: openAbout },
    ]);
  });
}

// -------------------------------------------------------------- keyboard ---

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input, select, textarea');
    if (e.key === 'Escape') {
      closeMenu();
      closeTopModal();
      return;
    }
    if (hasOpenModal()) return;
    if (e.key === 'F5') {
      e.preventDefault();
      current?.refresh?.();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      current?.focusSearch?.();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
      e.preventDefault();
      current?.selectAll?.();
    } else if (e.key === 'Delete' && !typing) {
      current?.primaryAction?.();
    }
  });
}

// ------------------------------------------------------------- security ---

const ALERT_TOAST = { danger: 'error', warning: 'warn', notice: 'info' };

function wireSecurity() {
  securityStore.on('status', () => {
    renderNav();
    if (currentId?.startsWith('security/')) renderBottomBar();
  });
  api.security.onAlerts((alerts) => {
    for (const a of (alerts || []).slice(0, 3)) {
      const link = a.view ? ` <a class="link-btn" data-go="${esc(a.view)}">Show</a>` : '';
      toast(`<b>${esc(a.title)}</b>${a.body ? `<div class="muted small">${esc(a.body)}</div>` : ''}${link}`, ALERT_TOAST[a.severity] || 'info', 9000);
    }
  });
  api.app.onNavigate((id) => navigate(id));
  api.app.onSettingsChanged((settings) => {
    appState.settings = settings;
    appState.emit('settings', settings);
  });
  appState.on('settings', () => securityStore.loadStatus());
  securityStore.loadStatus();
}

function wireGame() {
  const apply = (st) => {
    gameStatus = st;
    gameActive = !!st?.active;
    renderNav();
    if (currentId?.startsWith('game/')) renderBottomBar();
  };
  api.game.onStatus(apply);
  api.game.status().then(apply).catch(() => {});
  api.net.last().then((t) => {
    lastNetTest = t;
    if (currentId?.startsWith('game/')) renderBottomBar();
  }).catch(() => {});
  document.addEventListener('opk:net-test', (e) => {
    lastNetTest = e.detail;
    if (currentId?.startsWith('game/')) renderBottomBar();
  });
}

let unseenHistory = false;
let gameActive = false;

async function main() {
  await appState.init();
  if (appState.info.demo) document.querySelector('.brand-tag').textContent = 'Demo mode';
  document.querySelector('.brand-ver').textContent = appState.info.version.split('.').slice(0, 2).join('.');
  document.body.classList.add(`platform-${appState.info.platform}`);

  wireTitleBar();
  wireKeyboard();
  setNavigator(navigate);
  document.addEventListener('click', (e) => {
    // Any address in the app: clicking a part of it opens that folder.
    const place = e.target.closest('[data-open-path]');
    if (place) {
      e.preventDefault(); // inside a <label>, don't also tick its checkbox
      // One window per double-click, and none while selecting text to copy.
      if (e.detail <= 1 && !String(window.getSelection() || '')) openLocation(place.dataset.openPath);
      return;
    }
    const head = e.target.closest('[data-section]');
    if (head) {
      onSectionClick(head.dataset.section);
      return;
    }
    const go = e.target.closest('[data-go]');
    if (!go) return;
    navigate(go.dataset.go);
    if (go.hasAttribute('data-smart-scan')) current?.smartScan?.();
  });
  wireSecurity();
  wireGame();
  appState.on('drives', renderBottomBar);
  appState.on('history', () => {
    if (currentId !== 'history') {
      unseenHistory = true;
      renderNav();
    }
  });
  renderBottomBar();

  let start = 'security/center';
  try {
    const saved = localStorage.getItem('opk:view');
    if (saved && factories.has(saved)) start = saved;
  } catch { /* storage unavailable */ }
  navigate(start);
  programsStore.load();
}

main().catch((err) => {
  document.getElementById('view-host').append(h(`<div class="empty-state">${icon('alert', { size: 40 })}<div>Something went wrong while starting.</div><div class="empty-sub">${esc(err.message)}</div></div>`));
});
