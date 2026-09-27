'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSafety, isProtectedRegistryKey, normalizeRegistryKey } = require('../src/main/lib/safety');

const winEnv = {
  SystemRoot: 'C:\\Windows',
  SystemDrive: 'C:',
  USERPROFILE: 'C:\\Users\\Ann',
  LOCALAPPDATA: 'C:\\Users\\Ann\\AppData\\Local',
  APPDATA: 'C:\\Users\\Ann\\AppData\\Roaming',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  PUBLIC: 'C:\\Users\\Public',
};
const win = createSafety({ platform: 'win32', env: winEnv, home: 'C:\\Users\\Ann' });
const linux = createSafety({ platform: 'linux', env: {}, home: '/home/ann' });

test('windows: system and user roots are protected', () => {
  for (const p of [
    'C:\\', 'D:\\', 'C:\\Windows', 'C:\\Windows\\System32', 'c:\\windows\\system32\\drivers\\etc\\hosts',
    'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData', 'C:\\Users', 'C:\\Users\\Ann',
    'C:\\Users\\Ann\\AppData\\Local', 'C:\\Users\\Ann\\Documents', 'C:\\Users\\Ann\\AppData',
    'C:\\pagefile.sys', 'D:\\hiberfil.sys', 'C:\\Program Files\\WindowsApps\\Foo', 'C:\\Windows\\Temp',
    'relative\\path', '',
  ]) {
    assert.equal(win.isProtectedPath(p), true, p);
  }
});

test('windows: program folders, user files and temp contents are allowed', () => {
  for (const p of [
    'C:\\Program Files\\Razer', 'C:\\Program Files (x86)\\Steam\\steamapps', 'C:\\ProgramData\\Razer',
    'C:\\Users\\Ann\\AppData\\Roaming\\Spotify', 'C:\\Users\\Ann\\Downloads\\big.iso', 'D:\\Games\\Old',
    'C:\\Windows\\Temp\\setup.log', 'C:\\Windows\\SoftwareDistribution\\Download\\abc', 'C:\\Windows\\Minidump\\1.dmp',
  ]) {
    assert.equal(win.isProtectedPath(p), false, p);
  }
});

test('windows: deleting a parent of a protected folder is refused', () => {
  assert.equal(win.isProtectedPath('C:\\Users\\Ann\\AppData\\..'), true);
  assert.equal(win.isProtectedPath('C:\\Users\\Ann\\..\\..'), true);
});

test('linux: system trees and home roots are protected', () => {
  for (const p of ['/', '/usr', '/usr/bin/ls', '/etc/passwd', '/home', '/home/ann', '/home/ann/.config', '/var/lib/dpkg', '/tmp']) {
    assert.equal(linux.isProtectedPath(p), true, p);
  }
  for (const p of ['/home/ann/Videos/movie.mkv', '/home/ann/.config/spotify', '/tmp/junk.txt', '/opt/someapp']) {
    assert.equal(linux.isProtectedPath(p), false, p);
  }
});

test('registry keys: shared system keys are protected, program keys are not', () => {
  assert.equal(normalizeRegistryKey('HKEY_LOCAL_MACHINE\\SOFTWARE\\Razer\\'), 'HKLM\\SOFTWARE\\Razer');
  for (const k of [
    'HKLM\\SOFTWARE', 'HKLM\\SOFTWARE\\Microsoft', 'HKCU\\Software\\Microsoft\\Windows',
    'HKLM\\SOFTWARE\\Classes\\Foo', 'HKLM\\SYSTEM\\CurrentControlSet', 'HKCR\\Foo',
    'HKLM\\SOFTWARE\\WOW6432Node', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\X\\Sub',
  ]) {
    assert.equal(isProtectedRegistryKey(k), true, k);
  }
  for (const k of [
    'HKCU\\Software\\Razer', 'HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games\\Launcher',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{ABC}',
  ]) {
    assert.equal(isProtectedRegistryKey(k), false, k);
  }
});
