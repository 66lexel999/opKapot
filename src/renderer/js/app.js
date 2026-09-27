import { api, esc, h, formatBytes, relativeTime } from './util.js';
import { icon } from './icons.js';
import { appState, programsStore } from './store.js';
import { securityStore } from './securityStore.js';
import { setNavigator } from './router.js';
import { closeMenu, closeTopModal, hasOpenModal, showMenu, toast } from './components/overlay.js';
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
import { openAbout, openSettings } from './dialogs/settings.js';

const NAV = [
  {
    id: 'security', label: 'Security', icon: 'shieldFill',
    items: [
      ['security/center', 'Security Center', () => new SecurityCenterView()],
      ['security/scan', 'Virus Scan', () => new VirusScanView()],
      ['security/hackcheck', 'Hack Check', () => new HackCheckView()],
      ['security/network', 'Network Monitor', () => new NetworkView()],
      ['security/startup', 'Startup Items', () => new StartupView()],
      ['security/extensions', 'Browser Extensions', () => new ExtensionsView()],
      ['security/privacy', 'Camera & Mic', () => new PrivacyView()],
      ['security/quarantine', 'Quarantine', () => new QuarantineView()],
    ],
  },
  {
    id: 'programs', label: 'Programs', icon: 'programs',
    items: [
      ['programs/all', 'All Programs', () => new ProgramsView('all')],
      ['programs/bundleware', 'Bundleware', () => new ProgramsView('bundleware')],
      ['programs/recent', 'Recently Installed', () => new ProgramsView('recent')],
      ['programs/large', 'Large Programs', () => new ProgramsView('large')],
      ['programs/infrequent', 'Infrequently Used', () => new ProgramsView('infrequent')],
    ],
  },
  {
    id: 'files', label: 'Files', icon: 'folder',
    items: [
      ['files/all', 'All Files', () => new FilesView('all')],
      ['files/large', 'Large Files', () => new FilesView('large')],
      ['files/duplicates', 'Duplicate Files', () => new DuplicatesView()],
      ['files/analyzer', 'Space Analyzer', () => new AnalyzerView()],
    ],
  },
  { id: 'junk', label: 'Junk Cleaner', icon: 'broom', view: () => new JunkView() },
  { id: 'apps', label: 'Windows Apps', icon: 'windows', view: () => new AppsView() },
  { id: 'history', label: 'History', icon: 'history', view: () => new HistoryView() },
];

const factories = new Map();
for (const group of NAV) {
  if (group.view) factories.set(group.id, group.view);
  for (const [id, , make] of group.items || []) factories.set(id, make);
}

const views = new Map();
let current = null;
let currentId = null;

function navBadge(groupId) {
  if (groupId === 'history') return unseenHistory ? '<span class="nav-dot"></span>' : '';
  if (groupId === 'security') {
    const st = securityStore.status;
    if (st?.overall === 'danger') return '<span class="nav-dot"></span>';
    if (st?.overall === 'warning') return '<span class="nav-dot warn"></span>';
  }
  return '';
}

// Only the group holding the current view is expanded, so the sidebar stays short.
function renderNav() {
  const nav = document.getElementById('nav');
  nav.innerHTML = NAV.map((group) => {
    const active = currentId === group.id || currentId?.startsWith(`${group.id}/`);
    const head = `<div class="nav-head${active ? ' active' : ''}${group.items ? '' : ' solo'}" data-go="${group.items ? group.items[0][0] : group.id}">
      ${icon(group.icon, { size: 24 })}<span>${esc(group.label)}</span>${navBadge(group.id)}${group.items ? `<span class="nav-chev">${icon(active ? 'chevronDown' : 'chevronRight', { size: 15 })}</span>` : ''}</div>`;
    const items = active ? (group.items || []).map(([id, label]) => `<div class="nav-item${currentId === id ? ' active' : ''}" data-go="${id}">${esc(label)}</div>`).join('') : '';
    return `<div class="nav-group${active ? ' open' : ''}">${head}${items}</div>`;
  }).join('');
}

function navigate(id) {
  if (!factories.has(id) || id === currentId) return;
  closeMenu();
  current?.onHide?.();
  if (!views.has(id)) views.set(id, factories.get(id)());
  current = views.get(id);
  currentId = id;
  if (id === 'history') unseenHistory = false;
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

function renderBottomBar() {
  const bar = document.getElementById('bottom-bar');
  if (currentId?.startsWith('security/')) {
    renderSecurityBar(bar);
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

let unseenHistory = false;

async function main() {
  await appState.init();
  if (appState.info.demo) document.querySelector('.brand-tag').textContent = 'Demo mode';
  document.querySelector('.brand-ver').textContent = appState.info.version.split('.').slice(0, 2).join('.');
  document.body.classList.add(`platform-${appState.info.platform}`);

  wireTitleBar();
  wireKeyboard();
  setNavigator(navigate);
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (!go) return;
    navigate(go.dataset.go);
    if (go.hasAttribute('data-smart-scan')) current?.smartScan?.();
  });
  wireSecurity();
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
