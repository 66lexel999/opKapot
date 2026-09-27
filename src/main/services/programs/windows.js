'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { powershell, powershellJson, psQuote, asArray, run } = require('../../lib/exec');
const { buildUninstallCommand, parseIconPath, GUID } = require('../../lib/cmdline');
const { createSafety, normalizeRegistryKey } = require('../../lib/safety');
const registry = require('../../lib/registry');
const { parseInstallDate, compact, baseProgramName, sleep } = require('./common');

const P = path.win32;

const LIST_SCRIPT = `
$roots = @(
  @('HKLM', 'x64', 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'),
  @('HKLM', 'x86', 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'),
  @('HKCU', 'user', 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
)
$list = New-Object System.Collections.ArrayList
foreach ($r in $roots) {
  foreach ($k in @(Get-ChildItem -LiteralPath $r[2])) {
    $name = $k.GetValue('DisplayName')
    if (-not $name) { continue }
    [void]$list.Add([ordered]@{
      Hive = $r[0]; Arch = $r[1]; Key = $k.Name; KeyName = $k.PSChildName
      DisplayName = [string]$name
      DisplayVersion = [string]$k.GetValue('DisplayVersion')
      Publisher = [string]$k.GetValue('Publisher')
      InstallDate = [string]$k.GetValue('InstallDate')
      InstallLocation = [string]$k.GetValue('InstallLocation')
      EstimatedSize = $k.GetValue('EstimatedSize')
      UninstallString = [string]$k.GetValue('UninstallString')
      QuietUninstallString = [string]$k.GetValue('QuietUninstallString')
      DisplayIcon = [string]$k.GetValue('DisplayIcon')
      SystemComponent = $k.GetValue('SystemComponent')
      WindowsInstaller = $k.GetValue('WindowsInstaller')
      ParentKeyName = [string]$k.GetValue('ParentKeyName')
      ReleaseType = [string]$k.GetValue('ReleaseType')
      NoRemove = $k.GetValue('NoRemove')
      URLInfoAbout = [string]$k.GetValue('URLInfoAbout')
      Comments = [string]$k.GetValue('Comments')
    })
  }
}
ConvertTo-Json -InputObject @($list) -Depth 3 -Compress
`;

const clean = (v) => (v == null ? '' : String(v).replace(/\0/g, '').trim());
const cleanPath = (v) => clean(v).replace(/^"+|"+$/g, '').replace(/[\\/]+$/, '');

/** Guess a program folder from its icon or uninstaller path when InstallLocation is empty. */
function guessLocation(entry, safety) {
  const candidates = [parseIconPath(entry.DisplayIcon)];
  const uninstall = clean(entry.UninstallString);
  if (uninstall && !/msiexec|rundll32/i.test(uninstall)) {
    const quoted = /^"([^"]+)"/.exec(uninstall);
    candidates.push(quoted ? quoted[1] : (/^(.*?\.exe)\b/i.exec(uninstall) || [])[1]);
  }
  for (const file of candidates) {
    if (!file || !/\.(exe|ico)$/i.test(file) || !P.isAbsolute(file)) continue;
    const dir = P.dirname(file);
    const lower = dir.toLowerCase();
    if (/\\(package cache|installer|temp|common files|installshield installation information)(\\|$)/.test(lower)) continue;
    if (/^[a-z]:\\windows(\\|$)/.test(lower)) continue;
    if (dir.split('\\').filter(Boolean).length < 3) continue; // e.g. C:\Program Files\App at minimum
    if (safety.isProtectedPath(dir)) continue;
    return dir;
  }
  return '';
}

/**
 * Turn raw registry values into program records. Pure (fs access injected)
 * so it can be tested on any platform.
 */
