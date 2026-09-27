import { api, esc, h, formatBytes, plural, errorMessage } from '../util.js';
import { icon } from '../icons.js';
import { openModal, toast } from '../components/overlay.js';
import { appState } from '../store.js';
import { programIcon } from '../views/common.js';

const FINAL = new Set(['removed', 'failed', 'cancelled', 'unconfirmed', 'skipped']);
const STATUS_TEXT = {
  pending: 'Waiting…',
  running: 'Running the uninstaller…',
  waiting: 'Waiting for the uninstaller to finish…',
  removed: 'Removed.',
  failed: 'Failed.',
  cancelled: 'Cancelled.',
  unconfirmed: 'The program may still be installed.',
  skipped: 'Skipped.',
};
const KIND = {
  folder: ['folderFill', 'Folder'],
  file: ['file', 'File'],
  shortcut: ['link', 'Shortcut'],
  registry: ['key', 'Registry key'],
};

function statusIcon(status) {
  if (status === 'running' || status === 'waiting') return '<span class="spin"></span>';
  if (status === 'removed' || status === 'done') return `<span class="st-ok">${icon('checkCircle', { size: 20 })}</span>`;
  if (status === 'failed') return `<span class="st-bad">${icon('xCircle', { size: 20 })}</span>`;
  if (status === 'pending') return '<span class="st-pending"></span>';
  return `<span class="st-warn">${icon('alert', { size: 20 })}</span>`;
}

/**
 * Guided uninstall: confirm → run each uninstaller → scan leftovers → review
 * and delete leftovers → summary. Resolves with the per-program results
 * (empty if the user cancelled before starting).
 */
export function runUninstallFlow(programs, { force = false } = {}) {
  return new Promise((resolve) => new UninstallFlow(programs, force, resolve).start());
}

class UninstallFlow {
  constructor(programs, force, resolve) {
    this.programs = programs;
    this.force = force;
    this.resolve = resolve;
    this.results = [];
    this.leftovers = null;
    this.state = new Map(programs.map((p) => [p.id, { status: 'pending' }]));
  }

  start() {
    const n = this.programs.length;
    this.modal = openModal({
      title: this.force ? `Force remove ${this.programs[0].name}` : n > 1 ? `Uninstall ${n} programs` : `Uninstall ${this.programs[0].name}`,
      width: 640,
      body: this.confirmBody(),
      buttons: [
        { label: 'Cancel', onClick: (m) => m.close() },
        {
          label: this.force ? 'Force remove' : 'Uninstall',
          kind: this.force ? 'danger' : 'primary',
          onClick: () => this.run(),
        },
      ],
      onClose: () => this.resolve(this.results),
    });
  }

  confirmBody() {
    const s = appState.settings;
    const total = this.programs.reduce((sum, p) => sum + (p.size || 0), 0);
    const showRestore = appState.isWindows || appState.info.demo;
    const lead = this.force
      ? 'Force removal deletes the program’s uninstall entry (a registry backup is saved first) without running its uninstaller, then helps you clean up its files. Use it only when the normal uninstaller is broken or missing.'
      : `${n(this.programs.length)} will be removed${total ? ` (about ${formatBytes(total)})` : ''}:`;
    return `<p class="lead">${esc(lead)}</p>
      <div class="mini-list">${this.programs.map((p) => `
        <div class="mini-row">${programIcon(p, 28)}<div class="mini-name trunc">${esc(p.name)}</div><div class="mini-meta">${p.size ? formatBytes(p.size) : ''}</div></div>`).join('')}
      </div>
      <div class="options">
        ${showRestore && !this.force ? option('restorePoint', 'Create a system restore point first', s.restorePoint) : ''}
        ${this.force ? '' : option('scanLeftovers', 'Scan for leftover files and registry entries afterwards', s.scanLeftovers)}
        ${this.force ? '' : option('quietUninstall', 'Uninstall silently when the program supports it', s.quietUninstall)}
      </div>`;

    function n(count) {
      return count > 1 ? `These ${count} programs` : 'This program';
    }
    function option(name, label, checked) {
      return `<label class="check-row"><input type="checkbox" data-opt="${name}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`;
    }
  }

