import { api, esc, h, sortBy, formatNumber, errorMessage, pathLink } from '../../util.js';
import { icon } from '../../icons.js';
import { DataTable } from '../../components/table.js';
import { showMenu } from '../../components/overlay.js';
import { securityStore } from '../../securityStore.js';
import { viewHeader, emptyHtml, loadingHtml, opButtons } from '../common.js';
import { sevPill, appIcon, confirmRun, notSupportedHtml } from './shared.js';

const DIR = { in: ['In', 'Incoming'], out: ['Out', 'Outgoing'], listen: ['Listen', 'Waiting for connections'] };
const FILTERS = [['all', 'All'], ['internet', 'Internet'], ['in', 'Incoming'], ['listen', 'Listening'], ['flagged', 'Flagged'], ['blocked', 'Blocked']];
const RISK = { danger: 0, warning: 1, notice: 2, ok: 3 };

/** Live view of every connection and open port, and which program owns it. */
export class NetworkView {
  constructor() {
    this.rows = [];
    this.filter = 'all';
    this.hideLocal = true;
    this.live = true;
    this.sort = { key: 'risk', dir: 'asc' };
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'See who your PC is talking to.',
        info: 'Every open connection and listening port, with the program that owns it. "Incoming" means another device started the connection.',
        actions: `<label class="check-row live-toggle"><input type="checkbox" data-live checked><span>Live</span></label><button class="btn" data-refresh>${icon('refresh', { size: 16 })}Refresh</button>`,
      })}
      <div class="toolbar">
        <div class="seg" data-filter>${FILTERS.map(([v, l]) => `<button data-v="${v}" class="${v === 'all' ? 'on' : ''}">${l}${v === 'blocked' ? ' <span class="seg-count" data-blocked-count></span>' : ''}</button>`).join('')}</div>
        <label class="check-row" data-local-row><input type="checkbox" data-local checked><span>Hide connections inside this PC</span></label>
        <span class="net-summary muted small"></span>
      </div>
      <div class="panel"></div>
    </div>`);
    this.summary = this.el.querySelector('.net-summary');
    this.table = new DataTable({
      rowHeight: 56,
      selectable: false,
      sort: this.sort,
      emptyHtml: loadingHtml('Reading connections…'),
      columns: [
        { key: 'process', label: (t) => `Program (${t.rows.length})`, width: 'minmax(0, 1.25fr)', sortable: true, render: (r) => `<div class="cell-name">${appIcon(r.path, r.process, 28)}<div class="name-text"><div class="name-title trunc">${esc(r.process)}</div><div class="name-sub trunc" title="${esc(r.path)}">${esc(r.publisher || r.path || `PID ${r.pid}`)}</div></div></div>` },
        { key: 'direction', label: 'Direction', width: '100px', sortable: true, render: (r) => `<span class="dir dir-${r.direction}" title="${esc(DIR[r.direction][1])}">${esc(DIR[r.direction][0])}</span>` },
        { key: 'remote', label: 'Other side', width: 'minmax(0, 1fr)', sortable: true, render: (r) => (r.direction === 'listen' ? `<span class="trunc muted">Port ${r.localPort} · ${esc(r.where)}</span>` : `<div class="name-text"><div class="trunc mono">${esc(r.remoteAddress)}:${r.remotePort}</div><div class="name-sub">${esc(r.where)}${r.direction === 'in' ? ` → port ${r.localPort}` : ''}</div></div>`) },
        { key: 'proto', label: 'Type', width: '76px', sortable: true, render: (r) => `<span class="trunc muted">${r.proto}${r.state && r.state !== 'Listen' && r.state !== 'Established' ? ` · ${esc(r.state)}` : ''}</span>` },
        { key: 'risk', label: 'Risk', width: '180px', sortable: true, render: (r) => (r.risk === 'ok' ? '<span class="muted">—</span>' : `<div class="flags">${sevPill(r.risk, r.flags[0]?.label)}</div>`) },
        { key: 'op', label: 'Action', width: '136px', align: 'center', render: (r) => opButtons([...(r.remoteKind === 'public' ? [['lookup', 'globe', 'Who is this?']] : []), ['block', 'ban', 'Block program'], ['kill', 'close', 'End program']]) },
      ],
      onSort: (s) => {
        this.sort = s;
        this.update();
      },
      onAction: (a, r) => this.act(a, r),
      onContextMenu: (r, e) => showMenu(e.clientX, e.clientY, [
        r.remoteKind === 'public' ? { label: `Look up ${r.remoteAddress}`, icon: 'globe', onClick: () => this.act('lookup', r) } : null,
        r.path ? { label: 'Show program file', icon: 'reveal', onClick: () => api.files.reveal(r.path) } : null,
        { label: 'Copy address', icon: 'copy', onClick: () => api.app.copy(`${r.remoteAddress}:${r.remotePort}`) },
        '-',
        { label: 'Block program from the internet', icon: 'ban', onClick: () => this.act('block', r) },
        { label: 'End program', icon: 'close', danger: true, onClick: () => this.act('kill', r) },
      ]),
    });
    this.blockedTable = new DataTable({
      rowHeight: 58,
      selectable: false,
      emptyHtml: loadingHtml('Reading Windows Firewall…'),
      columns: [
        { key: 'name', label: (t) => `Blocked program (${t.rows.length})`, render: (b) => `<div class="cell-name">${appIcon(b.path, b.name, 28)}<div class="name-text"><div class="name-title trunc">${esc(b.name.replace(/\.exe$/i, ''))}</div><div class="name-sub trunc path-start" title="${esc(b.path)}"><bdi>${b.path ? pathLink(b.path, { file: true }) : 'Program file unknown'}</bdi></div></div></div>` },
        { key: 'dir', label: 'Blocked', width: '220px', render: (b) => `<span class="trunc">${b.inbound && b.outbound ? 'Internet in and out' : b.outbound ? 'Outgoing connections' : 'Incoming connections'}</span>` },
        { key: 'op', label: 'Action', width: '150px', align: 'center', render: () => '<button class="btn btn-sm btn-accent" data-action="unblock">Unblock</button>' },
      ],
      onAction: (_a, b) => this.unblock(b),
    });
    this.blockedTable.el.hidden = true;
    this.el.querySelector('.panel').append(this.blockedTable.el);
    this.el.querySelector('[data-refresh]').addEventListener('click', () => this.load());
    this.el.querySelector('[data-live]').addEventListener('change', (e) => {
      this.live = e.target.checked;
      this.schedule();
    });
    this.el.querySelector('[data-local]').addEventListener('change', (e) => {
      this.hideLocal = e.target.checked;
      this.update();
    });
    this.el.querySelector('[data-filter]').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.filter = b.dataset.v;
      for (const x of this.el.querySelectorAll('[data-filter] button')) x.classList.toggle('on', x === b);
      this.showBlocked(this.filter === 'blocked');
      this.update();
    });
    securityStore.on('icons', () => this.visible && (this.table.refresh(), this.blockedTable.refresh()));
    return this.el;
  }

  onShow() {
    this.visible = true;
    this.load();
    this.loadBlocked();
    this.schedule();
  }

  showBlocked(on) {
    this.table.el.hidden = on;
    this.blockedTable.el.hidden = !on;
    this.el.querySelector('[data-local-row]').hidden = on;
    this.summary.hidden = on;
    if (on) this.loadBlocked();
  }

  async loadBlocked() {
    try {
      this.blocked = await api.security.blocked();
      securityStore.loadIcons(this.blocked.map((b) => b.path));
      this.blockedTable.setEmpty(emptyHtml('No programs are blocked.', 'Programs you block from Network Monitor or Hack Check appear here, so you can unblock them.', 'ban'));
      this.blockedTable.setRows(this.blocked);
      this.el.querySelector('[data-blocked-count]').textContent = this.blocked.length ? String(this.blocked.length) : '';
    } catch (err) {
      this.blockedTable.setEmpty(emptyHtml('Could not read Windows Firewall.', errorMessage(err), 'alert'));
      this.blockedTable.setRows([]);
    }
  }

  async unblock(b) {
    const res = await confirmRun({
      title: `Unblock ${b.name.replace(/\.exe$/i, '')}?`,
      message: `${b.name} will be able to use the internet again.`,
      confirmLabel: 'Unblock',
      run: () => api.security.unblock(b.id),
    });
    if (res?.ok) this.loadBlocked();
  }

  onHide() {
    this.visible = false;
    clearTimeout(this.timer);
  }

  refresh() {
    this.load();
    this.loadBlocked();
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.live && this.visible) this.timer = setTimeout(async () => {
      await this.load(true);
      this.schedule();
    }, 5000);
  }

  async load(quiet = false) {
    if (this.loading) return;
    this.loading = true;
    try {
      const st = securityStore.status || (await api.security.status());
      if (!st.supported) {
        this.table.setEmpty(notSupportedHtml());
        this.table.setRows([]);
        return;
      }
      const res = await api.security.network();
      this.rows = res.rows;
      securityStore.loadIcons(this.rows.map((r) => r.path));
      this.table.setEmpty(emptyHtml('No connections match this filter.', '', 'network'));
      this.update();
    } catch (err) {
      if (!quiet) this.table.setEmpty(emptyHtml('Could not read connections.', errorMessage(err), 'alert'));
    } finally {
      this.loading = false;
    }
  }

  update() {
    let rows = this.rows;
    if (this.hideLocal) rows = rows.filter((r) => r.remoteKind !== 'loopback' && !(r.direction === 'listen' && r.where === 'This PC'));
    if (this.filter === 'internet') rows = rows.filter((r) => r.remoteKind === 'public');
    if (this.filter === 'in') rows = rows.filter((r) => r.direction === 'in');
    if (this.filter === 'listen') rows = rows.filter((r) => r.direction === 'listen');
    if (this.filter === 'flagged') rows = rows.filter((r) => r.risk !== 'ok');
    const getters = {
      process: (r) => r.process, direction: (r) => r.direction, remote: (r) => r.remoteAddress, proto: (r) => r.proto,
      risk: (r) => RISK[r.risk] * 10 + (r.direction === 'in' ? 0 : r.direction === 'out' ? 1 : 2),
    };
    this.table.setRows(sortBy(rows, getters[this.sort.key] || getters.risk, this.sort.dir));
    const inbound = this.rows.filter((r) => r.direction === 'in' && r.remoteKind === 'public').length;
    const flagged = this.rows.filter((r) => r.risk === 'danger' || r.risk === 'warning').length;
    this.summary.innerHTML = `${formatNumber(this.rows.filter((r) => r.direction !== 'listen' && r.remoteKind === 'public').length)} internet connections · ${this.rows.filter((r) => r.direction === 'listen').length} open ports · <span class="${inbound ? 'txt-warn' : ''}">${inbound} incoming from the internet</span>${flagged ? ` · <span class="txt-danger">${flagged} flagged</span>` : ''}`;
  }

  async act(kind, r) {
    if (kind === 'lookup') {
      api.app.openExternal(`https://ipinfo.io/${encodeURIComponent(r.remoteAddress)}`);
      return;
    }
    const block = kind === 'block';
    const browser = /^(msedge|chrome|firefox|brave|opera|vivaldi|iexplore)$/i.test(r.process);
    const res = await confirmRun({
      title: block ? `Block ${r.process}?` : `End ${r.process}?`,
      message: block
        ? `${r.process} will not be able to use the internet or accept connections.${browser ? ' It is a web browser, so no websites will open in it.' : ''} You can undo this any time under Blocked.`
        : `${r.process} will be closed immediately. Unsaved work in it will be lost.`,
      confirmLabel: block ? 'Block' : 'End program',
      kind: 'danger',
      run: () => api.security.networkAction(r.id, block ? 'block' : 'kill'),
    });
    if (res?.ok) {
      this.load();
      if (block) this.loadBlocked();
    }
  }
}
