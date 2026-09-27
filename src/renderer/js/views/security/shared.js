import { api, esc, avatar, errorMessage } from '../../util.js';
import { icon } from '../../icons.js';
import { confirmDialog, openModal, toast } from '../../components/overlay.js';
import { securityStore } from '../../securityStore.js';

export const SEVERITY = {
  danger: { label: 'Danger', icon: 'shieldAlert' },
  warning: { label: 'Warning', icon: 'alert' },
  notice: { label: 'Info', icon: 'info' },
  ok: { label: 'OK', icon: 'checkCircle' },
};

export function sevPill(severity, text) {
  return `<span class="sev sev-${severity}">${esc(text || SEVERITY[severity]?.label || severity)}</span>`;
}

export function sevIcon(severity, size = 20) {
  return `<span class="sev-ico sev-${severity}">${icon(SEVERITY[severity]?.icon || 'info', { size })}</span>`;
}

/** A program's real icon when we have it, otherwise a letter avatar. */
export function appIcon(file, name, size = 30) {
  const url = file ? securityStore.icons.get(file) : null;
  return url ? `<img class="app-icon" src="${url}" width="${size}" height="${size}" alt="">` : avatar(name || '?', size);
}

export function notSupportedHtml() {
  return `<div class="empty-state">${icon('windows', { size: 40, className: 'empty-icon' })}<div>Security checks are available on Windows.</div><div class="empty-sub">Run opKapot on your Windows PC, or start it with --demo to explore.</div></div>`;
}

/** Run an action with a confirmation and a toast for the result. */
export async function confirmRun({ title, message, confirmLabel = 'Continue', kind = 'primary', run }) {
  if (message) {
    const { ok } = await confirmDialog({ title, message: `<p>${esc(message)}</p>`, confirmLabel, kind });
    if (!ok) return null;
  }
  try {
    const res = await run();
    if (res && res.ok === false) toast(esc(res.message || 'It didn\'t work.'), 'error', 7000);
    else if (res?.message) toast(esc(res.message), 'success');
    return res;
  } catch (err) {
    toast(esc(errorMessage(err)), 'error', 7000);
    return null;
  }
}

/** Full explanation of a Hack Check finding. */
export function showFinding(f, { onFix, onIgnore, onLink } = {}) {
  const modal = openModal({
    title: f.title,
    width: 660,
    body: `
      <div class="finding-head">${sevIcon(f.severity, 26)}<div>${sevPill(f.severity)}<span class="muted small"> · ${esc(f.categoryLabel || '')}</span></div></div>
      <p class="finding-summary">${esc(f.summary || '')}</p>
      ${f.evidence?.length ? `<div class="evidence selectable">${f.evidence.map((e) => `<div>${esc(e)}</div>`).join('')}</div>` : ''}
      ${f.advice ? `<p class="advice">${icon('info', { size: 16 })}<span>${esc(f.advice)}</span></p>` : ''}
      ${f.fixed ? `<p class="fixed-note">${icon('checkCircle', { size: 16 })} Fixed.</p>` : ''}`,
    buttons: [
      onIgnore && f.severity !== 'ok' ? { label: f.ignored ? 'Stop ignoring' : 'Ignore', onClick: (m) => { m.close(); onIgnore(f); } } : null,
      f.link && onLink ? { label: f.link.label, onClick: () => onLink(f.link) } : null,
      f.fix && !f.fixed && onFix ? { label: f.fix.label, kind: f.severity === 'danger' ? 'danger' : 'primary', onClick: (m) => { m.close(); onFix(f); } } : null,
      { label: 'Close', onClick: (m) => m.close() },
    ].filter(Boolean),
  });
  return modal;
}

export function openLink(link, navigate) {
  if (link.view) navigate(link.view);
  else if (link.uri) api.security.openUri(link.uri);
}
