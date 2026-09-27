import { api, esc, h, formatBytes, formatNumber, plural, uid, errorMessage } from '../util.js';
import { icon } from '../icons.js';
import { DataTable } from '../components/table.js';
import { confirmDialog, toast } from '../components/overlay.js';
import { appState } from '../store.js';
import { viewHeader, emptyHtml, loadingHtml, muted } from './common.js';

/** Junk cleaner: temp files, caches, crash dumps, update leftovers, Recycle Bin. */
export class JunkView {
  constructor() {
    this.categories = [];
    this.state = 'idle'; // idle | scanning | ready | cleaning | cleaned
    this.jobId = null;
    this.live = {};
    this.cleaned = null;
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Clean up junk files to free disk space.',
        info: 'Temporary files, caches, crash dumps and other clutter that is safe to remove. Files in use are skipped automatically.',
        actions: '<button class="btn btn-big btn-primary" data-main>Scan</button>',
      })}
      <div class="junk-hero">
        <div class="junk-ring">${icon('broom', { size: 40 })}</div>
        <div class="junk-text"><div class="junk-big">Ready to scan</div><div class="junk-sub muted">Find temporary files, caches and other junk.</div></div>
      </div>
      <div class="panel"></div>
    </div>`);
    this.mainBtn = this.el.querySelector('[data-main]');
    this.summary = this.el.querySelector('.sel-summary');

    this.table = new DataTable({
      rowHeight: 66,
      getId: (c) => c.id,
      emptyHtml: emptyHtml('Press Scan to look for junk files.', 'Nothing is removed until you press Clean.', 'broom'),
      columns: [
        {
          key: 'name', label: 'Category',
          render: (c) => `<div class="cell-name"><span class="cat-ico">${icon(c.icon, { size: 22 })}</span><div class="name-text"><div class="name-title trunc">${esc(c.name)}</div><div class="name-sub trunc" title="${esc((c.paths || []).join('\n'))}">${esc(c.description)}</div></div></div>`,
        },
        { key: 'count', label: 'Files', width: '120px', render: (c) => this.cell(c, 'count') },
        { key: 'size', label: 'Size', width: '140px', render: (c) => this.cell(c, 'size') },
      ],
      onSelectionChange: () => this.onSelection(),
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.mainBtn.addEventListener('click', () => this.primaryAction());
    return this.el;
  }

  onShow() {
    if (this.state === 'idle') this.scan();
  }

  refresh() {
    if (this.state !== 'scanning' && this.state !== 'cleaning') this.scan();
  }

  selectAll() {
    this.table.selectAll(true);
  }

  primaryAction() {
    if (this.state === 'scanning') api.jobs.cancel(this.jobId);
    else if (this.state === 'ready') this.clean();
    else if (this.state !== 'cleaning') this.scan();
  }

  cell(c, key) {
    const cleaned = this.cleaned?.[c.id];
    if (cleaned) {
      return key === 'size'
        ? `<span class="pill green">${formatBytes(cleaned.freed)} freed</span>`
        : `<span class="trunc">${formatNumber(cleaned.deleted)} removed</span>`;
    }
    if (this.state === 'scanning') {
      const live = this.live[c.id];
      if (!live) return c.id === this.currentCategory ? '<span class="spin"></span>' : muted('…');
      return `<span class="trunc">${key === 'size' ? formatBytes(live.size) : formatNumber(live.count)}</span>`;
    }
    const value = c[key];
    if (!value) return muted(key === 'size' ? '0 B' : '0');
    return `<span class="trunc${key === 'size' ? ' strong' : ''}">${key === 'size' ? formatBytes(value) : formatNumber(value)}</span>`;
  }

  setHero(big, sub, busy = false) {
    this.el.querySelector('.junk-big').textContent = big;
    this.el.querySelector('.junk-sub').textContent = sub;
    this.el.querySelector('.junk-ring').classList.toggle('busy', busy);
  }

  async scan() {
    const jobId = uid('junk');
    this.jobId = jobId;
    this.state = 'scanning';
    this.cleaned = null;
    this.live = {};
    this.mainBtn.textContent = 'Stop';
    this.mainBtn.classList.remove('btn-primary');
    this.setHero('Scanning…', 'Looking through temporary folders and caches.', true);
    if (!this.categories.length) this.table.setEmpty(loadingHtml('Scanning for junk…'));
    this.table.refresh();

    const off = api.jobs.onProgress(({ jobId: id, data }) => {
      if (id !== jobId || !data.category) return;
      this.currentCategory = data.category;
      if (data.size != null) this.live[data.category] = { size: data.size, count: data.count };
      const cat = this.categories.find((c) => c.id === data.category);
      if (cat) this.setHero('Scanning…', `${cat.name}…`, true);
      this.table.refresh();
    });
    try {
      const result = await api.junk.scan(jobId);
      this.categories = result.categories;
      this.table.setRows(this.categories);
      this.table.setSelected(this.categories.filter((c) => c.checked && c.size > 0).map((c) => c.id));
      const total = this.categories.reduce((s, c) => s + c.size, 0);
      this.setHero(total ? `${formatBytes(total)} of junk found` : 'Your PC is clean', total ? `${plural(this.categories.reduce((s, c) => s + c.count, 0), 'file')} in ${plural(this.categories.filter((c) => c.size).length, 'category', 'categories')}.` : 'No junk files were found.');
      this.state = 'ready';
    } catch (err) {
      this.setHero('Scan failed', errorMessage(err));
      this.state = 'idle';
      this.mainBtn.textContent = 'Scan';
      this.mainBtn.classList.add('btn-primary');
    } finally {
      off();
      this.jobId = null;
      this.onSelection();
    }
  }

  onSelection() {
    const rows = this.table.getSelectedRows();
    const bytes = rows.reduce((s, c) => s + (c.size || 0), 0);
    if (this.state !== 'ready') return;
    this.summary.textContent = rows.length ? `${plural(rows.length, 'category', 'categories')} selected` : '';
    this.mainBtn.disabled = !bytes;
    this.mainBtn.classList.toggle('btn-primary', bytes > 0);
    this.mainBtn.textContent = bytes ? `Clean ${formatBytes(bytes)}` : 'Clean';
  }

  async clean() {
    const rows = this.table.getSelectedRows().filter((c) => c.size > 0);
    if (!rows.length) return;
    if (rows.some((c) => c.id === 'recycle-bin')) {
      const { ok } = await confirmDialog({
        title: `Empty the ${appState.isWindows ? 'Recycle Bin' : 'Trash'}?`,
        message: `<p>Files in the ${appState.isWindows ? 'Recycle Bin' : 'Trash'} will be deleted permanently and cannot be restored.</p>`,
        confirmLabel: 'Clean',
        kind: 'danger',
      });
      if (!ok) return;
    }
    const jobId = uid('clean');
    this.state = 'cleaning';
    this.mainBtn.disabled = true;
    this.mainBtn.textContent = 'Cleaning…';
    this.setHero('Cleaning…', 'Removing junk files. Files in use are skipped.', true);
    const off = api.jobs.onProgress(({ jobId: id, data }) => {
      if (id !== jobId || !data.category) return;
      const cat = this.categories.find((c) => c.id === data.category);
      this.setHero(`Cleaning… ${data.freed ? formatBytes(data.freed) : ''}`, cat ? `${cat.name}…` : '', true);
    });
    try {
      const result = await api.junk.clean(jobId, rows.map((c) => c.id));
      this.cleaned = result.results;
      this.table.selectAll(false);
      this.table.refresh();
      this.setHero(`${formatBytes(result.freed)} freed`, `${plural(result.deleted, 'file')} removed${result.failed ? ` · ${plural(result.failed, 'file')} in use were skipped` : ''}.`);
      toast(`Junk cleaned · ${formatBytes(result.freed)} freed`, 'success');
      appState.refreshDrives();
      appState.emit('history');
    } catch (err) {
      this.setHero('Cleaning failed', errorMessage(err));
    } finally {
      off();
      this.state = 'cleaned';
      this.summary.textContent = '';
      this.mainBtn.disabled = false;
      this.mainBtn.textContent = 'Scan again';
      this.mainBtn.classList.remove('btn-primary');
    }
  }
}