function normalizeEntries(entries, { safety = createSafety({ platform: 'win32' }) } = {}) {
  const byName = new Map();
  for (const e of asArray(entries)) {
    const name = clean(e.DisplayName);
    if (!name) continue;
    if (clean(e.ParentKeyName)) continue; // patch or update of another product
    if (/^(update|hotfix|security update|service pack)$/i.test(clean(e.ReleaseType))) continue;
    if (/^KB\d{6,}$/i.test(clean(e.KeyName))) continue;

    const windowsInstaller = Number(e.WindowsInstaller) === 1;
    const uninstallString = clean(e.UninstallString);
    if (!uninstallString && !(windowsInstaller && GUID.test(clean(e.KeyName)))) continue;

    let installLocation = cleanPath(e.InstallLocation);
    let locationGuessed = false;
    if (installLocation && (!P.isAbsolute(installLocation) || safety.isProtectedPath(installLocation))) installLocation = '';
    if (!installLocation) {
      installLocation = guessLocation(e, safety);
      locationGuessed = !!installLocation;
    }

    const kb = Number(e.EstimatedSize);
    const program = {
      id: `${clean(e.Hive)}:${clean(e.Arch)}:${clean(e.KeyName)}`,
      name,
      version: clean(e.DisplayVersion),
      publisher: clean(e.Publisher),
      installDate: parseInstallDate(e.InstallDate),
      installTime: null,
      installTimePrecise: false,
      size: Number.isFinite(kb) && kb > 0 ? kb * 1024 : null,
      installLocation,
      locationGuessed,
      uninstallString,
      quietUninstallString: clean(e.QuietUninstallString),
      displayIcon: clean(e.DisplayIcon),
      registryKey: normalizeRegistryKey(e.Key),
      keyName: clean(e.KeyName),
      windowsInstaller,
      systemComponent: Number(e.SystemComponent) === 1,
      noRemove: Number(e.NoRemove) === 1,
      arch: clean(e.Arch),
      website: clean(e.URLInfoAbout),
      description: clean(e.Comments),
      source: 'registry',
      sourceLabel: e.Hive === 'HKCU' ? 'Current user' : e.Arch === 'x86' ? '32-bit' : '64-bit',
      canUninstall: true,
      canRemoveEntry: true,
      lastUsed: null,
    };

    // The same product can be registered twice (per-user and per-machine, or
    // 32- and 64-bit views). Keep the most useful entry.
    const dedupeKey = `${name.toLowerCase()}|${program.version}`;
    const existing = byName.get(dedupeKey);
    if (!existing || (existing.systemComponent && !program.systemComponent)) byName.set(dedupeKey, program);
  }
  return [...byName.values()];
}

async function listPrograms() {
  const data = await powershellJson(LIST_SCRIPT, { timeout: 120_000 });
  const programs = normalizeEntries(data);
  await Promise.all(programs.map(async (p) => {
    if (!p.installLocation) return;
    try {
      const stat = await fs.promises.stat(p.installLocation);
      const born = stat.birthtimeMs || stat.ctimeMs;
      // Trust the folder timestamp when it agrees with the registry date.
      if (!p.installDate || Math.abs(born - p.installDate) < 2 * 86_400_000) {
        p.installTime = born;
        p.installTimePrecise = true;
        p.installDate ||= born;
      }
    } catch {
      if (p.locationGuessed) {
        p.installLocation = '';
        p.locationGuessed = false;
      }
    }
  }));
  for (const p of programs) p.installTime ||= p.installDate;
  return programs;
}

// ------------------------------------------------------------- uninstall ---

function launch(cmd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd.file, cmd.args ? [cmd.args] : [], {
        argv0: `"${cmd.file}"`,
        windowsVerbatimArguments: true,
        windowsHide: false,
        stdio: 'ignore',
      });
    } catch (error) {
      resolve({ error });
      return;
    }
    const pid = child.pid;
    child.on('error', (error) => resolve({ error, pid }));
    child.on('exit', (code) => resolve({ code, pid }));
  });
}

/** Fallback when the uninstaller demands elevation we don't have. */
async function launchElevated(cmd) {
  const argList = cmd.args ? ` -ArgumentList ${psQuote(cmd.args)}` : '';
  const res = await powershell(
    `$p = Start-Process -FilePath ${psQuote(cmd.file)}${argList} -Verb RunAs -PassThru -Wait -ErrorAction Stop; if ($p) { $p.ExitCode } else { -1 }`,
    { timeout: 0 },
  );
  const code = parseInt(res.stdout.trim(), 10);
  if (!Number.isFinite(code)) return { error: new Error((res.stderr || 'Elevation was cancelled').trim().split('\n')[0]) };
  return { code, pid: null };
}

