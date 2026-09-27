'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInstallDate, normalizePublisher, baseProgramName, compact } = require('../src/main/services/programs/common');
const { groupBundles } = require('../src/main/services/programs/bundles');
const { normalizeEntries } = require('../src/main/services/programs/windows');
const { prettifyPackageName } = require('../src/main/services/windowsApps');
const { parseHumanSize } = require('../src/main/services/programs/linux');

test('parses install dates in common registry formats', () => {
  const ymd = (t) => { const d = new Date(t); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; };
  assert.deepEqual(ymd(parseInstallDate('20240315')), [2024, 3, 15]);
  assert.deepEqual(ymd(parseInstallDate('2024-03-15')), [2024, 3, 15]);
  assert.deepEqual(ymd(parseInstallDate('3/15/2024')), [2024, 3, 15]);
  assert.deepEqual(ymd(parseInstallDate('15/03/2024')), [2024, 3, 15]);
  assert.equal(parseInstallDate(''), null);
  assert.equal(parseInstallDate('20241399'), null);
  assert.equal(parseInstallDate('19000101'), null);
});

test('normalises publisher and program names', () => {
  assert.equal(normalizePublisher('Razer Inc.'), 'razer');
  assert.equal(normalizePublisher('MSI Co., LTD'), 'msi');
  assert.equal(normalizePublisher('NVIDIA Corporation'), 'nvidia');
  assert.equal(normalizePublisher('Spotify AB'), 'spotify');
  assert.equal(normalizePublisher('Rockstar Games'), 'rockstargames');
  assert.equal(baseProgramName('7-Zip 23.01 (x64)'), '7-Zip');
  assert.equal(baseProgramName('Python 3.12.2 (64-bit)'), 'Python');
  assert.equal(baseProgramName('MSI Afterburner 4.6.6'), 'MSI Afterburner');
  assert.equal(compact('Razer Synapse 3'), 'razersynapse3');
});

const DAY = 86_400_000;
const base = Date.UTC(2026, 0, 10, 12);
const prog = (id, name, publisher, offsetMin, extra = {}) => ({
  id, name, publisher, installTime: base + offsetMin * 60_000, installDate: base, installTimePrecise: true, size: 1, ...extra,
});

test('groups bundleware by publisher, install time and nesting', () => {
  const programs = [
    prog('a', 'MSI Afterburner', 'MSI Co., LTD', 0, { size: 50 }),
    prog('b', 'RivaTuner Statistics Server', 'Unwinder', 1),
    prog('c', 'Razer Cortex', 'Razer Inc.', 3 * 24 * 60),
    prog('d', 'Razer Synapse', 'Razer Inc.', 3 * 24 * 60 + 20),
    prog('e', 'Lonely App', 'Someone', 30 * 24 * 60),
    prog('f', 'VC++ 2015', 'Microsoft Corporation', 10 * 24 * 60),
    prog('g', 'VC++ 2019', 'Microsoft Corporation', 10 * 24 * 60),
    prog('h', 'Host', 'H Corp', 60 * 24 * 60, { installLocation: 'C:\\Program Files\\Host' }),
    prog('i', 'Plugin', 'P Corp', 90 * 24 * 60, { installLocation: 'C:\\Program Files\\Host\\Plugins\\P' }),
  ];
  const groups = groupBundles(programs);
  const byMain = Object.fromEntries(groups.map((g) => [g.main, g.members]));
  assert.deepEqual(byMain.a, ['b']);
  assert.deepEqual(byMain.c, ['d']);
  assert.deepEqual(byMain.h, ['i']);
  assert.equal(groups.length, 3, 'Microsoft runtimes and lone programs are not bundles');
});

test('mass installs (e.g. a fresh OS) are not reported as one huge bundle', () => {
  const programs = Array.from({ length: 30 }, (_, i) => prog(`p${i}`, `App ${i}`, `Vendor ${i}`, i % 2));
  assert.deepEqual(groupBundles(programs), []);
});

test('normalises raw registry entries', () => {
  const entries = [
    { Hive: 'HKLM', Arch: 'x64', Key: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam', KeyName: 'Steam', DisplayName: 'Steam', Publisher: 'Valve Corporation', DisplayVersion: '2.10', InstallDate: '20240102', EstimatedSize: 1024, UninstallString: '"C:\\Program Files (x86)\\Steam\\uninstall.exe"', InstallLocation: 'C:\\Program Files (x86)\\Steam\\' },
    { Hive: 'HKLM', Arch: 'x64', KeyName: 'KB5000001', DisplayName: 'Security Update', UninstallString: 'x' },
    { Hive: 'HKLM', Arch: 'x64', KeyName: 'patch', DisplayName: 'Patch', ParentKeyName: 'Office', UninstallString: 'x' },
    { Hive: 'HKLM', Arch: 'x64', KeyName: 'nouninst', DisplayName: 'No uninstaller' },
    { Hive: 'HKCU', Arch: 'user', KeyName: 'Discord', DisplayName: 'Discord', UninstallString: '"C:\\Users\\Ann\\AppData\\Local\\Discord\\Update.exe" --uninstall', DisplayIcon: 'C:\\Users\\Ann\\AppData\\Local\\Discord\\app.ico' },
    { Hive: 'HKLM', Arch: 'x86', KeyName: 'Steam', DisplayName: 'Steam', DisplayVersion: '2.10', UninstallString: 'y', SystemComponent: 1 },
  ];
  const programs = normalizeEntries(entries);
  assert.equal(programs.length, 2);
  const steam = programs.find((p) => p.name === 'Steam');
  assert.equal(steam.size, 1024 * 1024);
  assert.equal(steam.installLocation, 'C:\\Program Files (x86)\\Steam');
  assert.equal(steam.registryKey, 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam');
  assert.equal(steam.systemComponent, false);
  const discord = programs.find((p) => p.name === 'Discord');
  assert.equal(discord.installLocation, 'C:\\Users\\Ann\\AppData\\Local\\Discord');
  assert.equal(discord.locationGuessed, true);
});

test('prettifies Store package names', () => {
  assert.equal(prettifyPackageName('Microsoft.WindowsCalculator'), 'Calculator');
  assert.equal(prettifyPackageName('5319275A.WhatsAppDesktop'), 'WhatsApp');
  assert.equal(prettifyPackageName('AppUp.IntelGraphicsExperience'), 'Intel Graphics Experience');
  assert.equal(prettifyPackageName('SpotifyAB.SpotifyMusic'), 'Spotify Music');
});

test('parses human readable sizes', () => {
  assert.equal(parseHumanSize('1.5 GB'), 1.5e9);
  assert.equal(parseHumanSize('300 kB'), 300e3);
  assert.equal(parseHumanSize('n/a'), null);
});
