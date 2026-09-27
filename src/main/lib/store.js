'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Tiny JSON file store with atomic writes. */
class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.defaults = defaults;
    this.data = structuredClone(defaults);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(defaults)) {
        if (Array.isArray(raw)) this.data = raw;
      } else if (raw && typeof raw === 'object') {
        this.data = { ...this.data, ...raw };
      }
    } catch {
      // First run or unreadable file: keep defaults.
    }
  }

  get() {
    return this.data;
  }

  set(data) {
    this.data = data;
    this.save();
    return this.data;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { JsonStore };
