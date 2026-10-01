import { api, esc, h, avatar, formatBytes, pathLink } from '../util.js';
import { icon } from '../icons.js';
import { appState, programsStore } from '../store.js';

export function viewHeader({ title, info = '', actions = '' }) {
  return `<div class="view-header">
    <div class="view-heading">
      <div class="view-title"><span>${esc(title)}</span>${info ? `<span class="info-dot" title="${esc(info)}">${icon('info', { size: 18 })}</span>` : ''}</div>
      <div class="sel-summary"></div>
    </div>
    <div class="view-actions">${actions}</div>
  </div>`;
}

export function searchBox(placeholder = 'Search') {
  return `<label class="search">${icon('search', { size: 17 })}<input type="search" placeholder="${esc(placeholder)}" spellcheck="false"></label>`;
}

export function loadingHtml(text) {
  return `<div class="empty-state"><span class="spin big"></span><div>${esc(text)}</div></div>`;
}

export function emptyHtml(text, sub = '', iconName = 'checkCircle') {
  return `<div class="empty-state">${icon(iconName, { size: 40, className: 'empty-icon' })}<div>${esc(text)}</div>${sub ? `<div class="empty-sub">${esc(sub)}</div>` : ''}</div>`;
}

export function programIcon(program, size = 32) {
  const url = programsStore.icons.get(program.id) || program.icon;
  return url ? `<img class="app-icon" src="${url}" width="${size}" height="${size}" alt="">` : avatar(program.name, size);
}

export function nameCell(iconHtml, title, sub = '') {
  return `<div class="cell-name">${iconHtml}<div class="name-text"><div class="name-title trunc" title="${esc(title)}">${esc(title)}</div>${sub ? `<div class="name-sub trunc">${esc(sub)}</div>` : ''}</div></div>`;
}

/** Name with its folder underneath; long paths are cut at the start so the end stays visible. */
export function fileNameCell(iconHtml, name, folder) {
  return `<div class="cell-name">${iconHtml}<div class="name-text"><div class="name-title trunc" title="${esc(name)}">${esc(name)}</div><div class="name-sub trunc path-start" title="${esc(folder)}"><bdi>${pathLink(folder)}</bdi></div></div></div>`;
}

/** Like nameCell, with a clickable path underneath. */
export function pathNameCell(iconHtml, title, filePath) {
  return `<div class="cell-name">${iconHtml}<div class="name-text"><div class="name-title trunc" title="${esc(title)}">${esc(title)}</div><div class="name-sub trunc path-start" title="${esc(filePath)}"><bdi>${pathLink(filePath, { file: true })}</bdi></div></div></div>`;
}

export function opButtons(buttons) {
  return `<div class="ops">${buttons.map(([action, iconName, title]) => `<button class="op-btn${action === 'delete' || action === 'uninstall' ? ' op-danger' : ''}" data-action="${action}" title="${esc(title)}">${icon(iconName, { size: 22 })}</button>`).join('')}</div>`;
}

export function muted(text) {
  return `<span class="muted">${esc(text)}</span>`;
}

/** Folder chooser: drives, common folders and "Browse…". */
export class LocationPicker {
  constructor(initial, onChange) {
    this.value = initial;
    this.onChange = onChange;
    this.el = h('<select class="select loc-select"></select>');
    this.el.addEventListener('change', async () => {
      if (this.el.value === '__browse') {
        const picked = await api.files.pickFolder(this.value);
        if (picked) this.value = picked;
        this.render();
        if (picked) this.onChange(picked);
        return;
      }
      this.value = this.el.value;
      this.render();
      this.onChange(this.value);
    });
    appState.on('drives', () => this.render());
    this.render();
  }

  options() {
    const opts = appState.drives.map((d) => [d.path, `${d.name} · ${formatBytes(d.free)} free`]);
    const p = appState.info.paths || {};
    const folders = [['home', 'Home folder'], ['downloads', 'Downloads'], ['desktop', 'Desktop'], ['documents', 'Documents'], ['videos', 'Videos']];
    for (const [key, label] of folders) {
      if (p[key] && !opts.some(([v]) => v === p[key])) opts.push([p[key], label]);
    }
    if (this.value && !opts.some(([v]) => v === this.value)) opts.push([this.value, this.value]);
    return opts;
  }

  render() {
    this.el.innerHTML = `${this.options().map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}<option value="__browse">Browse for a folder…</option>`;
    this.el.value = this.value;
    this.el.title = this.value;
  }

  set(value) {
    this.value = value;
    this.render();
  }
}

/** Progress strip shown under the toolbar while a scan runs. */
export class ScanProgress {
  constructor() {
    this.el = h('<div class="progress-line" hidden><div class="bar indeterminate"><i></i></div><span class="progress-text trunc"></span></div>');
    this.text = this.el.querySelector('.progress-text');
    this.bar = this.el.querySelector('.bar');
  }

  show(text = '') {
    this.el.hidden = false;
    this.bar.classList.add('indeterminate');
    this.bar.firstElementChild.style.width = '';
    this.set(text);
  }

  set(text, pct = null) {
    this.text.textContent = text;
    this.text.title = text;
    if (pct != null) {
      this.bar.classList.remove('indeterminate');
      this.bar.firstElementChild.style.width = `${Math.max(2, Math.min(100, pct))}%`;
    }
  }

  hide() {
    this.el.hidden = true;
  }
}

/** Remove `ids` from a table's rows after a delete. */
export function without(rows, removed, key = 'path') {
  const set = new Set(removed);
  return rows.filter((r) => !set.has(r[key]));
}
