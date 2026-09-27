'use strict';

// Runs heavy filesystem work off the main process. Every task is synchronous
// (fast on huge trees) and checks a shared stop flag so scans can be stopped
// early while still returning what they found so far.

const { parentPort, workerData, isMainThread } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const IS_WIN = process.platform === 'win32';
const fold = IS_WIN ? (p) => p.toLowerCase() : (p) => p;

let stopFlag = null;
const isStopped = () => stopFlag !== null && Atomics.load(stopFlag, 0) === 1;

let lastProgressAt = 0;
function progress(data, force = false) {
  if (!parentPort) return;
  const now = Date.now();
  if (!force && now - lastProgressAt < 150) return;
  lastProgressAt = now;
  parentPort.postMessage({ type: 'progress', data });
}

function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Iterative directory walk. Symlinks and junctions are skipped so we never
 * loop or count the same data twice. Returns false if stopped early.
 */
function walk(root, { onFile, onDir, exclude, skipHidden = false, recursive = true }) {
  const excluded = new Set((exclude || []).map((d) => fold(path.resolve(d))));
  const stack = [root];
  while (stack.length) {
    if (isStopped()) return false;
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (onDir) onDir(dir);
    for (const entry of entries) {
      const name = entry.name;
      if (skipHidden && name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        if (recursive && !excluded.has(fold(full))) stack.push(full);
      } else if (entry.isFile()) {
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        onFile(full, stat, name);
      }
    }
  }
  return true;
}

/** Min-heap used to keep only the N largest files of a huge scan. */
class MinHeap {
  constructor(score) {
    this.items = [];
    this.score = score;
  }

  get size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.score(a[parent]) <= this.score(a[i])) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  replaceTop(item) {
    const a = this.items;
    a[0] = item;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < a.length && this.score(a[l]) < this.score(a[m])) m = l;
      if (r < a.length && this.score(a[r]) < this.score(a[m])) m = r;
      if (m === i) break;
      [a[m], a[i]] = [a[i], a[m]];
      i = m;
    }
  }
}

// ---------------------------------------------------------------- files ---

function taskFiles({
  roots, minSize = 0, maxSize = null, exts = null, excludeExts = null,
  modifiedBefore = null, modifiedAfter = null, exclude = [], skipHidden = false, limit = 100_000,
}) {
  const include = exts?.length ? new Set(exts) : null;
  const skipExt = excludeExts?.length ? new Set(excludeExts) : null;
  const heap = new MinHeap((f) => f.size);
  let scanned = 0;
  let matched = 0;
  let matchedBytes = 0;

  for (const root of roots) {
    const finished = walk(root, {
      exclude,
      skipHidden,
      onDir: (dir) => progress({ scanned, matched, matchedBytes, currentDir: dir }),
      onFile: (full, stat, name) => {
        scanned++;
        const size = stat.size;
        if (size < minSize || (maxSize != null && size > maxSize)) return;
        const mtime = stat.mtimeMs;
        if (modifiedBefore != null && mtime > modifiedBefore) return;
        if (modifiedAfter != null && mtime < modifiedAfter) return;
        const ext = extOf(name);
        if (include && !include.has(ext)) return;
        if (skipExt && skipExt.has(ext)) return;
        matched++;
        matchedBytes += size;
        const item = { path: full, name, size, mtime, ext };
        if (heap.size < limit) heap.push(item);
        else if (size > heap.peek().size) heap.replaceTop(item);
      },
    });
    if (!finished) break;
  }
  progress({ scanned, matched, matchedBytes, currentDir: '' }, true);
  return { files: heap.items, scanned, matched, matchedBytes, truncated: matched > limit, stopped: isStopped() };
}

// ----------------------------------------------------------- duplicates ---

const PARTIAL = 64 * 1024;
const readBuffer = Buffer.allocUnsafe(1024 * 1024);

