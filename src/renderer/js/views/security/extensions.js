import { api, esc, h, sortBy, avatar, formatDate, errorMessage } from '../../util.js';
import { icon } from '../../icons.js';
import { DataTable } from '../../components/table.js';
import { openModal, showMenu } from '../../components/overlay.js';
import { viewHeader, emptyHtml, loadingHtml, opButtons } from '../common.js';
import { sevPill } from './shared.js';

const RISK = { danger: 0, warning: 1, notice: 2, ok: 3 };
const RISK_LABEL = { danger: 'Dangerous', warning: 'Suspicious', notice: 'Powerful', ok: 'OK' };

function extIcon(e, size = 30) {
  return e.icon ? `<img class="app-icon" src="${e.icon}" width="${size}" height="${size}" alt="">` : avatar(e.name, size);
}

/** Browser extensions across Chrome, Edge, Brave, Opera, Vivaldi and Firefox. */
export class ExtensionsView {
  constructor() {
    this.list = [];
    this.sort = { key: 'risk', dir: 'asc' };
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Check what your browser extensions can do.',
        info: 'Extensions that run on every website can see what you type, including passwords. Ones forced by a policy or loaded outside the store are a classic sign of browser hijacking.',
        actions: '',
      })}
      <div class="panel"></div>
    </div>`);
    this.table = new DataTable({
      rowHeight: 60,
      selectable: false,
      sort: this.sort,
      emptyHtml: loadingHtml('Reading browser extensions…'),
      columns: [
        { key: 'name', label: (t) => `Extension (${t.rows.length})`, width: 'minmax(0, 1.3fr)', sortable: true, render: (e) => `<div class="cell-name">${extIcon(e)}<div class="name-text"><div class="name-title trunc">${esc(e.name)}</div><div class="name-sub trunc">${esc(e.browser)} · ${esc(e.profile)} · v${esc(e.version)}</div></div></div>` },
        { key: 'source', label: 'Installed from', width: '170px', sortable: true, render: (e) => `<span class="trunc ${e.source === 'policy' || e.source === 'sideloaded' ? 'txt-danger' : ''}">${esc(e.sourceLabel)}</span>` },
        { key: 'power', label: 'Can do', width: 'minmax(0, 1fr)', sortable: true, defaultDir: 'desc', render: (e) => `<span class="trunc" title="${esc(e.capabilities.join('\n'))}">${esc(e.capabilities[0] || 'Limited access')}${e.capabilities.length > 1 ? ` <span class="muted">+${e.capabilities.length - 1} more</span>` : ''}</span>` },
        { key: 'enabled', label: 'Status', width: '80px', sortable: true, render: (e) => `<span class="status-pill ${e.enabled ? 'on' : 'off'}">${e.enabled ? 'On' : 'Off'}</span>` },
        { key: 'risk', label: 'Risk', width: '126px', sortable: true, render: (e) => (e.risk === 'ok' ? '<span class="muted">—</span>' : sevPill(e.risk, RISK_LABEL[e.risk])) },
        { key: 'op', label: 'Action', width: '90px', align: 'center', render: () => opButtons([['details', 'info', 'Details']]) },
      ],
      onSort: (s) => {
        this.sort = s;
        this.update();
      },
      onAction: (_a, e) => this.details(e),
      onDblClick: (e) => this.details(e),
      onContextMenu: (e, ev) => showMenu(ev.clientX, ev.clientY, [
        { label: 'Details', icon: 'info', onClick: () => this.details(e) },
        e.storeUrl ? { label: 'Open store page', icon: 'globe', onClick: () => api.app.openExternal(e.storeUrl) } : null,
        e.folder ? { label: 'Show folder', icon: 'reveal', onClick: () => api.files.reveal(e.folder) } : null,
      ]),
    });
    this.el.querySelector('.panel').append(this.table.el);
    return this.el;
  }

  async onShow() {
    if (this.loaded) return;
    try {
      this.list = await api.security.extensions();
      this.loaded = true;
      this.table.setEmpty(emptyHtml('No browser extensions found.', 'Checked Chrome, Edge, Brave, Opera, Vivaldi and Firefox.', 'puzzle'));
      this.update();
    } catch (err) {
      this.table.setEmpty(emptyHtml('Could not read extensions.', errorMessage(err), 'alert'));
    }
  }

  refresh() {
    this.loaded = false;
    this.onShow();
  }

  update() {
    const getters = { name: (e) => e.name, source: (e) => e.sourceLabel, power: (e) => e.power, enabled: (e) => (e.enabled ? 0 : 1), risk: (e) => RISK[e.risk] * 100 - e.power };
    this.table.setRows(sortBy(this.list, getters[this.sort.key] || getters.risk, this.sort.dir));
  }

  details(e) {
    const advice = e.risk === 'danger' || e.risk === 'warning'
      ? `If you didn't add this yourself, remove it in ${e.browser} (Menu → Extensions → Remove), then run Hack Check: it can remove the policy that forces it back.`
      : 'Only keep extensions you trust. Powerful ones could read the passwords you type.';
    openModal({
      title: e.name,
      width: 640,
      body: `<div class="finding-head">${extIcon(e, 42)}<div><div class="details-name">${esc(e.name)}</div><div class="muted small">${esc(e.browser)} · ${esc(e.profile)} · ${esc(e.sourceLabel)}</div></div></div>
        ${e.description ? `<p class="finding-summary">${esc(e.description)}</p>` : ''}
        <div class="settings-section">What it can do</div>
        ${e.capabilities.length ? `<ul class="hit-list">${e.capabilities.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p class="muted">Only limited access.</p>'}
        <p class="advice">${icon('info', { size: 16 })}<span>${esc(advice)}</span></p>
        <dl class="kv"><dt>ID</dt><dd class="selectable mono">${esc(e.extensionId)}</dd>${e.installed ? `<dt>Installed</dt><dd>${formatDate(e.installed)}</dd>` : ''}${e.folder ? `<dt>Folder</dt><dd class="selectable">${esc(e.folder)}</dd>` : ''}</dl>`,
      buttons: [
        e.storeUrl ? { label: 'Store page', onClick: () => api.app.openExternal(e.storeUrl) } : null,
        e.folder ? { label: 'Show folder', onClick: () => api.files.reveal(e.folder) } : null,
        { label: 'Close', kind: 'primary', onClick: (m) => m.close() },
      ].filter(Boolean),
    });
  }
}
