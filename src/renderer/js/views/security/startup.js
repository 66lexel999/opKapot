import { api, esc, h, sortBy, debounce, errorMessage, pathLink } from '../../util.js';
import { icon } from '../../icons.js';
import { DataTable } from '../../components/table.js';
import { openModal, showMenu, toast } from '../../components/overlay.js';
import { securityStore } from '../../securityStore.js';
import { appState } from '../../store.js';
import { viewHeader, searchBox, emptyHtml, loadingHtml, opButtons } from '../common.js';
import { sevPill, appIcon, confirmRun, notSupportedHtml } from './shared.js';

const FILTERS = [['apps', 'Startup apps'], ['task', 'Scheduled tasks'], ['service', 'Services'], ['driver', 'Drivers'], ['flagged', 'Flagged']];
const RISK = { danger: 0, warning: 1, notice: 2, ok: 3 };
const RISK_LABEL = { danger: 'Suspicious', warning: 'Check this', notice: 'Note', ok: 'OK' };
// Switching these on or off is harmless and easy to undo, so it happens in one click.
const QUICK = new Set(['run', 'startup']);
const SELF_TEXT = 'Opens quietly in the notification area when you sign in, so protection starts right away.';

const isStartupApp = (e) => e.self || ['run', 'startup', 'wmi'].includes(e.source);
const canToggle = (e) => e.self || (e.enabled ? e.canDisable : e.canEnable);

/** opKapot itself, shown even while it isn't set to start with Windows. */
function selfEntry() {
  const exe = appState.info.exe || '';
  return {
    id: 'self',
    self: true,
    source: 'task',
    sourceLabel: 'Scheduled task',
    where: 'Task Scheduler',
    name: 'opKapot',
    command: exe ? `"${exe}" --background` : '',
    file: exe,
    publisher: 'opKapot',
    signature: 'signed',
    signatureText: 'This app',
    enabled: appState.info.demo ? !!appState.settings.guardAutostart : false,
    risk: 'ok',
    flags: [],
    canDisable: false,
    canEnable: false,
    canRemove: false,
  };
}

