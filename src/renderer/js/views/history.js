import { api, esc, h, formatBytes, formatDateTime, plural, sortBy } from '../util.js';
import { icon } from '../icons.js';
import { DataTable } from '../components/table.js';
import { confirmDialog } from '../components/overlay.js';
import { appState } from '../store.js';
import { viewHeader, emptyHtml } from './common.js';

const TYPES = {
  uninstall: ['programs', 'Program uninstalled'],
  force: ['bolt', 'Force removed'],
  leftovers: ['broom', 'Leftovers removed'],
  app: ['windows', 'Windows app removed'],
  files: ['file', 'Files deleted'],
  junk: ['broom', 'Junk cleaned'],
};

const GETTERS = {
  title: (e) => e.title,
  type: (e) => TYPES[e.type]?.[1] || e.type,
  bytes: (e) => e.bytes,
  date: (e) => e.date,
};

/** Log of everything the app removed. */
export class HistoryView {
  constructor() {
    this.entries = [];
    this.sort = { key: 'date', dir: 'desc' };
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Everything opKapot has cleaned up.',
        info: 'A log of uninstalled programs, removed apps, deleted files and cleaned junk.',
        actions: '<button class="btn" data-clear>Clear history</button>',
      })}
      <div class="panel"></div>
    </div>`);
    this.table = new DataTable({
      selectable: false,
      rowHeight: 60,
      sort: this.sort,
      emptyHtml: emptyHtml('Nothing here yet.', 'Uninstalled programs and cleanups will appear here.', 'history'),
      columns: [
        {
          key: 'title', label: (t) => `Action (Total: ${t.rows.length})`, sortable: true,
          render: (e) => `<div class="cell-name"><span class="cat-ico">${icon(TYPES[e.type]?.[0] || 'info', { size: 20 })}</span><div class="name-text"><div class="name-title trunc">${esc(e.title)}</div>${e.detail ? `<div class="name-sub trunc">${esc(e.detail)}</div>` : ''}</div></div>`,
        },
        { key: 'type', label: 'Type', width: '190px', sortable: true, render: (e) => `<span class="trunc">${esc(TYPES[e.type]?.[1] || e.type)}</span>` },
        { key: 'bytes', label: 'Freed', width: '120px', sortable: true, defaultDir: 'desc', render: (e) => `<span class="trunc">${e.bytes ? formatBytes(e.bytes) : '—'}</span>` },
        { key: 'date', label: 'Date', width: '215px', sortable: true, defaultDir: 'desc', render: (e) => `<span class="trunc">${formatDateTime(e.date)}</span>` },
      ],
      onSort: (sort) => {
        this.sort = sort;
        this.update();
      },
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.el.querySelector('[data-clear]').addEventListener('click', async () => {
      const { ok } = await confirmDialog({ title: 'Clear history?', message: '<p>The activity log will be emptied. Nothing on your PC changes.</p>', confirmLabel: 'Clear', kind: 'danger' });
      if (!ok) return;
      await api.history.clear();
      this.load();
    });
    appState.on('history', () => this.visible && this.load());
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

  async load() {
    this.entries = await api.history.list();
    const total = this.entries.reduce((s, e) => s + (e.bytes || 0), 0);
    this.el.querySelector('.sel-summary').textContent = this.entries.length ? `${formatBytes(total)} freed in ${plural(this.entries.length, 'action')}` : '';
    this.update();
  }

  update() {
    this.table.setRows(sortBy(this.entries, GETTERS[this.sort.key] || GETTERS.date, this.sort.dir));
  }
}
