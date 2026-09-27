import { api, Emitter, errorMessage, uid } from './util.js';

/** Shared state for the Security section: status, Hack Check and virus scans. */
class SecurityStore extends Emitter {
  constructor() {
    super();
    this.status = null;
    this.statusError = null;
    this.statusLoading = null;
    this.audit = { running: false, progress: null, result: null, error: null };
    this.scan = { running: false, jobId: null, type: null, progress: null, result: null, error: null };
    this.icons = new Map();
    api.security.onAlerts(() => this.loadStatus());
  }

  loadStatus() {
    if (this.statusLoading) return this.statusLoading;
    this.statusLoading = (async () => {
      try {
        this.status = await api.security.status();
        this.statusError = null;
      } catch (err) {
        this.statusError = errorMessage(err);
      } finally {
        this.statusLoading = null;
      }
      this.emit('status');
    })();
    return this.statusLoading;
  }

  async runAudit() {
    if (this.audit.running) return;
    const jobId = uid('audit');
    this.audit = { ...this.audit, running: true, progress: { step: 0, text: 'Starting…' }, error: null };
    this.emit('audit');
    const off = api.jobs.onProgress(({ jobId: id, data }) => {
      if (id !== jobId) return;
      this.audit.progress = data;
      this.emit('audit');
    });
    try {
      this.audit.result = await api.security.audit(jobId);
    } catch (err) {
      this.audit.error = errorMessage(err);
    } finally {
      off();
      this.audit.running = false;
      this.emit('audit');
      this.loadStatus();
    }
  }

  async fix(id) {
    const r = this.audit.result;
    const res = await api.security.fix(r.token, id);
    if (res.ok) {
      const f = r.findings.find((x) => x.id === id);
      if (f) f.fixed = true;
      this.emit('audit');
      this.loadStatus();
    }
    return res;
  }

  async ignore(id, on) {
    await api.security.ignore(id, on);
    const f = this.audit.result?.findings.find((x) => x.id === id);
    if (f) f.ignored = on;
    this.emit('audit');
  }

  async runScan(type, path) {
    if (this.scan.running) return;
    const jobId = uid('scan');
    this.scan = { running: true, jobId, type, path, progress: { scanned: 0, flagged: 0, currentDir: '', defender: 'running' }, result: null, error: null, started: Date.now() };
    this.emit('scan');
    const off = api.jobs.onProgress(({ jobId: id, data }) => {
      if (id !== jobId) return;
      this.scan.progress = data;
      this.emit('scan');
    });
    try {
      this.scan.result = await api.security.scan(jobId, { type, path });
    } catch (err) {
      this.scan.error = errorMessage(err);
    } finally {
      off();
      this.scan.running = false;
      this.scan.jobId = null;
      this.emit('scan');
      this.loadStatus();
    }
  }

  async cancelScan() {
    if (this.scan.jobId) await api.security.cancelScan(this.scan.jobId);
  }

  /** Real program icons for file paths (cached). */
  async loadIcons(paths) {
    const want = [...new Set(paths.filter((p) => p && !this.icons.has(p)))];
    for (let i = 0; i < want.length; i += 40) {
      try {
        const batch = await api.sys.fileIcons(want.slice(i, i + 40));
        for (const [p, url] of Object.entries(batch)) this.icons.set(p, url);
      } catch {
        break;
      }
    }
    if (want.length) this.emit('icons');
  }
}

export const securityStore = new SecurityStore();
