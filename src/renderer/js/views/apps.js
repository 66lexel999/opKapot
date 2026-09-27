import { api, esc, h, debounce, formatBytes, formatDate, plural, sortBy, errorMessage } from '../util.js';
import { icon } from '../icons.js';
import { DataTable } from '../components/table.js';
import { confirmDialog, openModal, showMenu, toast } from '../components/overlay.js';
import { appState } from '../store.js';
import { viewHeader, searchBox, emptyHtml, loadingHtml, nameCell, opButtons, programIcon, muted } from './common.js';

const GETTERS = {
  name: (a) => a.name,
  publisher: (a) => a.publisher,
  size: (a) => a.size,
  installDate: (a) => a.installDate,
  version: (a) => a.version,
};

/** Microsoft Store / built-in Windows apps (AppX packages). */
export class AppsView {
  constructor() {
    this.apps = [];
    this.loaded = false;
    this.sort = { key: 'name', dir: 'asc' };
    this.query = '';
  }

  get supported() {
    return appState.isWindows || appState.info.demo;
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Remove Windows apps you don’t use.',
        info: 'Microsoft Store and pre-installed Windows apps for your account. System-critical apps are hidden and can’t be removed.',
        actions: `${searchBox('Search apps')}<button class="btn btn-big" data-remove disabled>Uninstall</button>`,
      })}
      <div class="panel"></div>
    </div>`);
    this.button = this.el.querySelector('[data-remove]');
    this.summary = this.el.querySelector('.sel-summary');
    this.table = new DataTable({
      rowHeight: 64,
      sort: this.sort,
      columns: [
        { key: 'name', label: (t) => `Name (Total: ${t.rows.length})`, width: 'minmax(0, 1.7fr)', sortable: true, render: (a) => nameCell(programIcon(a), a.name, a.packageName) },
        { key: 'publisher', label: 'Publisher', width: 'minmax(0, 1fr)', sortable: true, render: (a) => `<span class="trunc">${esc(a.publisher || '—')}</span>` },
        { key: 'size', label: 'Size', width: '100px', sortable: true, defaultDir: 'desc', render: (a) => (a.size ? `<span class="trunc">${formatBytes(a.size)}</span>` : muted('—')) },
        { key: 'installDate', label: 'Installed', width: '140px', sortable: true, defaultDir: 'desc', render: (a) => `<span class="trunc">${formatDate(a.installDate)}</span>` },
        { key: 'version', label: 'Version', width: '115px', sortable: true, render: (a) => `<span class="trunc">${esc(a.version)}</span>` },
        { key: 'op', label: 'Operation', width: '120px', align: 'center', render: () => opButtons([['remove', 'trash', 'Uninstall']]) },
      ],
      onSort: (sort) => {
        this.sort = sort;
        this.update();
      },
      onSelectionChange: (rows) => {
        const bytes = rows.reduce((s, a) => s + (a.size || 0), 0);
        this.summary.textContent = rows.length ? `${plural(rows.length, 'app')} selected${bytes ? ` · ${formatBytes(bytes)}` : ''}` : '';
        this.button.disabled = !rows.length;
        this.button.classList.toggle('btn-primary', rows.length > 0);
        this.button.textContent = rows.length > 1 ? `Uninstall (${rows.length})` : 'Uninstall';
      },
      onAction: (action, a) => action === 'remove' && this.remove([a]),
      onContextMenu: (a, e) => showMenu(e.clientX, e.clientY, [
        { label: 'Uninstall', icon: 'trashOutline', onClick: () => this.remove([a]) },
        { label: 'Copy package name', icon: 'copy', onClick: () => api.app.copy(a.fullName) },
      ]),
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.button.addEventListener('click', () => this.primaryAction());
    this.el.querySelector('input[type=search]').addEventListener('input', debounce((e) => {
      this.query = e.target.value.trim().toLowerCase();
      this.update();
    }, 120));
    return this.el;
  }

  onShow() {
    if (!this.loaded) this.load();
  }

  refresh() {
    this.load();
  }

  focusSearch() {
    this.el.querySelector('input[type=search]').focus();
  }

  selectAll() {
    this.table.selectAll(true);
  }

  primaryAction() {
    const rows = this.table.getSelectedRows();
    if (rows.length) this.remove(rows);
  }

  async load() {
    if (!this.supported) {
      this.table.setEmpty(emptyHtml('Windows Apps are only available on Windows.', 'Your programs are listed under Programs.', 'windows'));
      this.table.setRows([]);
      return;
    }
    this.table.setEmpty(loadingHtml('Reading installed Windows apps…'));
    this.table.setRows([]);
    try {
      this.apps = await api.apps.list();
      this.loaded = true;
      this.table.setEmpty(emptyHtml('No removable apps found.'));
    } catch (err) {
      this.table.setEmpty(emptyHtml('Could not read Windows apps.', errorMessage(err), 'alert'));
    }
    this.update();
  }

  update() {
    let rows = this.apps;
    if (this.query) rows = rows.filter((a) => `${a.name} ${a.publisher} ${a.packageName}`.toLowerCase().includes(this.query));
    this.table.setRows(sortBy(rows, GETTERS[this.sort.key] || GETTERS.name, this.sort.dir));
  }

  async remove(apps) {
    const { ok } = await confirmDialog({
      title: apps.length > 1 ? `Uninstall ${apps.length} apps?` : `Uninstall ${apps[0].name}?`,
      message: `<p>${apps.length > 1 ? 'These apps' : 'This app'} will be removed for your account. You can reinstall ${apps.length > 1 ? 'them' : 'it'} from the Microsoft Store.</p>
        <div class="mini-list">${apps.map((a) => `<div class="mini-row">${programIcon(a, 26)}<div class="mini-name trunc">${esc(a.name)}</div><div class="mini-meta">${a.size ? formatBytes(a.size) : ''}</div></div>`).join('')}</div>`,
      confirmLabel: 'Uninstall',
    });
    if (!ok) return;

    const status = new Map(apps.map((a) => [a.id, { status: 'pending' }]));
    const modal = openModal({ title: 'Uninstalling apps…', closable: false, width: 560 });
    const render = () => {
      modal.setBody(`<div class="prog-list">${apps.map((a) => {
        const st = status.get(a.id);
        const stIcon = st.status === 'running' ? '<span class="spin"></span>'
          : st.status === 'removed' ? `<span class="st-ok">${icon('checkCircle', { size: 20 })}</span>`
            : st.status === 'failed' ? `<span class="st-bad">${icon('xCircle', { size: 20 })}</span>` : '<span class="st-pending"></span>';
        return `<div class="prog-row">${programIcon(a, 28)}<div class="prog-main"><div class="trunc">${esc(a.name)}</div><div class="prog-msg trunc">${esc(st.message || { pending: 'Waiting…', running: 'Removing…', removed: 'Removed.', failed: 'Failed.' }[st.status])}</div></div><div class="prog-state">${stIcon}</div></div>`;
      }).join('')}</div>`);
    };
    render();
    const off = api.apps.onProgress((ev) => {
      status.set(ev.id, ev);
      render();
    });
    let results = [];
    try {
      results = await api.apps.remove(apps.map((a) => a.id));
    } catch (err) {
      toast(esc(errorMessage(err)), 'error');
    } finally {
      off();
    }
    const removed = results.filter((r) => r.ok).length;
    modal.setTitle(removed === apps.length ? 'All done' : 'Finished');
    modal.setClosable(true);
    modal.setButtons([{ label: 'Done', kind: 'primary', onClick: (m) => m.close() }]);
    if (removed) toast(`Removed ${plural(removed, 'app')}`, 'success');
    appState.emit('history');
    await this.load();
  }
}
