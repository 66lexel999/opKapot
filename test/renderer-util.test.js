'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('renderer helpers', async () => {
  const { formatBytes, sortBy, relativeTime, errorMessage, dirname } = await import('../src/renderer/js/util.js');
  const { typeOf, typeFilter, typeLabel } = await import('../src/renderer/js/fileTypes.js');

  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1.5 * 1024 ** 3), '1.5 GB');
  assert.equal(formatBytes(250 * 1024 ** 2), '250 MB');
  assert.equal(formatBytes(null), '—');

  const rows = [{ n: 'b', s: 2 }, { n: 'a', s: null }, { n: 'c', s: 5 }];
  assert.deepEqual(sortBy(rows, (r) => r.s, 'desc').map((r) => r.n), ['c', 'b', 'a'], 'empty values sort last');
  assert.deepEqual(sortBy(rows, (r) => r.s, 'asc').map((r) => r.n), ['b', 'c', 'a']);
  assert.deepEqual(sortBy([{ n: 'file10' }, { n: 'file9' }], (r) => r.n).map((r) => r.n), ['file9', 'file10'], 'natural sort');

  assert.equal(relativeTime(Date.now() - 3 * 86_400_000), '3 days ago');
  assert.equal(relativeTime(null), 'Never');
  assert.equal(errorMessage(new Error("Error invoking remote method 'x': Error: Boom")), 'Boom');
  assert.equal(dirname('C:\\a\\b.txt'), 'C:\\a');

  assert.equal(typeOf('MKV'), 'video');
  assert.equal(typeLabel('iso'), 'Installer');
  assert.equal(typeLabel('xyz'), 'XYZ file');
  assert.ok(typeFilter('other').excludeExts.includes('mp4'));
  assert.deepEqual(typeFilter('any'), {});
});
