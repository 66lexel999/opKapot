import { api, Emitter, errorMessage } from './util.js';

/** Shared program list used by every "Programs" view. */
class ProgramsStore extends Emitter {
  constructor() {
    super();
    this.programs = [];
    this.bundles = [];
    this.byId = new Map();
    this.icons = new Map();
    this.loaded = false;
    this.loading = null;
    this.error = null;
    this.usageState = 'idle'; // idle | loading | done
    this.sizesPending = false;
  }

  load(force = false) {
    if (this.loading) return this.loading;
    if (this.loaded && !force) return Promise.resolve();
    this.emit('loading');
    this.loading = (async () => {
      try {
        const { programs, bundles } = await api.programs.list();
        this.programs = programs;
        this.bundles = bundles;
        this.byId = new Map(programs.map((p) => [p.id, p]));
        this.loaded = true;
        this.error = null;
        if (this.usageState === 'done') this.usageState = 'idle';
      } catch (err) {
        this.error = errorMessage(err);
      } finally {
        this.loading = null;
      }
      this.emit('change');
      if (!this.error) this.loadExtras();
    })();
    return this.loading;
  }

  async loadExtras() {
    this.sizesPending = true;
    api.programs.sizes().then((sizes) => {
      this.sizesPending = false;
      for (const [id, size] of Object.entries(sizes || {})) {
        const p = this.byId.get(id);
        if (p) p.size = size;
      }
      this.emit('change');
    }).catch(() => {
      this.sizesPending = false;
    });

    const ids = this.programs.map((p) => p.id).filter((id) => !this.icons.has(id));
    for (let i = 0; i < ids.length; i += 24) {
      try {
        const batch = await api.programs.icons(ids.slice(i, i + 24));
        for (const [id, url] of Object.entries(batch)) this.icons.set(id, url);
        this.emit('icons');
      } catch {
        break;
      }
    }
  }

  async loadUsage() {
    if (this.usageState !== 'idle') return;
    this.usageState = 'loading';
    this.emit('change');
    try {
      const usage = await api.programs.usage();
      for (const [id, lastUsed] of Object.entries(usage || {})) {
        const p = this.byId.get(id);
        if (p) p.lastUsed = lastUsed;
      }
    } catch { /* usage is best-effort */ }
    this.usageState = 'done';
    this.emit('change');
  }
}

export const programsStore = new ProgramsStore();

/** App-wide state: platform info, settings and drives. */
export const appState = new (class extends Emitter {
  constructor() {
    super();
    this.info = { platform: 'win32', paths: {} };
    this.settings = {};
    this.drives = [];
  }

  async init() {
    [this.info, this.settings] = await Promise.all([api.app.info(), api.settings.get()]);
    await this.refreshDrives();
  }

  async refreshDrives() {
    try {
      this.drives = await api.sys.drives();
    } catch {
      this.drives = [];
    }
    this.emit('drives');
  }

  async updateSettings(patch) {
    this.settings = await api.settings.set(patch);
    this.emit('settings', this.settings);
  }

  get isWindows() {
    return this.info.platform === 'win32';
  }

  get systemDrive() {
    return this.drives.find((d) => d.system) || this.drives[0] || null;
  }
})();