/**
 * Many uninstallers (Inno Setup, NSIS) copy themselves to %TEMP% and exit
 * straight away, so we also watch for helper processes they start.
 */
async function helpersRunning(sinceMs, rootPid) {
  const script = `
$since = [DateTimeOffset]::FromUnixTimeMilliseconds(${Math.floor(sinceMs) - 2000}).LocalDateTime
$procs = @(Get-CimInstance Win32_Process | Where-Object { $_.CreationDate -gt $since } |
  ForEach-Object { [ordered]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = [string]$_.Name; path = [string]$_.ExecutablePath } })
ConvertTo-Json -InputObject $procs -Compress`;
  const procs = asArray(await powershellJson(script, { timeout: 30_000 }));
  const temp = (process.env.TEMP || '').toLowerCase();
  const tree = new Set(rootPid ? [rootPid] : []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of procs) {
      if (tree.has(p.ppid) && !tree.has(p.pid)) {
        tree.add(p.pid);
        grew = true;
      }
    }
  }
  return procs.some((p) => {
    const name = String(p.name || '').toLowerCase();
    const exe = String(p.path || '').toLowerCase();
    return (tree.has(p.pid) && p.pid !== rootPid)
      || (temp && exe.startsWith(temp) && /\.(tmp|exe)$/.test(exe))
      || /^(au_|un_a|_iu|unins\d{3})/.test(name);
  });
}

async function uninstall(program, { quiet = false, onStatus = () => {}, shouldStopWaiting = () => false } = {}) {
  const cmd = buildUninstallCommand(program, { quiet });
  if (!cmd) return { status: 'failed', message: 'No uninstaller is registered for this program.' };

  onStatus('running', quiet ? 'Uninstalling silently…' : 'Running the uninstaller…');
  const started = Date.now();
  let exit = await launch(cmd);
  if (exit.error && /EACCES|UNKNOWN|740/.test(`${exit.error.code} ${exit.error.message}`)) {
    onStatus('running', 'Waiting for administrator permission…');
    exit = await launchElevated(cmd);
  }
  if (exit.error) return { status: 'failed', message: `Could not start the uninstaller: ${exit.error.message}` };

  let rebootRequired = false;
  if (cmd.msi) {
    if (exit.code === 1602) return { status: 'cancelled', message: 'Uninstall was cancelled.' };
    if (exit.code === 1605) return { status: 'removed', message: 'Already removed.' };
    if (exit.code === 3010 || exit.code === 1641) rebootRequired = true;
    else if (exit.code !== 0) return { status: 'failed', message: `Windows Installer error ${exit.code}.` };
  }

  onStatus('waiting', 'Waiting for the uninstaller to finish…');
  let idleSince = null;
  for (;;) {
    const exists = await registry.keyExists(program.registryKey);
    if (exists === false) {
      return { status: 'removed', rebootRequired, message: rebootRequired ? 'Removed. Restart Windows to finish.' : 'Removed.' };
    }
    if (shouldStopWaiting()) return { status: 'unconfirmed', message: 'Stopped waiting. The program may still be installed.' };
    if (Date.now() - started > 30 * 60_000) return { status: 'unconfirmed', message: 'Timed out waiting for the uninstaller.' };

    const busy = cmd.msi ? false : await helpersRunning(started, exit.pid);
    if (busy) {
      idleSince = null;
    } else {
      idleSince ??= Date.now();
      if (Date.now() - idleSince > 5000) {
        return { status: 'unconfirmed', message: 'The uninstaller closed but the program is still installed. It may have been cancelled.' };
      }
    }
    await sleep(1500);
  }
}

async function removeEntry(program, backupDir) {
  return registry.deleteKey(program.registryKey, backupDir);
}

// ----------------------------------------------------------------- icons ---

const SKIP_EXE = /^(unins|uninst|uninstall|setup|install|update|updater|crash|helper|vc_?redist|dotnet|elevate)/i;