  readOptions() {
    const body = this.modal.body();
    const get = (name, fallback) => {
      const el = body.querySelector(`[data-opt="${name}"]`);
      return el ? el.checked : fallback;
    };
    return {
      restorePoint: get('restorePoint', false),
      scanLeftovers: this.force ? true : get('scanLeftovers', true),
      quietUninstall: get('quietUninstall', false),
    };
  }

  async run() {
    const options = this.readOptions();
    if (!this.force) {
      appState.updateSettings({
        restorePoint: options.restorePoint,
        scanLeftovers: options.scanLeftovers,
        quietUninstall: options.quietUninstall,
      });
    }
    this.restore = options.restorePoint && !this.force ? { status: 'pending' } : null;
    this.modal.setClosable(false);
    this.modal.setTitle(this.force ? 'Removing…' : 'Uninstalling…');
    this.modal.setButtons(this.force ? [] : [{
      id: 'stop',
      label: 'Stop after this program',
      onClick: (m) => {
        api.uninstall.cancel();
        m.button('stop').disabled = true;
      },
    }]);
    this.modal.body().addEventListener('click', (e) => {
      const skip = e.target.closest('[data-skip]');
      if (skip) {
        api.uninstall.skipWait(skip.dataset.skip);
        skip.disabled = true;
      }
    });
    this.renderProgress();

    const off = api.uninstall.onProgress((ev) => {
      if (ev.phase === 'restore-point') this.restore = ev;
      else if (this.state.has(ev.id)) this.state.set(ev.id, { ...this.state.get(ev.id), ...ev });
      this.renderProgress();
    });

    const ids = this.programs.map((p) => p.id);
    try {
      if (this.force) {
        for (const p of this.programs) {
          this.state.set(p.id, { status: 'running', message: 'Removing the uninstall entry…' });
          this.renderProgress();
          let r;
          try {
            const res = await api.programs.removeEntry(p.id);
            r = res.ok ? { status: 'removed', message: 'Entry removed.' } : { status: 'failed', message: res.error };
          } catch (err) {
            r = { status: 'failed', message: errorMessage(err) };
          }
          this.results.push({ id: p.id, ...r });
          this.state.set(p.id, r);
        }
      } else {
        this.results = await api.uninstall.run(ids, { quiet: options.quietUninstall, restorePoint: options.restorePoint });
        for (const r of this.results) this.state.set(r.id, r);
      }
    } catch (err) {
      toast(esc(errorMessage(err)), 'error');
      this.results = ids.map((id) => ({ id, status: 'failed', message: errorMessage(err) }));
      for (const r of this.results) this.state.set(r.id, r);
    } finally {
      off();
    }
    this.renderProgress();

    const removed = this.results.filter((r) => r.status === 'removed').map((r) => r.id);
    if (options.scanLeftovers && removed.length) await this.scanLeftovers(removed);
    else this.showSummary();
  }

  renderProgress() {
    const total = this.programs.length;
    const done = this.programs.filter((p) => FINAL.has(this.state.get(p.id).status)).length;
    const restore = this.restore ? `
      <div class="prog-row">${icon('shield', { size: 26, className: 'prog-ico' })}
        <div class="prog-main"><div class="trunc">System restore point</div>
        <div class="prog-msg trunc">${esc(this.restore.status === 'failed' ? `Skipped: ${this.restore.message || 'could not create one'}` : this.restore.status === 'done' ? 'Created.' : this.restore.status === 'running' ? 'Creating…' : 'Waiting…')}</div></div>
        <div class="prog-state">${statusIcon(this.restore.status === 'failed' ? 'unconfirmed' : this.restore.status)}</div></div>` : '';
    const rows = this.programs.map((p) => {
      const st = this.state.get(p.id);
      return `<div class="prog-row status-${st.status}">${programIcon(p, 28)}
        <div class="prog-main"><div class="trunc">${esc(p.name)}</div><div class="prog-msg trunc">${esc(st.message || STATUS_TEXT[st.status] || '')}</div></div>
        <div class="prog-state">${st.status === 'waiting' ? `<button class="btn btn-sm" data-skip="${esc(p.id)}">Skip waiting</button>` : ''}${statusIcon(st.status)}</div></div>`;
    }).join('');
    this.modal.setBody(`
      <div class="overall"><div class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></div><span>${done} of ${total}</span></div>
      <div class="prog-list">${restore}${rows}</div>`);
  }