/** Startup Manager: everything that starts automatically, with signatures and risk. */
export class StartupView {
  constructor() {
    this.entries = [];
    this.filter = 'apps';
    this.query = '';
    this.sort = { key: 'risk', dir: 'asc' };
    this.busy = new Set();
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Choose what starts with Windows.',
        info: 'Startup apps, scheduled tasks, services, drivers and hidden WMI tasks. Switch off apps you don\'t need at startup to make Windows start faster. Malware almost always hides in one of these to survive a restart.',
        actions: `${searchBox('Search startup items')}<button class="btn btn-accent" data-add hidden>${icon('plus', { size: 17 })}<span>Add program</span></button>`,
      })}
      <div class="toolbar"><div class="seg" data-filter>${FILTERS.map(([v, l]) => `<button data-v="${v}" class="${v === 'apps' ? 'on' : ''}">${l}</button>`).join('')}</div><span class="muted small su-summary"></span></div>
      <div class="panel"></div>
    </div>`);
    this.summary = this.el.querySelector('.su-summary');
    this.addBtn = this.el.querySelector('[data-add]');
    this.table = new DataTable({
      rowHeight: 58,
      selectable: false,
      sort: this.sort,
      emptyHtml: loadingHtml('Reading startup items…'),
      columns: [
        { key: 'name', label: (t) => `Name (${t.rows.length})`, sortable: true, render: (e) => this.nameHtml(e) },
        { key: 'source', label: 'Type', width: '140px', sortable: true, render: (e) => `<span class="trunc">${esc(e.sourceLabel)}</span>` },
        { key: 'publisher', label: 'Publisher', width: '170px', sortable: true, render: (e) => (e.self ? '<span class="trunc">opKapot</span>' : `<span class="trunc ${e.signature === 'unsigned' || e.signature === 'bad' ? 'txt-warn' : e.signature === 'missing' ? 'muted' : ''}" title="${esc(e.signatureText)}">${esc(e.signature === 'signed' ? e.publisher : e.signatureText)}</span>`) },
        { key: 'enabled', label: 'Starts', width: '120px', sortable: true, render: (e) => this.statusHtml(e) },
        { key: 'risk', label: 'Risk', width: '112px', sortable: true, render: (e) => (e.risk === 'ok' ? '<span class="muted">—</span>' : sevPill(e.risk, RISK_LABEL[e.risk])) },
        { key: 'op', label: 'Action', width: '112px', align: 'center', render: (e) => opButtons([
          ['details', 'info', 'Details'],
          ...(e.canRemove ? [['delete', 'trash', 'Remove']] : []),
        ]) },
      ],
      onSort: (s) => {
        this.sort = s;
        this.update();
      },
      onAction: (a, e) => {
        if (a === 'details') this.details(e);
        else if (a === 'toggle') this.toggle(e);
        else if (a === 'delete') this.act(e, 'remove');
      },
      onDblClick: (e) => this.details(e),
      onContextMenu: (e, ev) => showMenu(ev.clientX, ev.clientY, [
        canToggle(e) ? { label: e.enabled ? 'Don\'t start with Windows' : 'Start with Windows', icon: e.enabled ? 'ban' : 'check', onClick: () => this.toggle(e) } : null,
        e.file ? { label: 'Show file', icon: 'reveal', onClick: () => api.files.reveal(e.file) } : null,
        e.self ? null : { label: 'Search online', icon: 'globe', onClick: () => api.app.openExternal(`https://www.google.com/search?q=${encodeURIComponent(`${e.name} ${e.file ? e.file.split('\\').pop() : ''} startup`)}`) },
        { label: 'Details', icon: 'info', onClick: () => this.details(e) },
        e.canRemove ? '-' : null,
        e.canRemove ? { label: 'Remove…', icon: 'trashOutline', danger: true, onClick: () => this.act(e, 'remove') } : null,
      ]),
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.el.querySelector('[data-filter]').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (b) this.setFilter(b.dataset.v);
    });
    this.el.querySelector('input[type=search]').addEventListener('input', debounce((ev) => {
      this.query = ev.target.value.trim().toLowerCase();
      this.update();
    }, 120));
    this.addBtn.addEventListener('click', () => this.addProgram());
    securityStore.on('icons', () => this.visible && this.table.refresh());
    return this.el;
  }

  onShow() {
    this.visible = true;
    if (!this.loaded) this.load();
  }

  onHide() {
    this.visible = false;
  }

  refresh() {
    this.load();
  }

  focusSearch() {
    this.el.querySelector('input[type=search]').focus();
  }

  setFilter(value) {
    this.filter = value;
    for (const x of this.el.querySelectorAll('[data-filter] button')) x.classList.toggle('on', x.dataset.v === value);
    this.update();
  }

  nameHtml(e) {
    const ico = e.self ? '<img class="app-icon" src="assets/icon.png" width="28" height="28" alt="">' : appIcon(e.file, e.name, 28);
    const sub = e.self ? SELF_TEXT : e.command;
    return `<div class="cell-name">${ico}<div class="name-text"><div class="name-title trunc">${esc(e.name)}${e.self ? ' <span class="pill green">This app</span>' : ''}</div><div class="name-sub trunc" title="${esc(sub)}">${esc(sub)}</div></div></div>`;
  }

  statusHtml(e) {
    if (!canToggle(e)) return `<span class="status-pill ${e.enabled ? 'on' : 'off'}">${e.enabled ? 'Enabled' : 'Disabled'}</span>`;
    const title = e.enabled ? 'Stop it starting with Windows' : 'Start it with Windows';
    return `<div class="sw-cell"><button class="sw-btn${e.enabled ? ' on' : ''}" data-action="toggle" role="switch" aria-checked="${e.enabled}" title="${title}"${this.busy.has(e.id) ? ' disabled' : ''}></button><span class="sw-label">${e.enabled ? 'On' : 'Off'}</span></div>`;
  }

  async load() {
    this.table.setEmpty(loadingHtml('Reading startup items and checking signatures…'));
    this.table.setRows([]);
    try {
      const st = securityStore.status || (await api.security.status());
      if (!st.supported) {
        this.addBtn.hidden = true;
        this.table.setEmpty(notSupportedHtml());
        return;
      }
      this.addBtn.hidden = false;
      const entries = await api.security.autoruns();
      if (!entries.some((e) => e.self)) entries.unshift(selfEntry());
      this.entries = entries;
      this.loaded = true;
      securityStore.loadIcons(this.entries.map((e) => e.file));
      this.table.setEmpty(emptyHtml('Nothing here.', '', 'rocket'));
      this.update();
    } catch (err) {
      this.table.setEmpty(emptyHtml('Could not read startup items.', errorMessage(err), 'alert'));
    }
  }

  update() {
    let rows = this.entries;
    if (this.filter === 'apps') rows = rows.filter(isStartupApp);
    else if (this.filter === 'flagged') rows = rows.filter((e) => e.risk === 'danger' || e.risk === 'warning');
    else rows = rows.filter((e) => e.source === this.filter);
    if (this.query) rows = rows.filter((e) => `${e.name} ${e.command} ${e.publisher}`.toLowerCase().includes(this.query));
    const getters = { name: (e) => e.name, source: (e) => e.sourceLabel, publisher: (e) => e.publisher || e.signatureText, enabled: (e) => (e.enabled ? 0 : 1), risk: (e) => RISK[e.risk] };
    const sorted = sortBy(rows, getters[this.sort.key] || getters.risk, this.sort.dir);
    // opKapot's own switch always sits on top.
    this.table.setRows([...sorted.filter((e) => e.self), ...sorted.filter((e) => !e.self)]);
    const flagged = this.entries.filter((e) => e.risk === 'danger' || e.risk === 'warning').length;
    const starting = this.entries.filter((e) => e.enabled && (e.self || QUICK.has(e.source))).length;
    this.summary.innerHTML = `${this.entries.length} items · ${starting} apps start with Windows${flagged ? ` · <span class="txt-danger">${flagged} flagged</span>` : ''}`;
  }

  /** The switch in the "Starts" column. */
  async toggle(e) {
    if (this.busy.has(e.id) || !canToggle(e)) return;
    const enable = !e.enabled;
    if (!e.self && !QUICK.has(e.source)) {
      this.act(e, enable ? 'enable' : 'disable');
      return;
    }
    this.busy.add(e.id);
    this.table.refresh();
    try {
      const res = e.self ? await api.app.autostart(enable) : await api.security.autorunAction(e.id, enable ? 'enable' : 'disable');
      if (res?.ok === false) throw new Error(res.message || 'Windows refused the change.');
      e.enabled = enable;
      if (e.self) appState.settings = { ...appState.settings, guardAutostart: enable };
      toast(esc(`${e.name} ${enable ? 'will start' : 'won\'t start'} with Windows.`), 'success');
    } catch (err) {
      toast(esc(errorMessage(err)), 'error', 7000);
    } finally {
      this.busy.delete(e.id);
      this.update();
    }
  }

  async act(e, which) {
    const verbs = { disable: 'Disable', enable: 'Enable', remove: 'Remove' };
    const msg = {
      disable: `"${e.name}" won't start automatically any more. You can enable it again here.`,
      enable: `"${e.name}" will start automatically again.`,
      remove: `Remove "${e.name}" completely? Registry entries are backed up first; shortcuts go to the Recycle Bin.`,
    }[which];
    const res = await confirmRun({ title: `${verbs[which]} ${e.name}?`, message: msg, confirmLabel: verbs[which], kind: which === 'enable' ? 'primary' : 'danger', run: () => api.security.autorunAction(e.id, which) });
    if (!res?.ok) return;
    if (which === 'remove') this.entries = this.entries.filter((x) => x !== e);
    else e.enabled = which === 'enable';
    this.update();
  }

  /** Pick a program and start it at sign-in. */
  async addProgram() {
    const file = await api.files.pickProgram();
    if (!file) return;
    const body = h(`<div class="add-startup">
      <div class="form-row"><span class="form-label">Program</span><div class="form-value">${pathLink(file, { file: true })}</div></div>
      <label class="form-row"><span class="form-label">Name</span><input class="text-input" data-name maxlength="80" spellcheck="false"></label>
      <label class="form-row"><span class="form-label">Arguments</span><input class="text-input" data-args maxlength="500" spellcheck="false" placeholder="Optional, for example --minimized"></label>
      <p class="muted small">It starts when you sign in to Windows (for your account only). Switch it off or remove it here at any time.</p>
    </div>`);
    const nameInput = body.querySelector('[data-name]');
    const argsInput = body.querySelector('[data-args]');
    nameInput.value = file.split(/[\\/]/).pop().replace(/\.(exe|bat|cmd|com)$/i, '');
    const submit = async (m) => {
      const btn = m.button('add');
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const res = await api.security.autorunAdd({ path: file, name: nameInput.value, args: argsInput.value });
        if (res?.ok === false) throw new Error(res.message || 'It didn\'t work.');
        m.close();
        toast(esc(res?.message || 'Added.'), 'success');
        this.query = '';
        this.el.querySelector('input[type=search]').value = '';
        this.setFilter('apps');
        this.load();
      } catch (err) {
        toast(esc(errorMessage(err)), 'error', 7000);
        btn.disabled = false;
      }
    };
    const modal = openModal({
      title: 'Add a program to startup',
      width: 580,
      body,
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        { id: 'add', label: 'Add', kind: 'primary', onClick: submit },
      ],
    });
    body.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.matches('input')) submit(modal);
    });
    nameInput.focus();
    nameInput.select();
  }

  details(e) {
    const toggleBtn = canToggle(e)
      ? { label: e.enabled ? 'Don\'t start with Windows' : 'Start with Windows', kind: e.enabled && e.risk === 'danger' ? 'danger' : 'primary', onClick: (m) => { m.close(); this.toggle(e); } }
      : null;
    const notes = e.self ? `<p>${esc(SELF_TEXT)} It also keeps the Real-time Guard running in the background.</p>`
      : e.flags.length ? `<ul class="hit-list">${e.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">Nothing unusual about this item.</p>';
    openModal({
      title: e.name,
      width: 660,
      body: `<div class="finding-head">${e.self ? '<img class="app-icon" src="assets/icon.png" width="40" height="40" alt="">' : appIcon(e.file, e.name, 40)}<div><div class="details-name">${esc(e.name)}</div><div class="muted small">${esc(e.sourceLabel)} · ${e.enabled ? 'Starts with Windows' : 'Doesn\'t start with Windows'}</div></div></div>
        ${notes}
        <dl class="kv">
          ${e.command ? `<dt>Command</dt><dd class="selectable mono">${esc(e.command)}</dd>` : ''}
          <dt>File</dt><dd class="selectable">${e.file ? pathLink(e.file, { file: true }) : '—'}</dd>
          <dt>Signature</dt><dd>${esc(e.signatureText)}</dd>
          <dt>Found in</dt><dd class="selectable">${pathLink(e.where || '')}</dd>
          ${e.author ? `<dt>Author</dt><dd>${esc(e.author)}</dd>` : ''}
        </dl>`,
      buttons: [
        e.file ? { label: 'Show file', onClick: () => api.files.reveal(e.file) } : null,
        e.canRemove ? { label: 'Remove', kind: 'danger', onClick: (m) => { m.close(); this.act(e, 'remove'); } } : null,
        toggleBtn,
        { label: 'Close', onClick: (m) => m.close() },
      ].filter(Boolean),
    });
  }
}