/** Files that probably carry the program's icon, best first. */
async function iconCandidates(program) {
  const out = [];
  const icon = parseIconPath(program.displayIcon);
  if (icon && /\.(exe|ico|dll)$/i.test(icon)) out.push(icon);
  if (program.installLocation) {
    try {
      const want = compact(baseProgramName(program.name));
      const exes = (await fs.promises.readdir(program.installLocation))
        .filter((f) => /\.exe$/i.test(f) && !SKIP_EXE.test(f));
      exes.sort((a, b) => {
        const score = (f) => (want.includes(compact(f.replace(/\.exe$/i, ''))) ? 0 : 1);
        return score(a) - score(b);
      });
      if (exes[0]) out.push(P.join(program.installLocation, exes[0]));
    } catch { /* no folder */ }
  }
  if (program.windowsInstaller && GUID.test(program.keyName)) {
    const dir = P.join(process.env.SystemRoot || 'C:\\Windows', 'Installer', program.keyName.match(GUID)[0]);
    try {
      const files = (await fs.promises.readdir(dir)).filter((f) => /\.(ico|exe)$/i.test(f));
      if (files[0]) out.push(P.join(dir, files[0]));
    } catch { /* none */ }
  }
  return out;
}

// ----------------------------------------------------------------- usage ---

/**
 * Estimate when each program was last used from Windows Prefetch data
 * (C:\Windows\Prefetch\APP.EXE-XXXXXXXX.pf is rewritten on every launch).
 */
async function usage(programs) {
  const prefetch = new Map();
  const dir = P.join(process.env.SystemRoot || 'C:\\Windows', 'Prefetch');
  try {
    for (const f of await fs.promises.readdir(dir)) {
      const m = /^(.+\.exe)-[0-9a-f]{8}\.pf$/i.exec(f);
      if (!m) continue;
      try {
        const { mtimeMs } = await fs.promises.stat(P.join(dir, f));
        const exe = m[1].toUpperCase();
        prefetch.set(exe, Math.max(prefetch.get(exe) || 0, mtimeMs));
      } catch { /* ignore */ }
    }
  } catch { /* needs admin */ }

  const result = {};
  await Promise.all(programs.map(async (p) => {
    if (!p.installLocation) return;
    const exes = [];
    const scan = async (folder, depth) => {
      let entries;
      try {
        entries = await fs.promises.readdir(folder, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (exes.length > 300) return;
        if (e.isFile() && /\.exe$/i.test(e.name)) exes.push(P.join(folder, e.name));
        else if (e.isDirectory() && depth < 2) await scan(P.join(folder, e.name), depth + 1);
      }
    };
    await scan(p.installLocation, 0);
    let last = 0;
    for (const exe of exes) {
      const name = P.basename(exe).toUpperCase();
      if (SKIP_EXE.test(name)) continue;
      last = Math.max(last, prefetch.get(name) || 0);
    }
    if (!last && !prefetch.size) {
      // No prefetch access: fall back to file access times (less reliable).
      for (const exe of exes) {
        try {
          last = Math.max(last, (await fs.promises.stat(exe)).atimeMs);
        } catch { /* ignore */ }
      }
    }
    result[p.id] = last || null;
  }));
  return result;
}

async function createRestorePoint(description) {
  const res = await powershell(
    `Checkpoint-Computer -Description ${psQuote(description)} -RestorePointType 'APPLICATION_UNINSTALL' -ErrorAction Stop; 'OK'`,
    { timeout: 300_000 },
  );
  if (res.stdout.includes('OK')) return { ok: true };
  return { ok: false, error: (res.stderr || 'System Restore is turned off.').trim().split(/\r?\n/)[0] };
}

async function currentUserSid() {
  const res = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { timeout: 10_000 });
  const m = /"(S-1-[\d-]+)"/.exec(res.stdout);
  return m ? m[1] : null;
}

module.exports = {
  listPrograms,
  normalizeEntries,
  uninstall,
  removeEntry,
  iconCandidates,
  usage,
  createRestorePoint,
  currentUserSid,
};
