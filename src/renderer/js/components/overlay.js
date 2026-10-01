import { api, esc, h, errorMessage } from '../util.js';
import { icon } from '../icons.js';

const root = () => document.getElementById('overlay-root');

// ---------------------------------------------------------------- modals ---

const openModals = [];

/**
 * Open a modal dialog. `body` may be an HTML string or an element.
 * Buttons: [{ id, label, kind: 'primary'|'danger'|'secondary', onClick(modal), disabled }]
 */
export function openModal({ title, body = '', buttons = [], width = 560, closable = true, onClose } = {}) {
  const overlay = h(`
    <div class="overlay">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(${width}px, 94vw)">
        <div class="modal-head"><span class="modal-title"></span>
          <button class="icon-btn modal-x" title="Close">${icon('close', { size: 18 })}</button></div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div>
    </div>`);
  const modal = {
    el: overlay,
    closable,
    close(result) {
      overlay.remove();
      openModals.splice(openModals.indexOf(modal), 1);
      onClose?.(result);
    },
    setTitle(text) {
      overlay.querySelector('.modal-title').textContent = text;
    },
    setBody(content) {
      const el = overlay.querySelector('.modal-body');
      el.innerHTML = '';
      if (typeof content === 'string') el.innerHTML = content;
      else if (content) el.append(content);
      return el;
    },
    body() {
      return overlay.querySelector('.modal-body');
    },
    setButtons(list) {
      const foot = overlay.querySelector('.modal-foot');
      foot.innerHTML = '';
      foot.hidden = !list.length;
      for (const b of list) {
        const btn = h(`<button class="btn ${b.kind === 'primary' ? 'btn-primary' : b.kind === 'danger' ? 'btn-danger' : ''}">${esc(b.label)}</button>`);
        if (b.id) btn.dataset.id = b.id;
        btn.disabled = !!b.disabled;
        btn.addEventListener('click', () => b.onClick?.(modal));
        foot.append(btn);
      }
    },
    button(id) {
      return overlay.querySelector(`.modal-foot [data-id="${id}"]`);
    },
    setClosable(value) {
      modal.closable = value;
      overlay.querySelector('.modal-x').hidden = !value;
    },
  };
  modal.setTitle(title);
  modal.setBody(body);
  modal.setButtons(buttons);
  modal.setClosable(closable);
  overlay.querySelector('.modal-x').addEventListener('click', () => modal.closable && modal.close(null));
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && modal.closable) modal.close(null);
  });
  root().append(overlay);
  openModals.push(modal);
  overlay.querySelector('.modal-foot .btn-primary, .modal-foot .btn-danger')?.focus();
  return modal;
}

export function closeTopModal() {
  const top = openModals[openModals.length - 1];
  if (top?.closable) {
    top.close(null);
    return true;
  }
  return false;
}

export function hasOpenModal() {
  return openModals.length > 0;
}

/** Ask for confirmation. Resolves { ok, checked } where checked reflects the optional checkbox. */
export function confirmDialog({ title, message, confirmLabel = 'OK', kind = 'primary', checkbox = null, width = 480 }) {
  return new Promise((resolve) => {
    const body = h(`<div>
      <div class="confirm-msg">${message}</div>
      ${checkbox ? `<label class="check-row"><input type="checkbox" ${checkbox.checked ? 'checked' : ''}><span>${esc(checkbox.label)}</span></label>` : ''}
    </div>`);
    let result = { ok: false, checked: !!checkbox?.checked };
    openModal({
      title,
      body,
      width,
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: confirmLabel,
          kind,
          onClick: (m) => {
            result = { ok: true, checked: !!body.querySelector('input')?.checked };
            m.close();
          },
        },
      ],
      onClose: () => resolve(result),
    });
  });
}

// ---------------------------------------------------------------- toasts ---

export function toast(message, kind = 'info', timeout = 4200) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = h('<div class="toasts"></div>');
    document.body.append(host);
  }
  const iconName = kind === 'success' ? 'checkCircle' : kind === 'error' ? 'xCircle' : kind === 'warn' ? 'alert' : 'info';
  const el = h(`<div class="toast toast-${kind}">${icon(iconName, { size: 18 })}<div>${message}</div></div>`);
  host.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

/** Open a folder in Explorer (or show a file in its folder), with a note if it's gone. */
export async function openLocation(p) {
  try {
    const problem = await api.files.openLocation(p);
    if (problem) toast(esc(problem), 'warn', 5000);
  } catch (err) {
    toast(esc(errorMessage(err)), 'error', 5000);
  }
}

// ---------------------------------------------------------- context menu ---

let activeMenu = null;

export function closeMenu() {
  activeMenu?.remove();
  activeMenu = null;
}

/** Show a context menu. items: [{ label, icon, onClick, danger, disabled } | '-'] */
export function showMenu(x, y, items) {
  closeMenu();
  const menu = h('<div class="ctx" role="menu"></div>');
  for (const item of items) {
    if (!item) continue;
    if (item === '-') {
      menu.append(h('<div class="ctx-sep"></div>'));
      continue;
    }
    const el = h(`<div class="ctx-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}">${item.icon ? icon(item.icon, { size: 17 }) : '<span class="ctx-pad"></span>'}<span>${esc(item.label)}</span></div>`);
    if (!item.disabled) {
      el.addEventListener('click', () => {
        closeMenu();
        item.onClick?.();
      });
    }
    menu.append(el);
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
  activeMenu = menu;
}

document.addEventListener('mousedown', (e) => {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
});
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);
