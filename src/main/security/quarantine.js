'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { safety } = require('../lib/safety');

const KEY = 0xa7;

// Quarantined files are stored scrambled (XOR) so they can never run or be
// opened by accident, then restored byte-for-byte on request.
function scrambler() {
  return new Transform({
    transform(chunk, _enc, done) {
      const out = Buffer.allocUnsafe(chunk.length);
      for (let i = 0; i < chunk.length; i++) out[i] = chunk[i] ^ KEY;
      done(null, out);
    },
  });
}

class Quarantine {
  constructor(dir) {
    this.dir = dir;
    this.indexFile = path.join(dir, 'index.json');
  }

  list() {
    try {
      return JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
    } catch {
      return [];
    }
  }

  save(list) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(`${this.indexFile}.tmp`, JSON.stringify(list, null, 2));
    fs.renameSync(`${this.indexFile}.tmp`, this.indexFile);
  }

  /** Move a file into quarantine. Throws if the file is protected or in use. */
  async add(file, { threat = '', sha256 = '', engine = '' } = {}) {
    if (safety.isProtectedPath(file)) throw new Error('This file is part of Windows or a protected folder and cannot be quarantined.');
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) throw new Error('Only files can be quarantined.');
    fs.mkdirSync(this.dir, { recursive: true });
    const id = crypto.randomBytes(8).toString('hex');
    const stored = path.join(this.dir, `${id}.qtn`);
    await pipeline(fs.createReadStream(file), scrambler(), fs.createWriteStream(stored));
    try {
      await fs.promises.unlink(file);
    } catch (err) {
      await fs.promises.rm(stored, { force: true });
      throw new Error(err.code === 'EBUSY' || err.code === 'EPERM' ? 'The file is in use. Close the program using it (or restart) and try again.' : err.message);
    }
    const entry = { id, originalPath: file, name: path.basename(file), size: stat.size, sha256, threat, engine, date: Date.now() };
    this.save([entry, ...this.list()]);
    return entry;
  }

  async restore(id) {
    const list = this.list();
    const entry = list.find((e) => e.id === id);
    if (!entry) throw new Error('Item not found in quarantine.');
    let target = entry.originalPath;
    if (fs.existsSync(target)) {
      const ext = path.extname(target);
      target = `${target.slice(0, target.length - ext.length)} (restored)${ext}`;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await pipeline(fs.createReadStream(path.join(this.dir, `${id}.qtn`)), scrambler(), fs.createWriteStream(target, { flags: 'wx' }));
    await fs.promises.rm(path.join(this.dir, `${id}.qtn`), { force: true });
    this.save(list.filter((e) => e.id !== id));
    return { ...entry, restoredTo: target };
  }

  async remove(id) {
    await fs.promises.rm(path.join(this.dir, `${id}.qtn`), { force: true });
    this.save(this.list().filter((e) => e.id !== id));
  }
}

module.exports = { Quarantine };
