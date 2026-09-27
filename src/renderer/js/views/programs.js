import { api, esc, h, DAY, MB, debounce, formatBytes, formatDate, relativeTime, sortBy, plural } from '../util.js';
import { DataTable } from '../components/table.js';
import { openModal, showMenu } from '../components/overlay.js';
import { appState, programsStore } from '../store.js';
import { viewHeader, searchBox, loadingHtml, emptyHtml, programIcon, nameCell, opButtons, muted } from './common.js';
import { runUninstallFlow } from '../dialogs/uninstall.js';

const MODES = {
  all: {
    title: 'Uninstall programs you no longer need.',
    info: 'Every desktop program registered on this PC. Tick several to uninstall them in one go.',
    columns: ['name', 'size', 'installDate', 'version', 'op'],
    sort: { key: 'name', dir: 'asc' },
    filter: () => true,
    empty: 'No programs found.',
  },
  bundleware: {
    title: 'Uninstall unwanted bundleware.',
    info: 'Programs that were installed together with another program — same publisher, same moment, or inside its folder. Often added without you noticing.',
    columns: ['name', 'size', 'bundleType', 'op'],
    sort: { key: 'name', dir: 'asc' },
    empty: 'No bundleware found. Nice and clean!',
  },
  recent: {
    title: 'Recently installed programs.',
    info: 'Programs installed in the last 30 days, newest first.',
    columns: ['name', 'size', 'installDate', 'version', 'op'],
    sort: { key: 'installDate', dir: 'desc' },
    filter: (p) => p.installDate && Date.now() - p.installDate < 30 * DAY,
    empty: 'Nothing was installed in the last 30 days.',
  },
  large: {
    title: 'Programs taking up the most space.',
    info: 'Programs larger than 100 MB, biggest first.',
    columns: ['name', 'size', 'installDate', 'version', 'op'],
    sort: { key: 'size', dir: 'desc' },
    filter: (p) => (p.size || 0) >= 100 * MB,
    empty: 'No programs larger than 100 MB.',
  },
  infrequent: {
    title: 'Programs you rarely use.',
    info: 'Programs not opened for more than 60 days, based on Windows launch data. Great candidates for removal.',
    columns: ['name', 'size', 'lastUsed', 'installDate', 'op'],
    sort: { key: 'lastUsed', dir: 'asc' },
    filter: (p) => p.lastUsed && Date.now() - p.lastUsed > 60 * DAY,
    needsUsage: true,
    empty: 'No rarely used programs found.',
  },
};

const GETTERS = {
  name: (p) => p.name,
  size: (p) => p.size,
  installDate: (p) => p.installDate,
  version: (p) => p.version,
  lastUsed: (p) => p.lastUsed,
  bundleType: (p) => p._depth,
};

function columnDefs() {
  return {
    name: {
      key: 'name',
      label: (t) => `Name (Total: ${t.rows.length})`,
      sortable: true,
      render: (p) => nameCell(programIcon(p), p.name, p.publisher),
    },
    size: {
      key: 'size', label: 'Size', width: '110px', sortable: true, defaultDir: 'desc',
      render: (p) => (p.size ? `<span class="trunc">${formatBytes(p.size)}</span>` : muted(programsStore.sizesPending && p.installLocation ? '…' : '—')),
    },
    installDate: {
      key: 'installDate', label: 'Installed', width: '145px', sortable: true, defaultDir: 'desc',
      render: (p) => `<span class="trunc">${formatDate(p.installDate)}</span>`,
    },
    version: {
      key: 'version', label: 'Version', width: '150px', sortable: true,
      render: (p) => (p.version ? `<span class="trunc" title="${esc(p.version)}">${esc(p.version)}</span>` : muted('—')),
    },
    lastUsed: {
      key: 'lastUsed', label: 'Last used', width: '155px', sortable: true,
      render: (p) => `<span class="trunc">${relativeTime(p.lastUsed)}</span>`,
    },
    bundleType: {
      key: 'bundleType', label: 'Type', width: '170px', sortable: false,
      render: (p) => `<span class="trunc">${p._depth ? 'Bundled Program' : 'Main Program'}</span>`,
    },
    op: {
      key: 'op', label: 'Operation', width: '120px', align: 'center',
      render: () => opButtons([['uninstall', 'trash', 'Uninstall']]),
    },
  };
}

