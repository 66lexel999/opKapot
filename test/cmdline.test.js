'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { splitCommandLine, buildUninstallCommand, parseIconPath } = require('../src/main/lib/cmdline');

const exists = (files) => (p) => files.includes(p);

test('splits quoted command lines', () => {
  assert.deepEqual(splitCommandLine('"C:\\Program Files\\App\\uninst.exe" /S /x'), { file: 'C:\\Program Files\\App\\uninst.exe', args: '/S /x' });
  assert.deepEqual(splitCommandLine('"C:\\A B\\u.exe"'), { file: 'C:\\A B\\u.exe', args: '' });
});

test('splits unquoted paths containing spaces', () => {
  const file = 'C:\\Program Files (x86)\\My App\\unins000.exe';
  assert.deepEqual(splitCommandLine(`${file} /LOG`, exists([file])), { file, args: '/LOG' });
});

test('splits commands found on PATH', () => {
  assert.deepEqual(splitCommandLine('MsiExec.exe /I{1234}'), { file: 'MsiExec.exe', args: '/I{1234}' });
  assert.deepEqual(splitCommandLine('rundll32 foo.dll,Bar'), { file: 'rundll32', args: 'foo.dll,Bar' });
  assert.equal(splitCommandLine(''), null);
});

test('MSI products are removed with msiexec /X', () => {
  const program = {
    keyName: '{11111111-2222-3333-4444-555555555555}',
    windowsInstaller: true,
    uninstallString: 'MsiExec.exe /I{11111111-2222-3333-4444-555555555555}',
  };
  assert.deepEqual(buildUninstallCommand(program), { file: 'msiexec.exe', args: '/X{11111111-2222-3333-4444-555555555555}', msi: true });
  assert.equal(buildUninstallCommand(program, { quiet: true }).args, '/X{11111111-2222-3333-4444-555555555555} /qn /norestart');
});

test('quiet mode prefers QuietUninstallString, then Inno Setup switches', () => {
  const quietProgram = { uninstallString: '"C:\\A\\u.exe"', quietUninstallString: '"C:\\A\\u.exe" /S' };
  assert.deepEqual(buildUninstallCommand(quietProgram, { quiet: true }), { file: 'C:\\A\\u.exe', args: '/S', msi: false });
  assert.deepEqual(buildUninstallCommand(quietProgram), { file: 'C:\\A\\u.exe', args: '', msi: false });

  const inno = { uninstallString: '"C:\\Program Files\\X\\unins000.exe"' };
  assert.equal(buildUninstallCommand(inno, { quiet: true }).args, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
  assert.equal(buildUninstallCommand({}), null);
});

test('parses DisplayIcon values', () => {
  assert.equal(parseIconPath('"C:\\X\\app.exe",0'), 'C:\\X\\app.exe');
  assert.equal(parseIconPath('C:\\X\\app.ico'), 'C:\\X\\app.ico');
  assert.equal(parseIconPath('C:\\X\\app.exe,-101'), 'C:\\X\\app.exe');
  assert.equal(parseIconPath(''), null);
});