  async scanLeftovers(ids) {
    this.modal.setTitle('Scanning for leftovers…');
    this.modal.setButtons([]);
    this.modal.setBody(`<div class="empty-state inline"><span class="spin big"></span><div>Looking for leftover folders, shortcuts and registry entries…</div></div>`);
    let scan;
    try {
      scan = await api.leftovers.scan(ids);
    } catch (err) {
      toast(`Leftover scan failed: ${esc(errorMessage(err))}`, 'error');
      this.showSummary();
      return;
    }
    if (!scan.items.length) {
      this.leftovers = { found: 0, deleted: 0, failed: 0, freed: 0 };
      this.showSummary();
      return;
    }
    if (appState.settings.autoRemoveLeftovers) {
      await this.deleteLeftovers(scan, scan.items.filter((i) => i.checked).map((i) => i.id));
      return;
    }
    this.reviewLeftovers(scan);
  }

  reviewLeftovers(scan) {
    const { items } = scan;
    this.modal.setClosable(false);
    this.modal.setTitle(`Found ${plural(items.length, 'leftover')}`);
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.programName)) groups.set(item.programName, []);
      groups.get(item.programName).push(item);
    }
    const body = h(`<div>
      <p class="lead">These were left behind. Recommended items are ticked; items marked <span class="pill orange">Review</span> may be shared, so check them first.</p>
      <div class="lo-toolbar"><label class="check-row"><input type="checkbox" data-all><span>Select all</span></label><span class="lo-total muted"></span></div>
      <div class="lo-list">${[...groups].map(([name, list]) => `
        <div class="lo-group">${esc(name)}</div>
        ${list.map((i) => `
          <label class="lo-row">
            <input type="checkbox" data-id="${esc(i.id)}" ${i.checked ? 'checked' : ''}>
            ${icon(KIND[i.kind]?.[0] || 'file', { size: 20, className: `lo-ico kind-${i.kind}` })}
            <div class="lo-main"><div class="lo-path trunc selectable" title="${esc(i.path)}">${esc(i.path)}</div>
              <div class="lo-meta">${esc(KIND[i.kind]?.[1] || i.kind)} · ${esc(i.reason || '')}${i.confidence !== 'high' ? ' · <span class="pill orange">Review</span>' : ''}</div></div>
            <div class="lo-size">${i.size != null ? formatBytes(i.size) : ''}</div>
          </label>`).join('')}`).join('')}
      </div></div>`);
    const boxes = [...body.querySelectorAll('input[data-id]')];
    const all = body.querySelector('[data-all]');
    const byId = new Map(items.map((i) => [i.id, i]));
    const selected = () => boxes.filter((b) => b.checked).map((b) => b.dataset.id);
    const update = () => {
      const ids = selected();
      const bytes = ids.reduce((sum, id) => sum + (byId.get(id).size || 0), 0);
      body.querySelector('.lo-total').textContent = `${ids.length} of ${items.length} selected${bytes ? ` · ${formatBytes(bytes)}` : ''}`;
      all.checked = ids.length === items.length;
      all.indeterminate = ids.length > 0 && ids.length < items.length;
      const btn = this.modal.button('delete');
      if (btn) {
        btn.disabled = !ids.length;
        btn.textContent = ids.length ? `Delete ${plural(ids.length, 'item')}${bytes ? ` (${formatBytes(bytes)})` : ''}` : 'Delete';
      }
    };
    body.addEventListener('change', (e) => {
      if (e.target === all) boxes.forEach((b) => { b.checked = all.checked; });
      update();
    });
    this.modal.setBody(body);
    this.modal.setButtons([
      { label: 'Keep all', onClick: () => { this.leftovers = { found: items.length, deleted: 0, failed: 0, freed: 0 }; this.showSummary(); } },
      { id: 'delete', label: 'Delete', kind: 'primary', onClick: () => this.deleteLeftovers(scan, selected()) },
    ]);
    update();
  }

  async deleteLeftovers(scan, ids) {
    this.modal.setTitle('Removing leftovers…');
    this.modal.setButtons([]);
    this.modal.setBody(`<div class="empty-state inline"><span class="spin big"></span><div>Removing ${plural(ids.length, 'item')}…</div></div>`);
    try {
      const permanent = appState.settings.deleteMode === 'permanent';
      const r = await api.leftovers.remove(scan.token, ids, { permanent });
      this.leftovers = { found: scan.items.length, deleted: r.deleted.length, failed: r.failed.length, freed: r.freed, errors: r.failed };
    } catch (err) {
      toast(esc(errorMessage(err)), 'error');
      this.leftovers = { found: scan.items.length, deleted: 0, failed: ids.length, freed: 0 };
    }
    this.showSummary();
  }

  showSummary() {
    const byId = new Map(this.programs.map((p) => [p.id, p]));
    const removed = this.results.filter((r) => r.status === 'removed');
    const problems = this.results.filter((r) => r.status !== 'removed');
    const reboot = this.results.some((r) => r.rebootRequired);
    const freed = removed.reduce((sum, r) => sum + (byId.get(r.id)?.size || 0), 0) + (this.leftovers?.freed || 0);
    const allGood = !problems.length && !this.leftovers?.failed;

    const lines = [];
    if (removed.length) lines.push(['ok', `${this.force ? 'Force removed' : 'Uninstalled'} ${plural(removed.length, 'program')}`]);
    for (const r of problems) lines.push([r.status === 'failed' ? 'bad' : 'warn', `${byId.get(r.id)?.name || 'Program'}: ${r.message || STATUS_TEXT[r.status]}`]);
    if (this.leftovers) {
      if (!this.leftovers.found) lines.push(['ok', 'No leftovers found']);
      else if (this.leftovers.deleted) lines.push(['ok', `Removed ${plural(this.leftovers.deleted, 'leftover item')}${this.leftovers.freed ? ` (${formatBytes(this.leftovers.freed)})` : ''}`]);
      else lines.push(['warn', `Kept ${plural(this.leftovers.found, 'leftover item')}`]);
      if (this.leftovers.failed) lines.push(['bad', `${plural(this.leftovers.failed, 'leftover item')} could not be removed (in use or access denied)`]);
    }
    if (reboot) lines.push(['warn', 'Restart your PC to finish removing some programs.']);

    this.modal.setTitle(allGood ? 'All done' : 'Finished');
    this.modal.setClosable(true);
    this.modal.setBody(`
      <div class="summary-hero ${allGood ? 'good' : 'mixed'}">${icon(allGood ? 'checkCircle' : 'alert', { size: 46 })}
        <div><div class="summary-big">${freed ? `${formatBytes(freed)} freed` : allGood ? 'Done' : 'Finished with issues'}</div>
        <div class="muted">${removed.length ? `${plural(removed.length, 'program')} removed` : 'Nothing was removed'}</div></div></div>
      <ul class="summary-lines">${lines.map(([kind, text]) => `<li class="${kind}">${statusIcon(kind === 'ok' ? 'done' : kind === 'bad' ? 'failed' : 'unconfirmed')}<span>${esc(text)}</span></li>`).join('')}</ul>`);
    this.modal.setButtons([{ label: 'Done', kind: 'primary', onClick: (m) => m.close() }]);
  }
}
