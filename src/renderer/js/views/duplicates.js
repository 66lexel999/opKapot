import { api, esc, h, MB, KB, formatBytes, formatDate, formatNumber, plural, sortBy, uid, errorMessage, dirname } from '../util.js';
import { icon } from '../icons.js';
import { DataTable } from '../components/table.js';
import { showMenu, toast } from '../components/overlay.js';
import { appState } from '../store.js';
import { viewHeader, emptyHtml, loadingHtml, fileNameCell, opButtons, LocationPicker, ScanProgress } from './common.js';
import { fileBadge, typeFilter, typeOptions } from '../fileTypes.js';
import { deleteFiles, fileContextMenu } from './files.js';

const MIN_SIZES = [[KB, 'Over 1 KB'], [100 * KB, 'Over 100 KB'], [MB, 'Over 1 MB'], [10 * MB, 'Over 10 MB'], [100 * MB, 'Over 100 MB']];

const GROUP_GETTERS = {
  name: (g) => g.files[0].name,
  size: (g) => g.size,
  wasted: (g) => g.wasted,
  mtime: (g) => Math.max(...g.files.map((f) => f.mtime)),
};

/** Duplicate finder: groups byte-identical files (size → partial hash → full SHA-1). */
export class DuplicatesView {
  constructor() {
    this.groups = [];
    this.sort = { key: 'wasted', dir: 'desc' };
    this.jobId = null;
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Find duplicate files wasting space.',
        info: 'Files are compared by content (SHA-1), not just by name. Keep one copy of each group and remove the rest.',
        actions: `<button class="btn" data-smart>${icon('wand', { size: 17 })}<span>Auto-select</span></button><button class="btn btn-big" data-delete disabled>Delete</button>`,
      })}
      <div class="toolbar">
        <span data-loc></span>
        <select class="select" data-size>${MIN_SIZES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        <select class="select" data-type>${typeOptions()}</select>
        <button class="btn btn-accent" data-scan>${icon('search', { size: 17 })}<span>Scan</span></button>
      </div>
      <div data-progress></div>
      <div class="result-line muted" hidden></div>
      <div class="panel"></div>
    </div>`);
    this.el.querySelector('[data-size]').value = String(MB);
    this.picker = new LocationPicker(appState.info.paths.home, () => this.scan());
    this.el.querySelector('[data-loc]').replaceWith(this.picker.el);
    this.progress = new ScanProgress();
    this.el.querySelector('[data-progress]').replaceWith(this.progress.el);
    this.resultLine = this.el.querySelector('.result-line');
    this.scanBtn = this.el.querySelector('[data-scan]');
    this.deleteBtn = this.el.querySelector('[data-delete]');
    this.summary = this.el.querySelector('.sel-summary');

    this.table = new DataTable({
      rowHeight: 54,
      sort: this.sort,
      getId: (r) => r.key,
      isSelectable: (r) => !r.group,
      rowClass: (r) => (r.group ? 'group-row' : 'depth-1'),
      emptyHtml: emptyHtml('Choose a folder and press Scan to find duplicates.', 'Files are compared by their content.', 'copy'),
      renderRow: (r) => (r.group ? this.groupRow(r) : null),
      columns: [
        { key: 'name', label: (t) => `Name (${plural(t.rows.filter((r) => r.group).length, 'group')})`, sortable: true, render: (f) => fileNameCell(fileBadge(f.ext, 28), f.name, dirname(f.path)) },
        { key: 'size', label: 'Size', width: '110px', sortable: true, defaultDir: 'desc', render: (f) => `<span class="trunc">${formatBytes(f.size)}</span>` },
        { key: 'mtime', label: 'Modified', width: '130px', sortable: true, defaultDir: 'desc', render: (f) => `<span class="trunc">${formatDate(f.mtime)}</span>` },
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
      onDblClick: (f) => !f.group && api.files.open(f.path),
      onContextMenu: (f, e) => !f.group && fileContextMenu(f, e, () => this.remove([f])),
    });
    this.el.querySelector('.panel').append(this.table.el);

    this.scanBtn.addEventListener('click', () => (this.jobId ? api.jobs.cancel(this.jobId) : this.scan()));
    this.deleteBtn.addEventListener('click', () => this.primaryAction());
    this.el.querySelector('[data-smart]').addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left, r.bottom + 6, [
        { label: 'Keep the newest copy in each group', icon: 'check', onClick: () => this.autoSelect('newest') },
        { label: 'Keep the oldest copy in each group', icon: 'check', onClick: () => this.autoSelect('oldest') },
        { label: 'Keep the copy with the shortest path', icon: 'check', onClick: () => this.autoSelect('shortest') },
        '-',
        { label: 'Clear selection', icon: 'close', onClick: () => this.table.selectAll(false) },
      ]);
    });
    return this.el;
  }

  onShow() {}

  refresh() {
    this.scan();
  }

  selectAll() {
    this.autoSelect('newest');
  }

  primaryAction() {
    this.remove(this.table.getSelectedRows());
  }

  groupRow(g) {
    return `<div class="group-head">${icon('copy', { size: 18 })}
      <span><b>${plural(g.count, 'identical file')}</b> · ${formatBytes(g.size)} each</span>
      <span class="pill orange">${formatBytes(g.wasted)} wasted</span></div>`;
  }

  async scan() {
    if (this.jobId) await api.jobs.cancel(this.jobId);
    const jobId = uid('dups');
    this.jobId = jobId;
    this.groups = [];
    this.update();
    this.table.setEmpty(loadingHtml('Looking for duplicates…'));
    this.resultLine.hidden = true;
    this.scanBtn.innerHTML = `${icon('stop', { size: 17 })}<span>Stop</span>`;
    this.scanBtn.classList.add('btn-stop');
    this.progress.show(`Scanning ${this.picker.value}…`);
    const off = api.jobs.onProgress(({ jobId: id, data }) => {
      if (id !== jobId) return;
      if (data.phase === 'scan') this.progress.set(`Listing files… ${formatNumber(data.scanned)} found · ${data.currentDir || ''}`);
      else if (data.phase === 'hash') this.progress.set(`Comparing ${formatNumber(data.candidates)} possible duplicates… ${formatNumber(data.hashedFiles)} checked (${formatBytes(data.hashedBytes)} read)`);
    });
    try {
      const params = {
        root: this.picker.value,
        minSize: Number(this.el.querySelector('[data-size]').value),
        ...typeFilter(this.el.querySelector('[data-type]').value),
      };
      delete params.excludeExts;
      const result = await api.files.duplicates(jobId, params);
      if (this.jobId !== jobId) return;
      this.groups = result.groups.map((g) => ({
        ...g,
        files: g.files.map((f) => ({ ...f, ext: (/\.([^.\\/]+)$/.exec(f.name)?.[1] || '').toLowerCase(), groupId: g.id })),
      }));
      const wasted = this.groups.reduce((sum, g) => sum + g.wasted, 0);
      this.resultLine.textContent = result.stopped
        ? 'Stopped before the comparison finished.'
        : `${plural(this.groups.length, 'group')} of duplicates among ${formatNumber(result.scanned)} files · ${formatBytes(wasted)} can be freed.`;
      this.resultLine.hidden = false;
      this.table.setEmpty(emptyHtml('No duplicates found.', 'Every file here is unique.'));
    } catch (err) {
      if (this.jobId === jobId) this.table.setEmpty(emptyHtml('The scan failed.', errorMessage(err), 'alert'));
    } finally {
      off();
      if (this.jobId === jobId) {
        this.jobId = null;
        this.scanBtn.innerHTML = `${icon('search', { size: 17 })}<span>Scan</span>`;
        this.scanBtn.classList.remove('btn-stop');
        this.progress.hide();
      }
    }
    this.update();
  }

  update() {
    const key = this.sort.key === 'location' ? 'wasted' : this.sort.key;
    const groups = sortBy(this.groups, GROUP_GETTERS[key] || GROUP_GETTERS.wasted, this.sort.dir);
    const rows = [];
    for (const g of groups) {
      rows.push({ group: true, key: `group:${g.id}`, ...g });
      for (const f of g.files) rows.push({ ...f, key: f.path });
    }
    this.table.setRows(rows);
  }

  autoSelect(mode) {
    const ids = [];
    for (const g of this.groups) {
      const files = [...g.files];
      let keep;
      if (mode === 'newest') keep = files.reduce((a, b) => (b.mtime > a.mtime ? b : a));
      else if (mode === 'oldest') keep = files.reduce((a, b) => (b.mtime < a.mtime ? b : a));
      else keep = files.reduce((a, b) => (b.path.length < a.path.length ? b : a));
      for (const f of files) if (f !== keep) ids.push(f.path);
    }
    this.table.setSelected(ids);
  }

  onSelection(rows) {
    const bytes = rows.reduce((sum, f) => sum + f.size, 0);
    this.summary.textContent = rows.length ? `${plural(rows.length, 'file')} · ${formatBytes(bytes)}` : '';
    this.deleteBtn.disabled = !rows.length;
    this.deleteBtn.classList.toggle('btn-primary', rows.length > 0);
    this.deleteBtn.textContent = rows.length > 1 ? `Delete (${formatNumber(rows.length)})` : 'Delete';
  }

  async remove(items) {
    // Never silently wipe every copy of a file.
    const chosen = new Set(items.map((f) => f.path));
    const wiped = this.groups.filter((g) => g.files.every((f) => chosen.has(f.path)));
    if (wiped.length) {
      const keep = new Set(wiped.map((g) => g.files[g.files.length - 1].path));
      items = items.filter((f) => !keep.has(f.path));
      toast(`Kept the newest copy of ${plural(wiped.length, 'file')} so nothing is lost.`, 'info');
      if (!items.length) return;
    }
    const deleted = await deleteFiles(items, { label: 'Duplicate files' });
    if (!deleted.length) return;
    const gone = new Set(deleted);
    this.groups = this.groups
      .map((g) => {
        const files = g.files.filter((f) => !gone.has(f.path));
        return { ...g, files, count: files.length, wasted: g.size * (files.length - 1) };
      })
      .filter((g) => g.files.length > 1);
    this.update();
  }
}