export class ProgramsView {
  constructor(mode) {
    this.mode = mode;
    this.cfg = MODES[mode];
    this.sort = { ...this.cfg.sort };
    this.query = '';
    this.visible = false;
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: this.cfg.title,
        info: this.cfg.info,
        actions: `${searchBox('Search programs')}<button class="btn btn-big" data-uninstall disabled>Uninstall</button>`,
      })}
      <div class="panel"></div>
    </div>`);

    const defs = columnDefs();
    this.table = new DataTable({
      columns: this.cfg.columns.map((c) => defs[c]),
      rowHeight: 66,
      sort: this.sort,
      isSelectable: (p) => p.canUninstall !== false,
      rowClass: (p) => (p._depth ? 'depth-1' : ''),
      onSort: (sort) => {
        this.sort = sort;
        this.update();
      },
      onSelectionChange: (rows) => this.onSelection(rows),
      onAction: (action, row) => action === 'uninstall' && this.uninstall([row]),
      onContextMenu: (row, e) => this.contextMenu(row, e),
      onDblClick: (row) => this.details(row),
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.button = this.el.querySelector('[data-uninstall]');
    this.summary = this.el.querySelector('.sel-summary');
    this.button.addEventListener('click', () => this.primaryAction());
    this.el.querySelector('input[type=search]').addEventListener('input', debounce((e) => {
      this.query = e.target.value.trim().toLowerCase();
      this.update();
    }, 120));

    programsStore.on('change', () => this.visible && this.update());
    programsStore.on('loading', () => this.visible && this.update());
    programsStore.on('icons', () => this.visible && this.table.refresh());
    appState.on('settings', () => this.visible && this.update());
    return this.el;
  }

  onShow() {
    this.visible = true;
    programsStore.load();
    if (this.cfg.needsUsage) programsStore.loadUsage();
    this.update();
  }

  onHide() {
    this.visible = false;
  }

  refresh() {
    programsStore.load(true);
  }

  focusSearch() {
    this.el.querySelector('input[type=search]').focus();
  }

  selectAll() {
    this.table.selectAll(true);
  }

  primaryAction() {
    const rows = this.table.getSelectedRows();
    if (rows.length) this.uninstall(rows);
  }

  matches(p) {
    if (!this.query) return true;
    return `${p.name} ${p.publisher || ''}`.toLowerCase().includes(this.query);
  }

  visiblePrograms() {
    const showSystem = appState.settings.showSystemComponents;
    return programsStore.programs.filter((p) => showSystem || !p.systemComponent);
  }

  update() {
    const store = programsStore;
    if (!store.loaded) {
      this.table.setEmpty(store.error
        ? emptyHtml('Could not read installed programs.', store.error, 'alert')
        : loadingHtml('Reading installed programs…'));
      this.table.setRows([]);
      return;
    }
    const getter = GETTERS[this.sort.key] || GETTERS.name;
    let rows;
    if (this.mode === 'bundleware') {
      rows = this.bundleRows(getter);
    } else {
      const list = this.visiblePrograms().filter((p) => this.cfg.filter(p) && this.matches(p));
      rows = sortBy(list, getter, this.sort.dir);
    }

    if (this.cfg.needsUsage && store.usageState !== 'done') {
      this.table.setEmpty(loadingHtml('Checking when each program was last used…'));
    } else if (this.query) {
      this.table.setEmpty(emptyHtml(`No programs match “${this.query}”.`, '', 'search'));
    } else if (this.cfg.needsUsage && !appState.isWindows && !appState.info.demo) {
      this.table.setEmpty(emptyHtml('Usage data is only available on Windows.', '', 'info'));
    } else {
      this.table.setEmpty(emptyHtml(this.cfg.empty));
    }
    this.table.setRows(rows);
  }

  bundleRows(getter) {
    const byId = new Map(this.visiblePrograms().map((p) => [p.id, p]));
    let groups = programsStore.bundles
      .map((g) => ({ main: byId.get(g.main), members: g.members.map((id) => byId.get(id)).filter(Boolean) }))
      .filter((g) => g.main && g.members.length);
    if (this.query) groups = groups.filter((g) => [g.main, ...g.members].some((p) => this.matches(p)));
    const dir = this.sort.dir;
    groups = sortBy(groups, (g) => getter(g.main), dir);
    return groups.flatMap((g) => [
      { ...g.main, _depth: 0 },
      ...sortBy(g.members, getter, dir).map((m) => ({ ...m, _depth: 1 })),
    ]);
  }

  onSelection(rows) {
    const n = rows.length;
    const bytes = rows.reduce((sum, p) => sum + (p.size || 0), 0);
    this.summary.textContent = n ? `${plural(n, 'program')} selected${bytes ? ` · ${formatBytes(bytes)}` : ''}` : '';
    this.button.disabled = !n;
    this.button.classList.toggle('btn-primary', n > 0);
    this.button.textContent = n > 1 ? `Uninstall (${n})` : 'Uninstall';
  }

  async uninstall(rows, { force = false } = {}) {
    const programs = rows.map((r) => programsStore.byId.get(r.id) || r);
    const results = await runUninstallFlow(programs, { force });
    if (results?.length) {
      this.table.selectAll(false);
      await programsStore.load(true);
      appState.refreshDrives();
      appState.emit('history');
    }
  }

  contextMenu(row, e) {
    const canForce = row.canRemoveEntry && (appState.isWindows || appState.info.demo);
    showMenu(e.clientX, e.clientY, [
      { label: 'Uninstall', icon: 'trashOutline', onClick: () => this.uninstall([row]) },
      canForce ? { label: 'Force remove…', icon: 'bolt', danger: true, onClick: () => this.uninstall([row], { force: true }) } : null,
      '-',
      { label: 'Open install folder', icon: 'folder', disabled: !row.installLocation, onClick: () => api.programs.openLocation(row.id) },
      { label: 'Search online', icon: 'globe', onClick: () => api.programs.searchOnline(row.id) },
      { label: 'Copy name', icon: 'copy', onClick: () => api.app.copy(row.name) },
      '-',
      { label: 'Properties', icon: 'info', onClick: () => this.details(row) },
    ]);
  }

  details(row) {
    const p = programsStore.byId.get(row.id) || row;
    const fields = [
      ['Publisher', p.publisher],
      ['Version', p.version],
      ['Size', p.size ? formatBytes(p.size) : ''],
      ['Installed', p.installDate ? formatDate(p.installDate) : ''],
      ['Last used', p.lastUsed ? relativeTime(p.lastUsed) : ''],
      ['Location', p.installLocation],
      ['Uninstaller', p.uninstallString],
      ['Silent uninstaller', p.quietUninstallString],
      ['Registry key', p.registryKey],
      ['Package', p.packageName || p.appId || p.bundleId],
      ['Source', p.sourceLabel],
      ['Website', p.website],
      ['Description', p.description],
    ].filter(([, v]) => v);
    const modal = openModal({
      title: p.name,
      width: 640,
      body: `<div class="details-head">${programIcon(p, 44)}<div><div class="details-name">${esc(p.name)}</div><div class="muted">${esc(p.publisher || '')}</div></div></div>
        <dl class="kv">${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="selectable">${esc(v)}</dd>`).join('')}</dl>`,
      buttons: [
        { label: 'Search online', onClick: () => api.programs.searchOnline(p.id) },
        { label: 'Open folder', disabled: !p.installLocation, onClick: () => api.programs.openLocation(p.id) },
        { label: 'Uninstall', kind: 'primary', onClick: () => { modal.close(); this.uninstall([p]); } },
      ],
    });
  }
}
