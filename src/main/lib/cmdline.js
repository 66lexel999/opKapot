'use strict';

const fs = require('node:fs');
const path = require('node:path');

const GUID = /\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/i;

/**
 * Split a Windows command line (as stored in UninstallString) into the program
 * and its raw argument string. Handles quoted paths and the common unquoted
 * "C:\Program Files\App\uninst.exe /S" form.
 */
function splitCommandLine(command, exists = fs.existsSync) {
  const cmd = String(command || '').trim();
  if (!cmd) return null;

  if (cmd.startsWith('"')) {
    const end = cmd.indexOf('"', 1);
    if (end === -1) return { file: cmd.slice(1), args: '' };
    return { file: cmd.slice(1, end), args: cmd.slice(end + 1).trim() };
  }

  const lower = cmd.toLowerCase();
  let firstCandidate = null;
  for (let i = lower.indexOf('.exe'); i !== -1; i = lower.indexOf('.exe', i + 4)) {
    const next = cmd[i + 4];
    if (next !== undefined && next !== ' ' && next !== '"') continue;
    const file = cmd.slice(0, i + 4);
    const args = cmd.slice(i + 4).trim();
    if (!file.includes('\\') || exists(file)) return { file, args };
    firstCandidate ??= { file, args };
  }
  if (firstCandidate) return firstCandidate;

  const space = cmd.indexOf(' ');
  return space === -1 ? { file: cmd, args: '' } : { file: cmd.slice(0, space), args: cmd.slice(space + 1).trim() };
}

/** Extract an MSI product code from a program's registry data. */
function msiProductCode(program) {
  if (program.windowsInstaller && GUID.test(program.keyName || '')) return program.keyName.match(GUID)[0];
  const cmd = program.uninstallString || '';
  if (/msiexec/i.test(cmd)) {
    const m = cmd.match(GUID);
    if (m) return m[0];
  }
  return null;
}

/**
 * Decide how to run a program's uninstaller.
 * Returns { file, args, msi } or null if the program has no uninstaller.
 */
function buildUninstallCommand(program, { quiet = false, exists = fs.existsSync } = {}) {
  const productCode = msiProductCode(program);
  if (productCode) {
    return {
      file: 'msiexec.exe',
      args: `/X${productCode}${quiet ? ' /qn /norestart' : ''}`,
      msi: true,
    };
  }

  if (quiet && program.quietUninstallString) {
    const quietCmd = splitCommandLine(program.quietUninstallString, exists);
    if (quietCmd) return { ...quietCmd, msi: false };
  }

  const cmd = splitCommandLine(program.uninstallString, exists);
  if (!cmd) return null;

  if (quiet && /^unins\d{3}\.exe$/i.test(path.win32.basename(cmd.file))) {
    // Inno Setup uninstaller.
    cmd.args = `${cmd.args} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`.trim();
  }
  return { ...cmd, msi: false };
}

/** Pull the file path out of a DisplayIcon value such as `"C:\x\app.exe",0`. */
function parseIconPath(displayIcon) {
  let value = String(displayIcon || '').trim();
  if (!value) return null;
  value = value.replace(/,\s*-?\d+\s*$/, '').trim();
  value = value.replace(/^"+|"+$/g, '').trim();
  return value || null;
}

module.exports = { splitCommandLine, buildUninstallCommand, msiProductCode, parseIconPath, GUID };
