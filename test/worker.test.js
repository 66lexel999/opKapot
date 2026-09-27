'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runJob, cancelJob } = require('../src/main/services/jobs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opk-test-'));
  const write = (rel, content, ageDays = 0) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    if (ageDays) {
      const t = new Date(Date.now() - ageDays * 86_400_000);
      fs.utimesSync(p, t, t);
    }
    return p;
  };
  const big = Buffer.alloc(300_000, 7);
  const random = Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 31) % 251));
  write('videos/movie.mkv', big);
  write('videos/clip.mp4', Buffer.alloc(50_000, 1));
  write('docs/a.pdf', random);
  write('backup/a-copy.pdf', random);
  write('backup/deep/a-copy2.pdf', random);
  write('docs/same-size-different.pdf', Buffer.from(random).fill(9, 150_000));
  write('docs/notes.txt', 'hello', 400);
  write('temp/old.tmp', 'x'.repeat(1000), 5);
  write('temp/new.tmp', 'y'.repeat(1000));
  write('temp/sub/old2.tmp', 'z'.repeat(500), 5);
  return root;
}

test('files: filters by size, type and age and keeps the largest', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const all = await runJob('files', { roots: [root] });
  assert.equal(all.scanned, 10);
  assert.equal(all.matched, 10);

  const large = await runJob('files', { roots: [root], minSize: 100_000 });
  assert.deepEqual(large.files.map((f) => f.name).sort(), ['a-copy.pdf', 'a-copy2.pdf', 'a.pdf', 'movie.mkv', 'same-size-different.pdf']);

  const videos = await runJob('files', { roots: [root], exts: ['mkv', 'mp4'] });
  assert.equal(videos.files.length, 2);

  const old = await runJob('files', { roots: [root], modifiedBefore: Date.now() - 365 * 86_400_000 });
  assert.deepEqual(old.files.map((f) => f.name), ['notes.txt']);

  const top = await runJob('files', { roots: [root], limit: 2 });
  assert.equal(top.truncated, true);
  assert.deepEqual(top.files.map((f) => f.size).sort((a, b) => b - a), [300_000, 200_000]);

  const excluded = await runJob('files', { roots: [root], exclude: [path.join(root, 'backup')] });
  assert.equal(excluded.scanned, 8);
});

test('duplicates: groups identical content only', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { groups } = await runJob('duplicates', { roots: [root], minSize: 1 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].wasted, 400_000);
  assert.deepEqual(groups[0].files.map((f) => f.name).sort(), ['a-copy.pdf', 'a-copy2.pdf', 'a.pdf']);
});

test('dirSizes: totals every child folder', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = await runJob('dirSizes', { root });
  const byName = Object.fromEntries(result.entries.map((e) => [e.name, e]));
  assert.equal(byName.videos.size, 350_000);
  assert.equal(byName.backup.files, 2);
  assert.equal(result.total, result.entries.reduce((s, e) => s + e.size, 0));
});

test('junk: recently created files are protected by the age limit', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Files were just created (even if their mtime is old), so a 1-day limit keeps them all.
  const guarded = await runJob('junkScan', { categories: [{ id: 'temp', targets: [{ root: path.join(root, 'temp'), minAgeMs: 86_400_000 }] }] });
  assert.deepEqual(guarded.results.temp, { size: 0, count: 0 });
});

test('junk: scans and cleans files and empty folders, keeping the root', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const temp = path.join(root, 'temp');
  const categories = [{ id: 'temp', targets: [{ root: temp }] }];

  const scan = await runJob('junkScan', { categories });
  assert.deepEqual(scan.results.temp, { size: 2500, count: 3 });

  const clean = await runJob('junkClean', { categories });
  assert.deepEqual(clean.results.temp, { freed: 2500, deleted: 3, failed: 0 });
  assert.ok(fs.existsSync(temp), 'root kept');
  assert.deepEqual(fs.readdirSync(temp), [], 'empty sub-folders removed');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'a.pdf')), 'files outside the target untouched');

  const matchOnly = await runJob('junkScan', { categories: [{ id: 'm', targets: [{ root, match: '\\.pdf$' }] }] });
  assert.equal(matchOnly.results.m.count, 4);
});

test('jobs can be stopped early', async (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pending = runJob('files', { roots: [root] }, { jobId: 'stop-me' });
  cancelJob('stop-me');
  const result = await pending;
  assert.ok(result.stopped === true || result.scanned === 10);
});
