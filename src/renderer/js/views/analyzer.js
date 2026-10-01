import { api, esc, h, formatBytes, formatDate, formatNumber, plural, sortBy, uid, errorMessage, pathCrumbs } from '../util.js';
import { icon } from '../icons.js';
import { DataTable } from '../components/table.js';
import { showMenu, openLocation } from '../components/overlay.js';
import { appState } from '../store.js';
import { viewHeader, emptyHtml, loadingHtml, nameCell, opButtons, LocationPicker, ScanProgress } from './common.js';
import { fileBadge } from '../fileTypes.js';
import { deleteFiles } from './files.js';

const GETTERS = {
  name: (e) => e.name,
  size: (e) => e.size,
  share: (e) => e.size,
  files: (e) => e.files,
  mtime: (e) => e.mtime,
};

function splitPath(p) {
  return pathCrumbs(p) || { crumbs: p ? [{ label: p, path: p }] : [], sep: '\\' };
}

function parentOf(p) {
  const { crumbs } = splitPath(p);
  return crumbs.length > 1 ? crumbs[crumbs.length - 2].path : null;
}

/** Space analyzer: folder-by-folder breakdown of what uses the disk. */
export class AnalyzerView {
  constructor() {
    this.cache = new Map();
    this.entries = [];
    this.total = 0;
    this.sort = { key: 'size', dir: 'desc' };
    this.jobId = null;
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'See what’s taking up your disk.',
        info: 'Shows every folder with its total size. Double-click a folder to open it.',
        actions: '<button class="btn btn-big" data-delete disabled>Delete</button>',
      })}
      <div class="toolbar">
        <span data-loc></span>
        <button class="btn" data-up title="Parent folder">${icon('arrowUp', { size: 17 })}<span>Up</span></button>
        <button class="btn" data-explore title="Open this folder in ${appState.isWindows ? 'Explorer' : 'your file manager'}">${icon('open', { size: 17 })}<span>Open</span></button>
        <button class="btn btn-accent" data-scan>${icon('refresh', { size: 17 })}<span>Rescan</span></button>
        <div class="crumbs"></div>
      </div>
      <div data-progress></div>
      <div class="result-line muted" hidden></div>
      <div class="panel"></div>
    </div>`);
    this.picker = new LocationPicker(appState.info.paths.home, (p) => this.open(p));
    this.el.querySelector('[data-loc]').replaceWith(this.picker.el);
    this.progress = new ScanProgress();
    this.el.querySelector('[data-progress]').replaceWith(this.progress.el);
    this.resultLine = this.el.querySelector('.result-line');
    this.crumbs = this.el.querySelector('.crumbs');
    this.deleteBtn = this.el.querySelector('[data-delete]');
    this.summary = this.el.querySelector('.sel-summary');

    this.table = new DataTable({
      rowHeight: 52,
      sort: this.sort,
      getId: (e) => e.path,
      emptyHtml: loadingHtml('Measuring folders…'),
      columns: [
        { key: 'name', label: (t) => `Name (${formatNumber(t.rows.length)} items)`, sortable: true, render: (e) => nameCell(e.isDir ? `<span class="folder-ico">${icon('folderFill', { size: 30 })}</span>` : fileBadge((/\.([^.]+)$/.exec(e.name)?.[1] || '').toLowerCase()), e.name) },
        { key: 'size', label: 'Size', width: '110px', sortable: true, defaultDir: 'desc', render: (e) => `<span class="trunc strong">${formatBytes(e.size)}</span>` },
        { key: 'share', label: 'Share', width: '170px', sortable: true, defaultDir: 'desc', render: (e) => this.shareBar(e) },
        { key: 'files', label: 'Files', width: '100px', sortable: true, defaultDir: 'desc', render: (e) => `<span class="trunc">${formatNumber(e.files)}</span>` },
        { key: 'mtime', label: 'Modified', width: '130px', sortable: true, defaultDir: 'desc', render: (e) => `<span class="trunc">${formatDate(e.mtime)}</span>` },
        { key: 'op', label: 'Operation', width: '120px', align: 'center', render: (e) => opButtons([[e.isDir ? 'enter' : 'reveal', e.isDir ? 'chevronRight' : 'reveal', e.isDir ? 'Open folder' : 'Show in folder'], ['delete', 'trash', 'Delete']]) },
      ],
      onSort: (sort) => {
        this.sort = sort;
        this.update();
      },
      onSelectionChange: (rows) => {
        const bytes = rows.reduce((s, e) => s + e.size, 0);
        this.summary.textContent = rows.length ? `${plural(rows.length, 'item')} · ${formatBytes(bytes)}` : '';
        this.deleteBtn.disabled = !rows.length;
        this.deleteBtn.classList.toggle('btn-primary', rows.length > 0);
      },
      onAction: (action, e) => {
        if (action === 'enter') this.open(e.path);
        if (action === 'reveal') api.files.reveal(e.path);
        if (action === 'delete') this.remove([e]);
      },
      onDblClick: (e) => (e.isDir ? this.open(e.path) : api.files.open(e.path)),
      onContextMenu: (e, ev) => showMenu(ev.clientX, ev.clientY, [
        e.isDir ? { label: 'Open folder here', icon: 'chevronRight', onClick: () => this.open(e.path) } : { label: 'Open', icon: 'open', onClick: () => api.files.open(e.path) },
        { label: 'Show in Explorer', icon: 'reveal', onClick: () => api.files.reveal(e.path) },
        { label: 'Copy path', icon: 'copy', onClick: () => api.app.copy(e.path) },
        '-',
        { label: 'Delete…', icon: 'trashOutline', danger: true, onClick: () => this.remove([e]) },
      ]),
    });
    this.el.querySelector('.panel').append(this.table.el);

    this.el.querySelector('[data-up]').addEventListener('click', () => {
      const parent = parentOf(this.current || '');
      if (parent) this.open(parent);
    });
    this.el.querySelector('[data-explore]').addEventListener('click', () => this.current && openLocation(this.current));
    this.el.querySelector('[data-scan]').addEventListener('click', () => (this.jobId ? api.jobs.cancel(this.jobId) : this.open(this.current, true)));
    this.deleteBtn.addEventListener('click', () => this.primaryAction());
    this.crumbs.addEventListener('click', (e) => {
      const c = e.target.closest('[data-path]');
      if (c) this.open(c.dataset.path);
    });
    return this.el;
  }

  onShow() {
    if (!this.current) this.open(this.picker.value);
  }

  refresh() {
    this.open(this.current, true);
  }

  selectAll() {
    this.table.selectAll(true);
  }

  primaryAction() {
    this.remove(this.table.getSelectedRows());
  }

  shareBar(e) {
    const pct = this.total ? (e.size / this.total) * 100 : 0;
    return `<div class="share"><div class="sizebar"><i style="width:${Math.max(pct, pct > 0 ? 1 : 0).toFixed(1)}%"></i></div><span>${pct >= 0.1 ? pct.toFixed(1) : pct > 0 ? '<0.1' : '0'}%</span></div>`;
  }

  renderCrumbs() {
    const { crumbs } = splitPath(this.current);
    this.crumbs.innerHTML = crumbs.map((c, i) => `<span class="crumb${i === crumbs.length - 1 ? ' current' : ''}" data-path="${esc(c.path)}">${esc(c.label)}</span>`).join(`<span class="crumb-sep">${icon('chevronRight', { size: 14 })}</span>`);
    this.el.querySelector('[data-up]').disabled = !parentOf(this.current);
  }

  async open(path, force = false) {
    if (!path) return;
    if (this.jobId) await api.jobs.cancel(this.jobId);
    this.current = path;
    this.picker.set(path);
    this.renderCrumbs();
    this.table.selectAll(false);

    if (!force && this.cache.has(path)) {
      this.show(this.cache.get(path));
      return;
    }
    const jobId = uid('dir');
    this.jobId = jobId;
    this.entries = [];
    this.table.setEmpty(loadingHtml('Measuring folders…'));
    this.update();
    this.resultLine.hidden = true;
    const scanBtn = this.el.querySelector('[data-scan]');
    scanBtn.innerHTML = `${icon('stop', { size: 17 })}<span>Stop</span>`;
    scanBtn.classList.add('btn-stop');
    this.progress.show(`Measuring ${path}…`);
    const off = api.jobs.onProgress(({ jobId: id, data }) => {
      if (id !== jobId) return;
      const pct = data.total ? (data.done / data.total) * 100 : null;
      this.progress.set(`Measuring ${data.current || ''}${data.size ? ` · ${formatBytes(data.size)}` : ''}`, pct);
    });
    try {
      const result = await api.files.folder(jobId, path);
      if (this.jobId !== jobId) return;
      if (!result.stopped) this.cache.set(path, result);
      this.show(result);
    } catch (err) {
      if (this.jobId === jobId) {
        this.table.setEmpty(emptyHtml('Cannot open this folder.', errorMessage(err), 'alert'));
        this.entries = [];
        this.update();
      }
    } finally {
      off();
      if (this.jobId === jobId) {
        this.jobId = null;
        scanBtn.innerHTML = `${icon('refresh', { size: 17 })}<span>Rescan</span>`;
        scanBtn.classList.remove('btn-stop');
        this.progress.hide();
      }
    }
  }

  show(result) {
    this.entries = result.entries;
    this.total = result.total;
    const files = result.entries.reduce((s, e) => s + e.files, 0);
    this.resultLine.textContent = `${formatBytes(result.total)} in ${plural(files, 'file')}${result.stopped ? ' (stopped early — sizes are partial)' : ''}.`;
    this.resultLine.hidden = false;
    this.table.setEmpty(emptyHtml('This folder is empty.', '', 'folder'));
    this.table.scrollToTop();
    this.update();
  }

  update() {
    this.table.setRows(sortBy(this.entries, GETTERS[this.sort.key] || GETTERS.size, this.sort.dir));
  }

  async remove(items) {
    const deleted = await deleteFiles(items, { label: 'Space Analyzer' });
    if (!deleted.length) return;
    const gone = new Set(deleted);
    const freed = this.entries.filter((e) => gone.has(e.path)).reduce((s, e) => s + e.size, 0);
    this.entries = this.entries.filter((e) => !gone.has(e.path));
    this.total -= freed;
    // Parent folders' cached totals are now stale.
    for (const key of this.cache.keys()) if (key !== this.current) this.cache.delete(key);
    this.cache.set(this.current, { root: this.current, entries: this.entries, total: this.total });
    this.update();
  }
}
