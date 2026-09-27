import { api, esc, h, sortBy, debounce, errorMessage } from '../../util.js';
import { icon } from '../../icons.js';
import { DataTable } from '../../components/table.js';
import { openModal, showMenu } from '../../components/overlay.js';
import { securityStore } from '../../securityStore.js';
import { viewHeader, searchBox, emptyHtml, loadingHtml, opButtons } from '../common.js';
import { sevPill, appIcon, confirmRun, notSupportedHtml } from './shared.js';

const FILTERS = [['apps', 'Startup apps'], ['task', 'Scheduled tasks'], ['service', 'Services'], ['driver', 'Drivers'], ['flagged', 'Flagged']];
const RISK = { danger: 0, warning: 1, notice: 2, ok: 3 };
const RISK_LABEL = { danger: 'Suspicious', warning: 'Check this', notice: 'Note', ok: 'OK' };

/** Everything that starts automatically, with signatures and risk. */
export class StartupView {
  constructor() {
    this.entries = [];
    this.filter = 'apps';
    this.query = '';
    this.sort = { key: 'risk', dir: 'asc' };
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Control what starts with Windows.',
        info: 'Startup apps, scheduled tasks, services, drivers and hidden WMI tasks. Malware almost always hides in one of these to survive a restart.',
        actions: searchBox('Search startup items'),
      })}
      <div class="toolbar"><div class="seg" data-filter>${FILTERS.map(([v, l]) => `<button data-v="${v}" class="${v === 'apps' ? 'on' : ''}">${l}</button>`).join('')}</div><span class="muted small su-summary"></span></div>
      <div class="panel"></div>
    </div>`);
    this.summary = this.el.querySelector('.su-summary');
    this.table = new DataTable({
      rowHeight: 58,
      selectable: false,
      sort: this.sort,
      emptyHtml: loadingHtml('Reading startup items…'),
      columns: [
        { key: 'name', label: (t) => `Name (${t.rows.length})`, sortable: true, render: (e) => `<div class="cell-name">${appIcon(e.file, e.name, 28)}<div class="name-text"><div class="name-title trunc">${esc(e.name)}</div><div class="name-sub trunc" title="${esc(e.command)}">${esc(e.command)}</div></div></div>` },
        { key: 'source', label: 'Type', width: '140px', sortable: true, render: (e) => `<span class="trunc">${esc(e.sourceLabel)}</span>` },
        { key: 'publisher', label: 'Publisher', width: '170px', sortable: true, render: (e) => `<span class="trunc ${e.signature === 'unsigned' || e.signature === 'bad' ? 'txt-warn' : e.signature === 'missing' ? 'muted' : ''}" title="${esc(e.signatureText)}">${esc(e.signature === 'signed' ? e.publisher : e.signatureText)}</span>` },
        { key: 'enabled', label: 'Status', width: '100px', sortable: true, render: (e) => `<span class="status-pill ${e.enabled ? 'on' : 'off'}">${e.enabled ? 'Enabled' : 'Disabled'}</span>` },
        { key: 'risk', label: 'Risk', width: '112px', sortable: true, render: (e) => (e.risk === 'ok' ? '<span class="muted">—</span>' : sevPill(e.risk, RISK_LABEL[e.risk])) },
        { key: 'op', label: 'Action', width: '112px', align: 'center', render: (e) => opButtons([
          ...(e.enabled && e.canDisable ? [['disable', 'ban', 'Disable']] : !e.enabled && e.canEnable ? [['enable', 'check', 'Enable']] : []),
          ['details', 'info', 'Details'],
        ]) },
      ],
      onSort: (s) => {
        this.sort = s;
        this.update();
      },
      onAction: (a, e) => (a === 'details' ? this.details(e) : this.act(e, a)),
      onDblClick: (e) => this.details(e),
      onContextMenu: (e, ev) => showMenu(ev.clientX, ev.clientY, [
        e.canDisable && e.enabled ? { label: 'Disable', icon: 'ban', onClick: () => this.act(e, 'disable') } : null,
        e.canEnable && !e.enabled ? { label: 'Enable', icon: 'check', onClick: () => this.act(e, 'enable') } : null,
        e.file ? { label: 'Show file', icon: 'reveal', onClick: () => api.files.reveal(e.file) } : null,
        { label: 'Search online', icon: 'globe', onClick: () => api.app.openExternal(`https://www.google.com/search?q=${encodeURIComponent(`${e.name} ${e.file ? e.file.split('\\').pop() : ''} startup`)}`) },
        e.canRemove ? '-' : null,
        e.canRemove ? { label: 'Remove…', icon: 'trashOutline', danger: true, onClick: () => this.act(e, 'remove') } : null,
      ]),
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.el.querySelector('[data-filter]').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      this.filter = b.dataset.v;
      for (const x of this.el.querySelectorAll('[data-filter] button')) x.classList.toggle('on', x === b);
      this.update();
    });
    this.el.querySelector('input[type=search]').addEventListener('input', debounce((ev) => {
      this.query = ev.target.value.trim().toLowerCase();
      this.update();
    }, 120));
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

  async load() {
    this.table.setEmpty(loadingHtml('Reading startup items and checking signatures…'));
    this.table.setRows([]);
    try {
      const st = securityStore.status || (await api.security.status());
      if (!st.supported) {
        this.table.setEmpty(notSupportedHtml());
        return;
      }
      this.entries = await api.security.autoruns();
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
    if (this.filter === 'apps') rows = rows.filter((e) => ['run', 'startup', 'wmi'].includes(e.source));
    else if (this.filter === 'flagged') rows = rows.filter((e) => e.risk === 'danger' || e.risk === 'warning');
    else rows = rows.filter((e) => e.source === this.filter);
    if (this.query) rows = rows.filter((e) => `${e.name} ${e.command} ${e.publisher}`.toLowerCase().includes(this.query));
    const getters = { name: (e) => e.name, source: (e) => e.sourceLabel, publisher: (e) => e.publisher || e.signatureText, enabled: (e) => (e.enabled ? 0 : 1), risk: (e) => RISK[e.risk] };
    this.table.setRows(sortBy(rows, getters[this.sort.key] || getters.risk, this.sort.dir));
    const flagged = this.entries.filter((e) => e.risk === 'danger' || e.risk === 'warning').length;
    this.summary.innerHTML = `${this.entries.length} items · ${this.entries.filter((e) => e.enabled && ['run', 'startup'].includes(e.source)).length} apps start with Windows${flagged ? ` · <span class="txt-danger">${flagged} flagged</span>` : ''}`;
  }

  async act(e, which) {
    const verbs = { disable: 'Disable', enable: 'Enable', remove: 'Remove' };
    const msg = {
      disable: `"${e.name}" won't start automatically any more. You can enable it again here.`,
      enable: `"${e.name}" will start automatically again.`,
      remove: `Remove "${e.name}" completely? Registry entries are backed up first; shortcuts go to the Recycle Bin.`,
    }[which];
    const res = await confirmRun({ title: `${verbs[which]} ${e.name}?`, message: msg, confirmLabel: verbs[which], kind: which === 'enable' ? 'primary' : 'danger', run: () => api.security.autorunAction(e.id, which) });
    if (res?.ok) this.load();
  }

  details(e) {
    openModal({
      title: e.name,
      width: 660,
      body: `<div class="finding-head">${appIcon(e.file, e.name, 40)}<div><div class="details-name">${esc(e.name)}</div><div class="muted small">${esc(e.sourceLabel)} · ${e.enabled ? 'Enabled' : 'Disabled'}</div></div></div>
        ${e.flags.length ? `<ul class="hit-list">${e.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">Nothing unusual about this item.</p>'}
        <dl class="kv">
          <dt>Command</dt><dd class="selectable mono">${esc(e.command)}</dd>
          <dt>File</dt><dd class="selectable">${esc(e.file || '—')}</dd>
          <dt>Signature</dt><dd>${esc(e.signatureText)}</dd>
          <dt>Found in</dt><dd class="selectable">${esc(e.where || '')}</dd>
          ${e.author ? `<dt>Author</dt><dd>${esc(e.author)}</dd>` : ''}
        </dl>`,
      buttons: [
        e.file ? { label: 'Show file', onClick: () => api.files.reveal(e.file) } : null,
        e.canDisable && e.enabled ? { label: 'Disable', kind: e.risk === 'danger' ? 'danger' : 'primary', onClick: (m) => { m.close(); this.act(e, 'disable'); } } : null,
        e.canEnable && !e.enabled ? { label: 'Enable', kind: 'primary', onClick: (m) => { m.close(); this.act(e, 'enable'); } } : null,
        { label: 'Close', onClick: (m) => m.close() },
      ].filter(Boolean),
    });
  }
}
