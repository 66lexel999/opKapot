import { api, esc, h, formatBytes, formatNumber, formatDateTime, relativeTime, plural, errorMessage, pathLink } from '../../util.js';
import { icon } from '../../icons.js';
import { DataTable } from '../../components/table.js';
import { confirmDialog, openModal, showMenu, toast } from '../../components/overlay.js';
import { appState } from '../../store.js';
import { securityStore } from '../../securityStore.js';
import { viewHeader, emptyHtml, loadingHtml, opButtons } from '../common.js';
import { sevPill, confirmRun } from './shared.js';

const TYPES = [
  ['quick', 'Quick scan', 'rocket', 'Checks where malware lands and hides: Downloads, Desktop, startup folders, temp and app data.', 'Recommended'],
  ['full', 'Full scan', 'disk', 'Every file on every drive. Can take an hour or more.', ''],
  ['custom', 'Custom scan', 'folder', 'Scan a folder or drive you choose.', ''],
];

function duration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Virus scanning with Microsoft Defender + opKapot heuristics. */
export class VirusScanView {
  constructor() {
    this.tab = 'scan';
    this.engines = null;
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Scan your PC for viruses and malware.',
        info: 'Uses Microsoft Defender\'s engine (top-rated in independent tests) plus opKapot\'s own checks for disguised programs, malicious scripts, keyloggers and ransomware.',
        actions: '<div class="seg" data-tab><button data-v="scan" class="on">Scan</button><button data-v="history">Protection history</button></div>',
      })}
      <div class="engines-line"></div>
      <div class="vs-top"></div>
      <div class="vs-result muted"></div>
      <div class="panel"></div>
    </div>`);
    this.top = this.el.querySelector('.vs-top');
    this.enginesEl = this.el.querySelector('.engines-line');
    this.resultLine = this.el.querySelector('.vs-result');
    this.table = new DataTable({
      rowHeight: 60,
      selectable: false,
      emptyHtml: emptyHtml('Choose a scan above.', 'Nothing is removed without asking you.', 'shieldOk'),
      columns: [
        { key: 'name', label: (t) => `Threat (${t.rows.length})`, render: (r) => `<div class="cell-name"><span class="sev-ico sev-${r.severity}">${icon(r.engine.startsWith('Microsoft') ? 'virus' : 'alert', { size: 24 })}</span><div class="name-text"><div class="name-title trunc" title="${esc(r.name)}">${esc(r.name)}</div><div class="name-sub trunc path-start" title="${esc(r.path)}"><bdi>${r.path ? pathLink(r.path, { file: true }) : esc(r.type)}</bdi></div></div></div>` },
        { key: 'severity', label: 'Risk', width: '96px', render: (r) => sevPill(r.severity, { danger: 'High', warning: 'Medium', notice: 'Low' }[r.severity]) },
        { key: 'engine', label: 'Found by', width: '130px', render: (r) => `<span class="trunc" title="${esc(r.engine)}">${r.engine.startsWith('Microsoft') ? 'Defender' : 'opKapot'}</span>` },
        { key: 'status', label: 'Status', width: '132px', render: (r) => `<span class="trunc ${r.active ? 'txt-danger' : 'muted'}">${esc(r.quarantined ? 'Quarantined' : r.ignored ? 'Ignored' : r.status)}</span>` },
        { key: 'time', label: 'When', width: '110px', render: (r) => `<span class="trunc">${r.time ? relativeTime(r.time) : '—'}</span>` },
        { key: 'op', label: 'Action', width: '110px', align: 'center', render: (r) => r.engine.startsWith('Microsoft') ? opButtons([['details', 'info', 'Details']]) : opButtons([['quarantine', 'vault', 'Quarantine'], ['details', 'info', 'Details']]) },
      ],
      onAction: (action, row) => (action === 'quarantine' ? this.quarantine(row) : this.details(row)),
      onDblClick: (row) => this.details(row),
      onContextMenu: (row, e) => showMenu(e.clientX, e.clientY, [
        { label: 'Details', icon: 'info', onClick: () => this.details(row) },
        row.path ? { label: 'Show in folder', icon: 'reveal', onClick: () => api.files.reveal(row.path) } : null,
        row.sha256 ? { label: 'Check on VirusTotal', icon: 'globe', onClick: () => this.virusTotal(row) } : null,
        !row.engine.startsWith('Microsoft') ? { label: 'Quarantine', icon: 'vault', onClick: () => this.quarantine(row) } : null,
      ]),
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.el.querySelector('[data-tab]').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.tab = b.dataset.v;
      for (const x of this.el.querySelectorAll('[data-tab] button')) x.classList.toggle('on', x === b);
      this.render();
    });
    this.top.addEventListener('click', (e) => this.onTopClick(e));
    this.enginesEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'update') this.defender('update');
    });
    securityStore.on('scan', () => this.visible && this.render());
    return this.el;
  }

  async onShow() {
    this.visible = true;
    this.render();
    try {
      this.engines = await api.security.engines();
    } catch {
      this.engines = null;
    }
    this.renderEngines();
  }

  onHide() {
    this.visible = false;
  }

  refresh() {
    this.onShow();
  }

  primaryAction() {
    if (!securityStore.scan.running) securityStore.runScan('quick');
  }

  renderEngines() {
    const e = this.engines;
    if (!e) {
      this.enginesEl.innerHTML = '';
      return;
    }
    const d = e.defender;
    const defText = d.active
      ? `Microsoft Defender <span class="muted">(definitions ${esc(d.signatureVersion || '?')}, ${d.signatureUpdated ? relativeTime(d.signatureUpdated).toLowerCase() : 'unknown age'})</span> <button class="link-btn" data-act="update">Update</button>`
      : `Microsoft Defender <span class="muted">(${esc(d.reason || 'not available')})</span>`;
    this.enginesEl.innerHTML = `<span class="muted">Engines:</span>
      <span class="eng ${d.active ? 'on' : 'off'}"><i></i>${defText}</span>
      <span class="eng on"><i></i>opKapot heuristics</span>
      <span class="eng ${e.virustotal ? 'on' : 'off'}"><i></i>VirusTotal ${e.virustotal ? '' : '<span class="muted">(add a free key in Settings)</span>'}</span>`;
  }

  async onTopClick(e) {
    const start = e.target.closest('[data-scan]');
    if (start) {
      const type = start.dataset.scan;
      let path;
      if (type === 'custom') {
        path = await api.files.pickFolder(appState.info.paths.downloads);
        if (!path) return;
      }
      securityStore.runScan(type, path);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'stop') securityStore.cancelScan();
    if (act === 'remove') this.defender('remove');
    if (act === 'offline') this.defender('offline');
    if (act === 'again') {
      securityStore.scan.result = null;
      this.render();
    }
  }

  async defender(kind) {
    if (kind === 'offline') {
      const { ok } = await confirmDialog({
        title: 'Run Microsoft Defender Offline scan?',
        message: '<p>Your PC will <b>restart</b> and scan before Windows starts, which finds rootkits that hide while Windows is running. It takes about 15 minutes. Save your work first.</p>',
        confirmLabel: 'Restart and scan',
        kind: 'danger',
      });
      if (!ok) return;
    }
    const label = { update: 'Updating virus definitions…', remove: 'Removing threats…', offline: 'Starting offline scan…' }[kind];
    const progress = openModal({ title: label, closable: false, body: '<div class="empty-state inline"><span class="spin big"></span><div>This can take a minute.</div></div>' });
    try {
      await confirmRun({ run: () => api.security.defenderAction(kind) });
    } finally {
      progress.close();
    }
    if (kind === 'update') this.onShow();
    if (kind === 'remove' && securityStore.scan.result) {
      for (const r of securityStore.scan.result.rows) if (r.engine.startsWith('Microsoft')) r.active = false;
      this.render();
    }
  }

  render() {
    const sc = securityStore.scan;
    if (this.tab === 'history') return this.renderHistory();
    this.table.setEmpty(emptyHtml('Choose a scan above.', 'Nothing is removed without asking you.', 'shieldOk'));
    if (sc.running) {
      const p = sc.progress || {};
      const def = { running: 'Microsoft Defender is scanning…', done: 'Microsoft Defender finished', failed: 'Microsoft Defender could not scan', unavailable: 'Microsoft Defender not used' }[p.defender] || '';
      this.top.innerHTML = `<div class="scan-live">
        <div class="scan-ring spinning">${icon('virus', { size: 44 })}</div>
        <div class="scan-live-text">
          <div class="scan-title">${esc(TYPES.find((t) => t[0] === sc.type)?.[1] || 'Scan')} in progress…</div>
          <div class="scan-stats"><b>${formatNumber(p.scanned || 0)}</b> files checked · <b class="${p.flagged ? 'txt-danger' : ''}">${formatNumber(p.flagged || 0)}</b> suspicious · ${duration(p.elapsed || Date.now() - sc.started)}</div>
          <div class="muted small trunc path-start" title="${esc(p.currentDir || '')}"><bdi>${esc(p.currentDir || 'Starting…')}</bdi></div>
          <div class="muted small">${p.defender === 'running' ? '<span class="spin tiny"></span> ' : ''}${esc(def)}</div>
        </div>
        <button class="btn btn-stop" data-act="stop">${icon('stop', { size: 16 })}Stop</button>
      </div>`;
      this.resultLine.textContent = '';
      this.table.setRows([]);
      this.table.setEmpty(loadingHtml('Scanning…'));
      return;
    }
    if (sc.result) {
      const r = sc.result;
      const active = r.rows.filter((x) => x.active && !x.ignored && !x.quarantined);
      const defenderActive = active.some((x) => x.engine.startsWith('Microsoft'));
      const clean = !active.length;
      this.top.innerHTML = `<div class="scan-done ${clean ? 'sec-ok' : 'sec-danger'}">
        <div class="scan-ring">${icon(clean ? 'shieldOk' : 'shieldAlert', { size: 44 })}</div>
        <div class="scan-live-text">
          <div class="scan-title">${clean ? 'No threats found' : `${plural(active.length, 'threat')} found`}</div>
          <div class="muted">${r.stopped ? 'Stopped early. ' : ''}${formatNumber(r.scanned)} files checked in ${duration(r.durationMs)}${r.defender?.ran ? ' · Microsoft Defender + opKapot' : ' · opKapot heuristics'}${r.defender?.error ? ` · Defender: ${esc(r.defender.error)}` : ''}</div>
        </div>
        <div class="scan-done-actions">
          ${defenderActive ? '<button class="btn btn-danger" data-act="remove">Remove Defender threats</button>' : ''}
          <button class="btn" data-act="again">New scan</button>
        </div>
      </div>`;
      this.resultLine.textContent = active.length ? 'Double-click a result for details. Quarantine locks a file away safely; you can restore it later.' : '';
      this.table.setEmpty(emptyHtml('Your PC looks clean.', 'Nothing suspicious was found in the places we checked.', 'shieldOk'));
      this.table.setRows(r.rows);
      return;
    }
    if (sc.error) toast(esc(sc.error), 'error');
    this.top.innerHTML = `<div class="scan-types">${TYPES.map(([id, title, ic, desc, badge]) => `
      <div class="scan-type" data-scan="${id}">
        <div class="scan-type-ico">${icon(ic, { size: 26 })}</div>
        <div class="scan-type-title">${esc(title)}${badge ? ` <span class="pill green">${esc(badge)}</span>` : ''}</div>
        <div class="muted small">${esc(desc)}</div>
        <button class="btn ${id === 'quick' ? 'btn-primary' : 'btn-accent'}">Start</button>
      </div>`).join('')}
    </div>
    <div class="offline-link">${icon('shieldAlert', { size: 16 })} Worried about a rootkit? <button class="link-btn" data-act="offline">Run Microsoft Defender Offline scan</button> (restarts your PC).</div>`;
    this.resultLine.textContent = '';
    this.table.setRows([]);
  }

  async renderHistory() {
    this.top.innerHTML = '<div class="muted small">Everything Microsoft Defender has found on this PC, including files it already removed.</div>';
    this.resultLine.textContent = '';
    this.table.setEmpty(loadingHtml('Loading protection history…'));
    this.table.setRows([]);
    try {
      const rows = await api.security.defenderHistory();
      if (this.tab !== 'history') return;
      this.table.setEmpty(emptyHtml('No threats have been found on this PC.', '', 'shieldOk'));
      this.table.setRows(rows);
    } catch (err) {
      this.table.setEmpty(emptyHtml('Could not read Microsoft Defender history.', errorMessage(err), 'alert'));
    }
  }

  async quarantine(row) {
    const { ok, checked } = await confirmDialog({
      title: `Quarantine ${row.path.split(/[\\/]/).pop()}?`,
      message: `<p>The file is moved into opKapot's quarantine and scrambled so it can't run. You can restore it later from Quarantine.</p><p class="muted small">${esc(row.path)}</p>`,
      confirmLabel: 'Quarantine',
      kind: 'danger',
      checkbox: { label: 'Close the program first if it is running', checked: true },
    });
    if (!ok) return;
    try {
      await api.security.quarantine(row.id, { killFirst: checked });
      row.quarantined = true;
      row.active = false;
      toast('File quarantined.', 'success');
      this.table.refresh();
      this.render();
      securityStore.loadStatus();
    } catch (err) {
      toast(esc(errorMessage(err)), 'error', 8000);
    }
  }

  async virusTotal(row, target) {
    const out = target || toastTarget();
    out.innerHTML = '<span class="spin tiny"></span> Asking VirusTotal…';
    try {
      const r = await api.security.virusTotal(row.sha256);
      if (!r.found) out.innerHTML = `${icon('info', { size: 15 })} VirusTotal has never seen this file. That's common for new or personal files, but be careful with programs.`;
      else {
        const bad = r.malicious + r.suspicious;
        out.innerHTML = `${icon(bad ? 'shieldAlert' : 'shieldOk', { size: 15 })} <b class="${bad ? 'txt-danger' : 'txt-ok'}">${bad} of ${r.total}</b> antivirus engines flag this file${r.label ? ` as <b>${esc(r.label)}</b>` : ''}.${r.demo ? ' <span class="muted">(demo result)</span>' : ''}`;
      }
    } catch (err) {
      out.innerHTML = `${icon('alert', { size: 15 })} ${esc(errorMessage(err))}`;
    }
  }

  details(row) {
    const body = h(`<div>
      <div class="finding-head"><span class="sev-ico sev-${row.severity}">${icon('virus', { size: 28 })}</span><div><div class="details-name">${esc(row.name)}</div><div class="muted small">${esc(row.type || '')} · found by ${esc(row.engine)}</div></div></div>
      ${row.meaning ? `<p class="finding-summary">${esc(row.meaning)}</p>` : ''}
      ${row.hits?.length > 1 || (row.hits?.length && row.engine.startsWith('Microsoft')) ? `<ul class="hit-list">${row.hits.map((x) => `<li><b>${esc(x.title)}</b>${x.why ? ` · ${esc(x.why)}` : ''}</li>`).join('')}</ul>` : ''}
      <dl class="kv">
        <dt>File</dt><dd class="selectable">${row.path ? pathLink(row.path, { file: true }) : '—'}</dd>
        ${row.size ? `<dt>Size</dt><dd>${formatBytes(row.size)}</dd>` : ''}
        <dt>Status</dt><dd>${esc(row.quarantined ? 'Quarantined' : row.status)}</dd>
        ${row.time ? `<dt>Date</dt><dd>${formatDateTime(row.time)}</dd>` : ''}
        ${row.origin?.url ? `<dt>Downloaded from</dt><dd class="selectable">${esc(row.origin.url)}</dd>` : ''}
        ${row.sha256 ? `<dt>SHA-256</dt><dd class="selectable mono">${esc(row.sha256)}</dd>` : ''}
      </dl>
      <div class="vt-result"></div>
    </div>`);
    const canQuarantine = !row.engine.startsWith('Microsoft') && !row.quarantined;
    openModal({
      title: 'Threat details',
      width: 660,
      body,
      buttons: [
        row.path ? { label: 'Show in folder', onClick: () => api.files.reveal(row.path) } : null,
        row.sha256 ? { label: 'Check on VirusTotal', onClick: () => this.virusTotal(row, body.querySelector('.vt-result')) } : null,
        !row.engine.startsWith('Microsoft') ? { label: row.ignored ? 'Stop ignoring' : 'Ignore', onClick: async (m) => { await api.security.ignoreFile(row.id, !row.ignored); row.ignored = !row.ignored; m.close(); this.render(); } } : null,
        canQuarantine ? { label: 'Quarantine', kind: 'danger', onClick: (m) => { m.close(); this.quarantine(row); } } : null,
        { label: 'Close', onClick: (m) => m.close() },
      ].filter(Boolean),
    });
  }
}

function toastTarget() {
  const el = document.createElement('div');
  toast('<span class="vt-inline"></span>', 'info', 9000);
  const spans = document.querySelectorAll('.vt-inline');
  return spans[spans.length - 1] || el;
}
