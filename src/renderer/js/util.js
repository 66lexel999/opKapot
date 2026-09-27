export const api = globalThis.opk;

export const DAY = 86_400_000;
export const KB = 1024;
export const MB = 1024 * 1024;
export const GB = 1024 * MB;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Create an element from an HTML string. */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function formatBytes(bytes, digits = 1) {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(digits)} ${units[i]}`;
}

export function formatNumber(n) {
  return Number(n || 0).toLocaleString();
}

export function formatDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(ms) {
  if (!ms) return 'Never';
  const diff = Date.now() - ms;
  const day = Math.floor(diff / DAY);
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (day < 1) return 'Today';
  if (day === 1) return 'Yesterday';
  if (day < 30) return `${day} days ago`;
  if (day < 365) {
    const months = Math.floor(day / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }
  const years = Math.floor(day / 365);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

export function plural(n, word, pluralWord = `${word}s`) {
  return `${formatNumber(n)} ${n === 1 ? word : pluralWord}`;
}

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function uid(prefix = 'job') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip Electron's "Error invoking remote method …: Error:" prefix. */
export function errorMessage(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

const AVATAR_COLORS = ['#e2574c', '#f08c2e', '#d9a520', '#43a95c', '#1fa39a', '#2f8fd8', '#5b6ee1', '#8e5bd8', '#c9509b', '#6b7a8f'];
export function avatar(name, size = 32) {
  const text = String(name || '?').replace(/^[^a-z0-9]+/i, '');
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return `<span class="avatar" style="background:${color};width:${size}px;height:${size}px">${esc((text[0] || '?').toUpperCase())}</span>`;
}

/** Compare two values for sorting; empty values always sort last. */
export function compareValues(a, b) {
  const emptyA = a == null || a === '';
  const emptyB = b == null || b === '';
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  if (typeof a === 'string' || typeof b === 'string') {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  return a - b;
}

export function sortBy(rows, getter, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((x, y) => {
    const a = getter(x);
    const b = getter(y);
    const emptyA = a == null || a === '';
    const emptyB = b == null || b === '';
    if (emptyA || emptyB) return compareValues(a, b); // empties last regardless of direction
    return sign * compareValues(a, b);
  });
}

export class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
  }
}

export function dirname(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}
