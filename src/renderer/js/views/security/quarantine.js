import { api, esc, h, formatBytes, formatDateTime, errorMessage } from '../../util.js';
import { DataTable } from '../../components/table.js';
import { confirmDialog, toast } from '../../components/overlay.js';
import { securityStore } from '../../securityStore.js';
import { viewHeader, emptyHtml, loadingHtml, opButtons, nameCell } from '../common.js';
import { icon } from '../../icons.js';

/** Files locked away by opKapot. They are scrambled so they cannot run. */
export class QuarantineView {
  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Files locked away so they can\'t run.',
        info: 'Quarantined files are scrambled and stored safely. Restore a file if it was a false alarm, or delete it for good.',
        actions: '<button class="btn" data-clear disabled>Delete all</button>',
      })}
      <div class="panel"></div>
    </div>`);
    this.clearBtn = this.el.querySelector('[data-clear]');
    this.table = new DataTable({
      rowHeight: 58,
      selectable: false,
      emptyHtml: loadingHtml('Loading…'),
      columns: [
        { key: 'name', label: (t) => `File (${t.rows.length})`, render: (e) => nameCell(`<span class="sev-ico sev-danger">${icon('vault', { size: 24 })}</span>`, e.name, e.originalPath) },
        { key: 'threat', label: 'Reason', width: 'minmax(0, 1fr)', render: (e) => `<span class="trunc">${esc(e.threat || 'Suspicious file')}</span>` },
        { key: 'size', label: 'Size', width: '100px', render: (e) => `<span class="trunc">${formatBytes(e.size)}</span>` },
        { key: 'date', label: 'Quarantined', width: '180px', render: (e) => `<span class="trunc">${formatDateTime(e.date)}</span>` },
        { key: 'op', label: 'Action', width: '120px', align: 'center', render: () => opButtons([['restore', 'undo', 'Restore'], ['delete', 'trash', 'Delete for good']]) },
      ],
      onAction: (a, e) => (a === 'restore' ? this.restore(e) : this.remove([e])),
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.clearBtn.addEventListener('click', () => this.remove(this.items));
    return this.el;
  }

  onShow() {
    this.load();
  }

  refresh() {
    this.load();
  }

  async load() {
    try {
      this.items = await api.security.quarantineList();
      this.table.setEmpty(emptyHtml('Quarantine is empty.', 'Files you quarantine from Virus Scan appear here.', 'vault'));
      this.table.setRows(this.items);
      this.clearBtn.disabled = !this.items.length;
    } catch (err) {
      this.table.setEmpty(emptyHtml('Could not read the quarantine.', errorMessage(err), 'alert'));
    }
  }

  async restore(e) {
    const { ok } = await confirmDialog({
      title: `Restore ${e.name}?`,
      message: `<p>Only restore it if you're sure it's safe. It goes back to:</p><p class="muted small">${esc(e.originalPath)}</p>`,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      const res = await api.security.quarantineRestore(e.id);
      toast(`Restored${res.restoredTo ? ` to ${esc(res.restoredTo)}` : ''}.`, 'success');
    } catch (err) {
      toast(esc(errorMessage(err)), 'error');
    }
    this.load();
    securityStore.loadStatus();
  }

  async remove(items) {
    if (!items?.length) return;
    const { ok } = await confirmDialog({
      title: items.length > 1 ? `Delete ${items.length} files for good?` : `Delete ${items[0].name} for good?`,
      message: '<p>They will be permanently deleted and cannot be restored.</p>',
      confirmLabel: 'Delete',
      kind: 'danger',
    });
    if (!ok) return;
    for (const e of items) {
      try {
        await api.security.quarantineDelete(e.id);
      } catch (err) {
        toast(esc(errorMessage(err)), 'error');
      }
    }
    this.load();
    securityStore.loadStatus();
  }
}
