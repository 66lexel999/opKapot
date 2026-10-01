'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('renderer helpers', async () => {
  const { formatBytes, sortBy, relativeTime, errorMessage, dirname, pathCrumbs, pathLink } = await import('../src/renderer/js/util.js');
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

  // Clickable addresses: every folder along the way, from the drive down.
  const crumbs = (p) => pathCrumbs(p)?.crumbs.map((c) => [c.label, c.path]);
  assert.deepEqual(crumbs('C:\\Apps'), [['C:', 'C:\\'], ['Apps', 'C:\\Apps']]);
  assert.deepEqual(crumbs('d:/Games/EA/'), [['D:', 'D:\\'], ['Games', 'D:\\Games'], ['EA', 'D:\\Games\\EA']]);
  assert.deepEqual(crumbs('C:\\'), [['C:', 'C:\\']]);
  assert.deepEqual(crumbs('/home/me/a b'), [['/', '/'], ['home', '/home'], ['me', '/home/me'], ['a b', '/home/me/a b']]);
  for (const notLocal of ['\\\\server\\share\\x', '//server/share', 'HKCU\\Software\\X', '\\Microsoft\\Windows', 'Windows\\System32', '', null]) {
    assert.equal(pathCrumbs(notLocal), null, String(notLocal));
  }
  const link = pathLink('C:\\Apps\\x".exe', { file: true });
  assert.match(link, /data-open-path="C:\\"[^>]*>C:</);
  assert.match(link, /data-open-path="C:\\Apps"/);
  assert.match(link, /title="Show C:\\Apps\\x&quot;\.exe in its folder"/, 'escaped, and the file is shown rather than opened');
  assert.equal(pathLink('<HKCU\\Run>'), '&lt;HKCU\\Run&gt;', 'anything else stays plain, escaped text');

  assert.equal(typeOf('MKV'), 'video');
  assert.equal(typeLabel('iso'), 'Installer');
  assert.equal(typeLabel('xyz'), 'XYZ file');
  assert.ok(typeFilter('other').excludeExts.includes('mp4'));
  assert.deepEqual(typeFilter('any'), {});
});
