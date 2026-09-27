import { api, esc, h, DAY, MB, GB, debounce, formatBytes, formatDate, formatNumber, plural, sortBy, uid, errorMessage, dirname } from '../util.js';
import { icon } from '../icons.js';
import { DataTable } from '../components/table.js';
import { confirmDialog, openModal, showMenu, toast } from '../components/overlay.js';
import { appState } from '../store.js';
import { viewHeader, searchBox, emptyHtml, loadingHtml, fileNameCell, opButtons, LocationPicker, ScanProgress, without } from './common.js';
import { fileBadge, typeFilter, typeLabel, typeOptions } from '../fileTypes.js';

const SIZE_OPTIONS = [
  [0, 'Any size'], [MB, 'Over 1 MB'], [10 * MB, 'Over 10 MB'], [50 * MB, 'Over 50 MB'],
  [100 * MB, 'Over 100 MB'], [250 * MB, 'Over 250 MB'], [500 * MB, 'Over 500 MB'],
  [GB, 'Over 1 GB'], [5 * GB, 'Over 5 GB'],
];

const AGE_OPTIONS = [
  ['any', 'Any date'],
  ['older30', 'Older than 30 days'],
  ['older180', 'Older than 6 months'],
  ['older365', 'Older than 1 year'],
  ['older730', 'Older than 2 years'],
  ['newer7', 'Changed in last 7 days'],
  ['newer30', 'Changed in last 30 days'],
];

function ageFilter(value) {
  const m = /^(older|newer)(\d+)$/.exec(value);
  if (!m) return {};
  const t = Date.now() - Number(m[2]) * DAY;
  return m[1] === 'older' ? { modifiedBefore: t } : { modifiedAfter: t };
}

const GETTERS = {
  name: (f) => f.name,
  size: (f) => f.size,
  mtime: (f) => f.mtime,
  type: (f) => typeLabel(f.ext),
  location: (f) => f.path,
};

/**
 * Confirm and delete files; returns the paths that were deleted.
 * Shared by every file view.
 */
export async function deleteFiles(items, { label = '' } = {}) {
  if (!items.length) return [];
  const bytes = items.reduce((sum, f) => sum + (f.size || 0), 0);
  const permanentDefault = appState.settings.deleteMode === 'permanent';
  const what = `${plural(items.length, 'item')}${bytes ? ` (${formatBytes(bytes)})` : ''}`;
  const { ok, checked } = await confirmDialog({
    title: 'Delete selected items?',
    message: `<p>${esc(what)} will be moved to the ${appState.isWindows ? 'Recycle Bin' : 'Trash'} unless you choose to delete permanently.</p>
      <div class="mini-list compact">${items.slice(0, 6).map((f) => `<div class="mini-row"><span class="trunc">${esc(f.path)}</span></div>`).join('')}${items.length > 6 ? `<div class="mini-row muted">…and ${formatNumber(items.length - 6)} more</div>` : ''}</div>`,
    confirmLabel: 'Delete',
    kind: 'danger',
    checkbox: { label: 'Delete permanently (cannot be undone)', checked: permanentDefault },
  });
  if (!ok) return [];

  const progress = openModal({
    title: 'Deleting…',
    closable: false,
    body: `<div class="empty-state inline"><span class="spin big"></span><div>Deleting ${esc(what)}…</div></div>`,
  });
  let result;
  try {
    result = await api.files.remove(items.map((f) => ({ path: f.path, size: f.size })), { permanent: checked, label });
  } catch (err) {
    progress.close();
    toast(esc(errorMessage(err)), 'error');
    return [];
  }
  progress.close();
  if (result.deleted.length) {
    toast(`${checked ? 'Deleted' : 'Recycled'} ${plural(result.deleted.length, 'item')} · freed ${formatBytes(result.bytes)}`, 'success');
  }
  if (result.failed.length) {
    openModal({
      title: `${plural(result.failed.length, 'item')} could not be deleted`,
      body: `<div class="fail-list">${result.failed.slice(0, 200).map((f) => `<div class="fail-row"><div class="trunc selectable" title="${esc(f.path)}">${esc(f.path)}</div><div class="muted">${esc(f.error)}</div></div>`).join('')}</div>`,
      buttons: [{ label: 'OK', kind: 'primary', onClick: (m) => m.close() }],
    });
  }
  appState.refreshDrives();
  appState.emit('history');
  return result.deleted;
}

