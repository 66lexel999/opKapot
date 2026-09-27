'use strict';

const { groupBundles } = require('./bundles');
const { createLeftoverScanner } = require('../leftovers');
const { runJob } = require('../jobs');
const registry = require('../../lib/registry');

function platformProvider(trash) {
  if (process.platform === 'win32') return require('./windows');
  if (process.platform === 'darwin') {
    const mac = require('./mac');
    return { ...mac, uninstall: mac.createUninstaller(trash) };
  }
  return require('./linux');
}

async function folderSizes(paths) {
  const { sizes } = await runJob('folderSizes', { paths });
  return sizes;
}

/**
 * Facade over the platform-specific program providers. Keeps the last listing
 * so later calls (uninstall, leftovers, icons) can work from program ids.
 */
class ProgramService {
  constructor({ demoProvider = null, trash }) {
    this.demo = demoProvider;
    this.provider = demoProvider || platformProvider(trash);
    this.cache = new Map();
    this.scanner = createLeftoverScanner({
      folderSizes,
      registry: process.platform === 'win32' ? registry : null,
    });
  }

  async list() {
    const programs = await this.provider.listPrograms();
    // Keep records of programs we just uninstalled so leftovers can still be scanned.
    for (const p of programs) this.cache.set(p.id, p);
    this.current = new Set(programs.map((p) => p.id));
    return programs;
  }

  get(id) {
    return this.cache.get(id) || null;
  }

  installed() {
    return [...this.cache.values()].filter((p) => this.current?.has(p.id));
  }

  bundles() {
    return groupBundles(this.installed());
  }

  /** Measure install folders for programs that don't report a size. */
  async sizes() {
    const missing = this.installed().filter((p) => !p.size && p.installLocation);
    if (!missing.length) return {};
    const sizes = await folderSizes(missing.map((p) => p.installLocation));
    const result = {};
    for (const p of missing) {
      const size = sizes[p.installLocation];
      if (size) {
        p.size = size;
        p.sizeMeasured = true;
        result[p.id] = size;
      }
    }
    return result;
  }

  async usage() {
    const result = await this.provider.usage(this.installed());
    for (const [id, lastUsed] of Object.entries(result)) {
      const p = this.cache.get(id);
      if (p) p.lastUsed = lastUsed;
    }
    return result;
  }

  iconCandidates(id) {
    const p = this.get(id);
    return p ? this.provider.iconCandidates(p) : [];
  }

  uninstall(program, options) {
    return this.provider.uninstall(program, options);
  }

  removeEntry(program, backupDir) {
    if (!this.provider.removeEntry) return { ok: false, error: 'Not supported on this system.' };
    return this.provider.removeEntry(program, backupDir);
  }

  createRestorePoint() {
    if (!this.provider.createRestorePoint) return { ok: false, error: 'Not supported on this system.' };
    return this.provider.createRestorePoint('Before uninstalling with opKapot Uninstaller');
  }

  async leftovers(ids) {
    const targets = ids.map((id) => this.get(id)).filter(Boolean);
    if (this.demo) {
      let n = 0;
      return targets.flatMap((p) => this.demo.leftovers(p).map((item) => ({
        ...item,
        id: `l${n++}`,
        programId: p.id,
        programName: p.name,
        reason: item.reason || `Named after ${p.name}`,
        checked: item.confidence === 'high',
        demo: true,
      })));
    }
    return this.scanner.scan(targets, this.installed());
  }
}

module.exports = { ProgramService };