function hashFile(file, size, full, onBytes) {
  const hash = crypto.createHash('sha1');
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    if (!full && size > PARTIAL * 2) {
      // Head + tail is enough to rule out most non-duplicates cheaply.
      const head = fs.readSync(fd, readBuffer, 0, PARTIAL, 0);
      hash.update(readBuffer.subarray(0, head));
      const tail = fs.readSync(fd, readBuffer, 0, PARTIAL, size - PARTIAL);
      hash.update(readBuffer.subarray(0, tail));
      onBytes(head + tail);
    } else {
      let pos = 0;
      while (pos < size) {
        if (isStopped()) return null;
        const n = fs.readSync(fd, readBuffer, 0, readBuffer.length, pos);
        if (n <= 0) break;
        hash.update(readBuffer.subarray(0, n));
        pos += n;
        onBytes(n);
      }
    }
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function regroup(groups, keyFn) {
  const out = [];
  for (const group of groups) {
    const byKey = new Map();
    for (const file of group) {
      if (isStopped()) return out;
      const k = keyFn(file);
      if (k == null) continue;
      const list = byKey.get(k);
      if (list) list.push(file);
      else byKey.set(k, [file]);
    }
    for (const list of byKey.values()) if (list.length > 1) out.push(list);
  }
  return out;
}

function taskDuplicates({ roots, minSize = 1, exts = null, exclude = [], skipHidden = false }) {
  const include = exts?.length ? new Set(exts) : null;
  const bySize = new Map();
  const seenInodes = new Set();
  let scanned = 0;

  for (const root of roots) {
    const finished = walk(root, {
      exclude,
      skipHidden,
      onDir: (dir) => progress({ phase: 'scan', scanned, currentDir: dir }),
      onFile: (full, stat, name) => {
        scanned++;
        const size = stat.size;
        if (size < Math.max(1, minSize)) return;
        if (include && !include.has(extOf(name))) return;
        if (!IS_WIN && stat.ino) {
          // Hard links share data; they are not wasted space.
          const id = `${stat.dev}:${stat.ino}`;
          if (seenInodes.has(id)) return;
          seenInodes.add(id);
        }
        const file = { path: full, name, size, mtime: stat.mtimeMs };
        const list = bySize.get(size);
        if (list) list.push(file);
        else bySize.set(size, [file]);
      },
    });
    if (!finished) return { groups: [], scanned, stopped: true };
  }

  const sameSize = [...bySize.values()].filter((g) => g.length > 1);
  const candidates = sameSize.reduce((n, g) => n + g.length, 0);
  let hashedFiles = 0;
  let hashedBytes = 0;
  const onBytes = (n) => {
    hashedBytes += n;
    progress({ phase: 'hash', scanned, candidates, hashedFiles, hashedBytes });
  };

  const partialGroups = regroup(sameSize, (f) => {
    hashedFiles++;
    return hashFile(f.path, f.size, false, onBytes);
  });

  const finalGroups = [];
  const needFull = [];
  for (const group of partialGroups) {
    if (group[0].size <= PARTIAL * 2) finalGroups.push(group);
    else needFull.push(group);
  }
  finalGroups.push(...regroup(needFull, (f) => hashFile(f.path, f.size, true, onBytes)));

  const groups = finalGroups
    .map((files, i) => ({
      id: `g${i}`,
      size: files[0].size,
      count: files.length,
      wasted: files[0].size * (files.length - 1),
      files: files.sort((a, b) => a.mtime - b.mtime),
    }))
    .sort((a, b) => b.wasted - a.wasted);

  progress({ phase: 'done', scanned, candidates, hashedFiles, hashedBytes }, true);
  return { groups, scanned, stopped: isStopped() };
}

// ---------------------------------------------------------- folder sizes ---

function sizeOfTree(dir, onTick) {
  let size = 0;
  let files = 0;
  let latest = 0;
  walk(dir, {
    onFile: (_full, stat) => {
      size += stat.size;
      files++;
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
      if (onTick && (files & 1023) === 0) onTick(size, files);
    },
  });
  return { size, files, latest };
}

function taskDirSizes({ root }) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot open ${root} (${err.code || err.message})`);
  }
  const dirCount = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink()).length;
  const out = [];
  let total = 0;
  let done = 0;

  for (const entry of entries) {
    if (isStopped()) break;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      progress({ current: full, done, total: dirCount }, true);
      const tree = sizeOfTree(full, (size) => progress({ current: full, done, total: dirCount, size }));
      let mtime = tree.latest;
      try {
        mtime = Math.max(mtime, fs.statSync(full).mtimeMs);
      } catch { /* ignore */ }
      out.push({ name: entry.name, path: full, isDir: true, size: tree.size, files: tree.files, mtime });
      total += tree.size;
      done++;
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(full);
        out.push({ name: entry.name, path: full, isDir: false, size: stat.size, files: 1, mtime: stat.mtimeMs });
        total += stat.size;
      } catch { /* ignore */ }
    }
  }
  return { root, entries: out, total, stopped: isStopped() };
}

function taskFolderSizes({ paths }) {
  const sizes = {};
  let done = 0;
  for (const dir of paths) {
    if (isStopped()) break;
    progress({ current: dir, done, total: paths.length });
    try {
      if (fs.statSync(dir).isDirectory()) sizes[dir] = sizeOfTree(dir).size;
    } catch { /* missing folder */ }
    done++;
  }
  return { sizes };
}

// ----------------------------------------------------------------- junk ---

function forEachJunkFile(target, onFile, onDir) {
  const now = Date.now();
  const re = target.match ? new RegExp(target.match, 'i') : null;
  const uid = target.ownedOnly && typeof process.getuid === 'function' ? process.getuid() : null;
  const minAge = target.minAgeMs || 0;
  const accept = (stat, name) => {
    if (re && !re.test(name)) return false;
    if (minAge && now - Math.max(stat.mtimeMs, stat.birthtimeMs || 0) < minAge) return false;
    if (uid !== null && stat.uid !== uid) return false;
    return true;
  };

  if (target.file) {
    try {
      const stat = fs.statSync(target.file);
      if (stat.isFile() && accept(stat, path.basename(target.file))) onFile(target.file, stat);
    } catch { /* missing */ }
    return;
  }
  walk(target.root, {
    exclude: target.exclude,
    recursive: target.recursive !== false,
    onDir,
    onFile: (full, stat, name) => {
      if (accept(stat, name)) onFile(full, stat);
    },
  });
}

function taskJunkScan({ categories }) {
  const results = {};
  for (const category of categories) {
    if (isStopped()) break;
    let size = 0;
    let count = 0;
    progress({ category: category.id, size, count }, true);
    for (const target of category.targets) {
      forEachJunkFile(target, (_file, stat) => {
        size += stat.size;
        count++;
        progress({ category: category.id, size, count });
      });
    }
    results[category.id] = { size, count };
  }
  return { results, stopped: isStopped() };
}

function taskJunkClean({ categories }) {
  const results = {};
  for (const category of categories) {
    if (isStopped()) break;
    let freed = 0;
    let deleted = 0;
    let failed = 0;
    progress({ category: category.id, freed, deleted }, true);
    for (const target of category.targets) {
      const dirs = [];
      const collectDirs = target.file || target.match ? undefined : (dir) => {
        try {
          dirs.push({ dir, mtime: fs.statSync(dir).mtimeMs });
        } catch { /* ignore */ }
      };
      forEachJunkFile(target, (file, stat) => {
        try {
          fs.unlinkSync(file);
          freed += stat.size;
          deleted++;
        } catch {
          failed++; // in use or access denied
        }
        progress({ category: category.id, freed, deleted });
      }, collectDirs);

      // Remove folders left empty, deepest first, but never the target root.
      const root = target.root ? fold(path.resolve(target.root)) : null;
      const now = Date.now();
      dirs.sort((a, b) => b.dir.length - a.dir.length);
      for (const { dir, mtime } of dirs) {
        if (fold(path.resolve(dir)) === root) continue;
        if (target.minAgeMs && now - mtime < target.minAgeMs) continue;
        try {
          fs.rmdirSync(dir);
        } catch { /* not empty or in use */ }
      }
    }
    results[category.id] = { freed, deleted, failed };
  }
  return { results, stopped: isStopped() };
}

// ------------------------------------------------------------ malware ---

const heur = require('./heuristics');

const SKIP_DIRS = new Set(['node_modules', '.git', 'winsxs', 'system volume information', '$recycle.bin', 'windows.old', '$windows.~bt']);
const CONTENT_EXT = new Set([...heur.SCRIPT, ...heur.MACRO_DOCS, 'lnk', 'url', 'reg', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt',
  'rtf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'mp3', 'mp4', 'avi', 'mkv', 'mov', 'wav', 'csv', 'odt', 'html', 'htm', 'com', 'exe', 'bin', '']);

function readBytes(file, n) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(n);
    const got = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
}

function readZone(file) {
  if (!IS_WIN) return null;
  try {
    return heur.parseZone(fs.readFileSync(`${file}:Zone.Identifier`, 'utf8'));
  } catch {
    return null;
  }
}

function sha256File(file, size) {
  if (size > 200 * 1024 * 1024) return null;
  const hash = crypto.createHash('sha256');
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    let pos = 0;
    while (pos < size) {
      const n = fs.readSync(fd, readBuffer, 0, readBuffer.length, pos);
      if (n <= 0) break;
      hash.update(readBuffer.subarray(0, n));
      pos += n;
    }
    return hash.digest('hex');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Heuristic malware scan. roots: [{ path, depth }] where depth 0 means only
 * the files directly inside the folder.
 */
function taskMalwareScan({ roots, exclude = [], limit = 5000 }) {
  const excluded = new Set(exclude.map((d) => fold(path.resolve(d))));
  const seen = roots.length > 1 ? new Set() : null;
  const findings = [];
  let scanned = 0;

  for (const r of roots) {
    const root = typeof r === 'string' ? r : r.path;
    const maxDepth = typeof r === 'object' && r.depth != null ? r.depth : Infinity;
    const stack = [[root, 0]];
    while (stack.length && !isStopped()) {
      const [dir, depth] = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      progress({ scanned, flagged: findings.length, currentDir: dir });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < maxDepth && !SKIP_DIRS.has(entry.name.toLowerCase()) && !excluded.has(fold(full))) stack.push([full, depth + 1]);
          continue;
        }
        if (!entry.isFile()) continue;
        if (seen) {
          const key = fold(full);
          if (seen.has(key)) continue;
          seen.add(key);
        }
        scanned++;
        if ((scanned & 511) === 0) progress({ scanned, flagged: findings.length, currentDir: dir });
        const hits = heur.nameHits(full);
        let stat = null;
        if (hits.length || CONTENT_EXT.has(heur.extOf(entry.name))) {
          try {
            stat = fs.statSync(full);
          } catch {
            continue;
          }
          const plan = heur.contentPlan(full, stat.size);
          if (plan) {
            try {
              if (plan.bytes) hits.push(...heur.contentHits(full, readBytes(full, plan.bytes), plan.checks));
            } catch { /* locked or unreadable */ }
            if (plan.checks.includes('macro')) {
              const zone = readZone(full);
              if (zone && zone.zone >= 3) hits.push({ id: 'macro-doc', severity: 'medium', title: 'Downloaded document with macros', why: 'Macros in downloaded Office files are a top way malware gets in. Only enable them if you trust the sender.' });
            }
          }
        }
        if (!hits.length) continue;
        if (!stat) {
          try {
            stat = fs.statSync(full);
          } catch {
            continue;
          }
        }
        findings.push({
          path: full,
          name: entry.name,
          size: stat.size,
          mtime: stat.mtimeMs,
          severity: heur.severityOf(hits),
          hits,
          origin: readZone(full),
          sha256: sha256File(full, stat.size),
        });
        if (findings.length >= limit) break;
      }
      if (findings.length >= limit) break;
    }
  }
  progress({ scanned, flagged: findings.length, currentDir: '' }, true);
  return { findings, scanned, stopped: isStopped() };
}

const TASKS = {
  malwareScan: taskMalwareScan,
  files: taskFiles,
  duplicates: taskDuplicates,
  dirSizes: taskDirSizes,
  folderSizes: taskFolderSizes,
  junkScan: taskJunkScan,
  junkClean: taskJunkClean,
};

if (!isMainThread && parentPort && workerData) {
  stopFlag = workerData.stop ? new Int32Array(workerData.stop) : null;
  try {
    const task = TASKS[workerData.task];
    if (!task) throw new Error(`Unknown task: ${workerData.task}`);
    parentPort.postMessage({ type: 'done', result: task(workerData.params || {}) });
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: err.message });
  }
}