export function fileContextMenu(file, e, onDelete) {
  showMenu(e.clientX, e.clientY, [
    { label: 'Open', icon: 'open', onClick: () => api.files.open(file.path) },
    { label: 'Show in folder', icon: 'reveal', onClick: () => api.files.reveal(file.path) },
    { label: 'Copy path', icon: 'copy', onClick: () => api.app.copy(file.path) },
    '-',
    { label: 'Delete…', icon: 'trashOutline', danger: true, onClick: onDelete },
  ]);
}

/** "All Files" and "Large Files": recursive scan with filters, sortable results. */
export class FilesView {
  constructor(mode) {
    this.mode = mode;
    this.files = [];
    this.sort = { key: 'size', dir: 'desc' };
    this.query = '';
    this.jobId = null;
    this.scanned = false;
  }

  mount() {
    if (this.el) return this.el;
    const large = this.mode === 'large';
    const threshold = (appState.settings.largeFileThresholdMB || 100) * MB;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: large ? 'Find large files eating your disk space.' : 'Find, sort and remove files anywhere.',
        info: large
          ? 'Scans a drive or folder for big files. Windows and system folders are skipped (see Settings).'
          : 'Scans a folder and everything inside it. Filter by size, type or age, then sort by any column.',
        actions: `${searchBox('Filter results')}<button class="btn btn-big" data-delete disabled>Delete</button>`,
      })}
      <div class="toolbar">
        <span data-loc></span>
        <select class="select" data-size>${SIZE_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <select class="select" data-type>${typeOptions()}</select>
        <select class="select" data-age>${AGE_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <button class="btn btn-accent" data-scan>${icon('search', { size: 17 })}<span>Scan</span></button>
      </div>
      <div data-progress></div>
      <div class="result-line muted" hidden></div>
      <div class="panel"></div>
    </div>`);

    const sizeSelect = this.el.querySelector('[data-size]');
    sizeSelect.value = String(large ? SIZE_OPTIONS.find(([v]) => v >= threshold)?.[0] ?? 100 * MB : 0);

    const initial = large ? (appState.systemDrive?.path || appState.info.paths.home) : appState.info.paths.home;
    this.picker = new LocationPicker(initial, () => this.scan());
    this.el.querySelector('[data-loc]').replaceWith(this.picker.el);
    this.progress = new ScanProgress();
    this.el.querySelector('[data-progress]').replaceWith(this.progress.el);
    this.resultLine = this.el.querySelector('.result-line');
    this.scanBtn = this.el.querySelector('[data-scan]');
    this.deleteBtn = this.el.querySelector('[data-delete]');
    this.summary = this.el.querySelector('.sel-summary');

    this.table = new DataTable({
      rowHeight: 56,
      sort: this.sort,
      getId: (f) => f.path,
      emptyHtml: emptyHtml(large ? 'Pick a drive or folder, then press Scan.' : 'Choose a folder and press Scan to list its files.', 'Nothing is deleted until you confirm.', 'search'),
      columns: [
        { key: 'name', label: (t) => `Name (Total: ${formatNumber(t.rows.length)})`, sortable: true, render: (f) => fileNameCell(fileBadge(f.ext), f.name, dirname(f.path)) },
        { key: 'size', label: 'Size', width: '110px', sortable: true, defaultDir: 'desc', render: (f) => `<span class="trunc strong">${formatBytes(f.size)}</span>` },
        { key: 'mtime', label: 'Modified', width: '130px', sortable: true, defaultDir: 'desc', render: (f) => `<span class="trunc">${formatDate(f.mtime)}</span>` },
        { key: 'type', label: 'Type', width: '120px', sortable: true, render: (f) => `<span class="trunc">${esc(typeLabel(f.ext))}</span>` },
        { key: 'op', label: 'Operation', width: '120px', align: 'center', render: () => opButtons([['reveal', 'reveal', 'Show in folder'], ['delete', 'trash', 'Delete']]) },
      ],
      onSort: (sort) => {
        this.sort = sort;
        this.update();
      },
      onSelectionChange: (rows) => this.onSelection(rows),
      onAction: (action, f) => {
        if (action === 'reveal') api.files.reveal(f.path);
        if (action === 'delete') this.remove([f]);
      },
      onDblClick: (f) => api.files.open(f.path),
      onContextMenu: (f, e) => fileContextMenu(f, e, () => this.remove([f])),
    });
    this.el.querySelector('.panel').append(this.table.el);

    this.scanBtn.addEventListener('click', () => (this.jobId ? this.stop() : this.scan()));
    this.deleteBtn.addEventListener('click', () => this.primaryAction());
    for (const sel of this.el.querySelectorAll('[data-size], [data-type], [data-age]')) {
      sel.addEventListener('change', () => this.scanned && this.scan());
    }
    this.el.querySelector('input[type=search]').addEventListener('input', debounce((e) => {
      this.query = e.target.value.trim().toLowerCase();
      this.update();
    }, 150));
    return this.el;
  }

  onShow() {
    if (this.mode === 'large' && !this.scanned && !this.jobId) this.scan();
  }

  refresh() {
    this.scan();
  }

  focusSearch() {
    this.el.querySelector('input[type=search]').focus();
  }

  selectAll() {
    this.table.selectAll(true);
  }

  primaryAction() {
    this.remove(this.table.getSelectedRows());
  }

  params() {
    return {
      root: this.picker.value,
      minSize: Number(this.el.querySelector('[data-size]').value) || 0,
      ...typeFilter(this.el.querySelector('[data-type]').value),
      ...ageFilter(this.el.querySelector('[data-age]').value),
    };
  }

  async scan() {
    if (this.jobId) await this.stop();
    const jobId = uid('files');
    this.jobId = jobId;
    this.scanned = true;
    this.setScanning(true);
    this.files = [];
    this.table.setEmpty(loadingHtml('Scanning…'));
    this.update();
    this.resultLine.hidden = true;
    this.progress.show(`Scanning ${this.picker.value}…`);
    const off = api.jobs.onProgress(({ jobId: id, data }) => {
      if (id !== jobId) return;
      this.progress.set(`${formatNumber(data.scanned)} files checked · ${formatNumber(data.matched)} found (${formatBytes(data.matchedBytes || 0)})${data.currentDir ? ` · ${data.currentDir}` : ''}`);
    });
    const started = performance.now();
    try {
      const result = await api.files.scan(jobId, this.params());
      if (this.jobId !== jobId) return;
      this.files = result.files;
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      let text = `Found ${plural(result.matched, 'file')} (${formatBytes(result.matchedBytes)}) among ${formatNumber(result.scanned)} checked in ${secs}s.`;
      if (result.truncated) text += ` Showing the ${formatNumber(result.files.length)} largest.`;
      if (result.stopped) text = `Stopped. ${text}`;
      this.resultLine.textContent = text;
      this.resultLine.hidden = false;
      this.table.setEmpty(emptyHtml('No files match these filters.', 'Try a smaller size or another folder.', 'search'));
    } catch (err) {
      if (this.jobId !== jobId) return;
      this.table.setEmpty(emptyHtml('The scan failed.', errorMessage(err), 'alert'));
    } finally {
      off();
      if (this.jobId === jobId) {
        this.jobId = null;
        this.setScanning(false);
        this.progress.hide();
      }
    }
    this.table.scrollToTop();
    this.update();
  }

  async stop() {
    if (this.jobId) await api.jobs.cancel(this.jobId);
  }

  setScanning(on) {
    this.scanBtn.innerHTML = on ? `${icon('stop', { size: 17 })}<span>Stop</span>` : `${icon('search', { size: 17 })}<span>Scan</span>`;
    this.scanBtn.classList.toggle('btn-stop', on);
  }

  update() {
    let rows = this.files;
    if (this.query) rows = rows.filter((f) => f.path.toLowerCase().includes(this.query));
    rows = sortBy(rows, GETTERS[this.sort.key] || GETTERS.size, this.sort.dir);
    this.table.setRows(rows);
  }

  onSelection(rows) {
    const bytes = rows.reduce((sum, f) => sum + f.size, 0);
    this.summary.textContent = rows.length ? `${plural(rows.length, 'file')} · ${formatBytes(bytes)}` : '';
    this.deleteBtn.disabled = !rows.length;
    this.deleteBtn.classList.toggle('btn-primary', rows.length > 0);
    this.deleteBtn.textContent = rows.length > 1 ? `Delete (${formatNumber(rows.length)})` : 'Delete';
  }

  async remove(items) {
    const deleted = await deleteFiles(items, { label: this.mode === 'large' ? 'Large files' : 'Files' });
    if (deleted.length) {
      this.files = without(this.files, deleted);
      this.update();
    }
  }
}
