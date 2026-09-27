import { esc } from '../util.js';

const SORT_ARROWS = {
  asc: '<svg class="sort-ind" width="12" height="12" viewBox="0 0 24 24"><path d="M12 6l7 10H5z" fill="currentColor"/></svg>',
  desc: '<svg class="sort-ind" width="12" height="12" viewBox="0 0 24 24"><path d="M12 18L5 8h14z" fill="currentColor"/></svg>',
};

/**
 * Virtualised, sortable, multi-select table. Only the rows in view are in the
 * DOM, so it stays fast with hundreds of thousands of files.
 *
 * Columns: { key, label (string | fn(table)), width, sortable, align, className, render(row) }
 */
export class DataTable {
  constructor(options) {
    this.opts = {
      rowHeight: 60,
      selectable: true,
      getId: (row) => row.id,
      isSelectable: () => true,
      emptyHtml: 'Nothing to show.',
      ...options,
    };
    this.columns = this.opts.columns;
    this.rows = [];
    this.selected = new Set();
    this.sort = this.opts.sort || null;
    this.anchor = null;
    this.start = -1;
    this.end = -1;

    this.el = document.createElement('div');
    this.el.className = 'dt';
    this.el.innerHTML = `
      <div class="dt-head" role="row"></div>
      <div class="dt-body">
        <div class="dt-spacer"><div class="dt-rows"></div></div>
        <div class="dt-empty" hidden></div>
      </div>`;
    this.head = this.el.querySelector('.dt-head');
    this.body = this.el.querySelector('.dt-body');
    this.spacer = this.el.querySelector('.dt-spacer');
    this.rowsEl = this.el.querySelector('.dt-rows');
    this.emptyEl = this.el.querySelector('.dt-empty');
    this.template = `${this.opts.selectable ? '56px ' : ''}${this.columns.map((c) => c.width || 'minmax(0, 1fr)').join(' ')}`;
    this.head.style.gridTemplateColumns = this.template;

    let frame = 0;
    this.body.addEventListener('scroll', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.render());
    });
    new ResizeObserver(() => {
      this.syncScrollbar();
      this.render(true);
    }).observe(this.body);

    this.head.addEventListener('click', (e) => this.onHeadClick(e));
    this.rowsEl.addEventListener('click', (e) => this.onRowClick(e));
    this.rowsEl.addEventListener('dblclick', (e) => {
      const row = this.rowFromEvent(e);
      if (row && !e.target.closest('[data-action]')) this.opts.onDblClick?.(row, e);
    });
    this.rowsEl.addEventListener('contextmenu', (e) => {
      const row = this.rowFromEvent(e);
      if (!row || !this.opts.onContextMenu) return;
      e.preventDefault();
      this.opts.onContextMenu(row, e);
    });
    this.renderHead();
  }

  setRows(rows) {
    this.rows = rows;
    const valid = new Set(rows.filter((r) => this.opts.isSelectable(r)).map(this.opts.getId));
    let pruned = false;
    for (const id of this.selected) {
      if (!valid.has(id)) {
        this.selected.delete(id);
        pruned = true;
      }
    }
    this.spacer.style.height = `${rows.length * this.opts.rowHeight}px`;
    this.emptyEl.hidden = rows.length > 0;
    this.render(true);
    this.renderHead();
    this.syncScrollbar();
    if (pruned) this.opts.onSelectionChange?.(this.getSelectedRows());
  }

  setEmpty(html) {
    this.opts.emptyHtml = html;
    this.emptyEl.innerHTML = html;
  }

  setSort(sort) {
    this.sort = sort;
    this.renderHead();
  }

  refresh() {
    this.render(true);
    this.renderHead();
  }

  scrollToTop() {
    this.body.scrollTop = 0;
  }

  // ------------------------------------------------------------ selection ---

  selectableRows() {
    return this.rows.filter((r) => this.opts.isSelectable(r));
  }

  getSelectedRows() {
    return this.rows.filter((r) => this.selected.has(this.opts.getId(r)));
  }

  setSelected(ids) {
    this.selected = new Set(ids);
    this.afterSelection();
  }

  selectAll(on = true) {
    this.selected = on ? new Set(this.selectableRows().map(this.opts.getId)) : new Set();
    this.afterSelection();
  }

  afterSelection() {
    this.render(true);
    this.renderHead();
    this.opts.onSelectionChange?.(this.getSelectedRows());
  }

  selectAllState() {
    const total = this.selectableRows().length;
    if (!total || !this.selected.size) return '';
    return this.selected.size >= total ? 'on' : 'mixed';
  }

  // -------------------------------------------------------------- events ---

  rowFromEvent(e) {
    const el = e.target.closest('.dt-row');
    return el ? this.rows[Number(el.dataset.i)] : null;
  }

  onHeadClick(e) {
    if (e.target.closest('[data-select-all]')) {
      this.selectAll(this.selectAllState() !== 'on');
      return;
    }
    const th = e.target.closest('.dt-th.sortable');
    if (!th) return;
    const key = th.dataset.key;
    const col = this.columns.find((c) => c.key === key);
    const dir = this.sort?.key === key
      ? (this.sort.dir === 'asc' ? 'desc' : 'asc')
      : (col.defaultDir || 'asc');
    this.sort = { key, dir };
    this.renderHead();
    this.opts.onSort?.(this.sort);
  }

  onRowClick(e) {
    const rowEl = e.target.closest('.dt-row');
    if (!rowEl) return;
    const index = Number(rowEl.dataset.i);
    const row = this.rows[index];
    const action = e.target.closest('[data-action]');
    if (action) {
      e.stopPropagation();
      this.opts.onAction?.(action.dataset.action, row, e);
      return;
    }
    if (!this.opts.selectable || !this.opts.isSelectable(row)) {
      this.opts.onRowClick?.(row, e);
      return;
    }
    const id = this.opts.getId(row);
    const on = !this.selected.has(id);
    if (e.shiftKey && this.anchor != null) {
      const [a, b] = [Math.min(this.anchor, index), Math.max(this.anchor, index)];
      const anchorOn = this.selected.has(this.opts.getId(this.rows[this.anchor]));
      for (let i = a; i <= b; i++) {
        const r = this.rows[i];
        if (!this.opts.isSelectable(r)) continue;
        if (anchorOn) this.selected.add(this.opts.getId(r));
        else this.selected.delete(this.opts.getId(r));
      }
    } else {
      if (on) this.selected.add(id);
      else this.selected.delete(id);
      this.anchor = index;
    }
    this.afterSelection();
  }

  // ------------------------------------------------------------ rendering ---

  syncScrollbar() {
    const width = this.body.offsetWidth - this.body.clientWidth;
    this.head.style.paddingRight = `${width}px`;
  }

  renderHead() {
    let html = '';
    if (this.opts.selectable) {
      html += `<div class="dt-th dt-check"><span class="cb ${this.selectAllState()}" data-select-all title="Select all"></span></div>`;
    }
    this.columns.forEach((col, i) => {
      const label = typeof col.label === 'function' ? col.label(this) : col.label;
      const sorted = this.sort?.key === col.key;
      const cls = `dt-th${i === 0 ? ' first' : ''}${col.sortable ? ' sortable' : ''}${sorted ? ' sorted' : ''}${col.align === 'center' ? ' center' : col.align === 'right' ? ' right' : ''}`;
      html += `<div class="${cls}" data-key="${esc(col.key)}"><span class="trunc">${esc(label ?? '')}</span>${sorted ? SORT_ARROWS[this.sort.dir] : ''}</div>`;
    });
    this.head.innerHTML = html;
  }

  render(force = false) {
    const rh = this.opts.rowHeight;
    const top = this.body.scrollTop;
    const height = this.body.clientHeight || 800;
    const start = Math.max(0, Math.floor(top / rh) - 6);
    const end = Math.min(this.rows.length, Math.ceil((top + height) / rh) + 6);
    if (!force && start === this.start && end === this.end) return;
    this.start = start;
    this.end = end;
    let html = '';
    for (let i = start; i < end; i++) html += this.rowHtml(this.rows[i], i);
    this.rowsEl.style.transform = `translateY(${start * rh}px)`;
    this.rowsEl.innerHTML = html;
    if (!this.rows.length) this.emptyEl.innerHTML = this.opts.emptyHtml;
  }

  rowHtml(row, i) {
    const rh = this.opts.rowHeight;
    const extra = this.opts.rowClass?.(row) || '';
    const custom = this.opts.renderRow?.(row);
    if (custom != null) {
      return `<div class="dt-row dt-row-custom ${extra}" data-i="${i}" style="height:${rh}px">${custom}</div>`;
    }
    const id = this.opts.getId(row);
    const selected = this.selected.has(id);
    let cells = '';
    if (this.opts.selectable) {
      cells += `<div class="dt-td dt-check">${this.opts.isSelectable(row) ? `<span class="cb${selected ? ' on' : ''}"></span>` : ''}</div>`;
    }
    for (const col of this.columns) {
      const content = col.render ? col.render(row) : `<span class="trunc">${esc(row[col.key] ?? '')}</span>`;
      const align = col.align === 'center' ? ' center' : col.align === 'right' ? ' right' : '';
      cells += `<div class="dt-td${align}${col.className ? ` ${col.className}` : ''}">${content}</div>`;
    }
    return `<div class="dt-row${selected ? ' selected' : ''}${extra ? ` ${extra}` : ''}" data-i="${i}" style="grid-template-columns:${this.template};height:${rh}px">${cells}</div>`;
  }
}
