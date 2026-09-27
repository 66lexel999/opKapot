'use strict';

const os = require('node:os');
const path = require('node:path');

// Files that live in a drive root and must never be touched.
const WIN_ROOT_FILES = new Set([
  'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'bootmgr', 'bootnxt', 'dumpstack.log', 'dumpstack.log.tmp',
]);

// Registry vendors whose keys hold shared system state.
const REGISTRY_DENY = new Set([
  'microsoft', 'classes', 'policies', 'clients', 'registeredapplications', 'odbc', 'wow6432node', 'windows', 'windows nt',
]);

/**
 * Build path/registry guards for a platform. Everything is injectable so the
 * Windows rules can be unit-tested on any OS.
 */
function createSafety({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const isWin = platform === 'win32';
  const P = isWin ? path.win32 : path.posix;

  const key = (p) => {
    let resolved = P.resolve(p);
    if (resolved.length > P.parse(resolved).root.length) resolved = resolved.replace(/[\\/]+$/, '');
    return isWin ? resolved.toLowerCase() : resolved;
  };
  const isInside = (child, parent) => {
    const rel = P.relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !P.isAbsolute(rel);
  };

  const exact = [];   // may not be deleted, nor may anything that contains them
  const trees = [];   // nothing inside may be deleted...
  const allowed = []; // ...except the contents of these sub-folders
  const add = (list, ...parts) => {
    if (parts.every(Boolean)) list.push(key(P.join(...parts)));
  };

  if (isWin) {
    const sysRoot = env.SystemRoot || env.windir || 'C:\\Windows';
    const sysDrive = `${env.SystemDrive || 'C:'}\\`;
    const profile = env.USERPROFILE || home;
    const local = env.LOCALAPPDATA || P.join(profile, 'AppData', 'Local');
    const roaming = env.APPDATA || P.join(profile, 'AppData', 'Roaming');
    const programData = env.ProgramData || 'C:\\ProgramData';
    const programFiles = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432];

    for (const dir of programFiles) {
      add(exact, dir);
      add(exact, dir, 'Common Files');
      add(trees, dir, 'WindowsApps');
    }
    add(exact, programData);
    add(exact, programData, 'Microsoft');
    add(exact, env.PUBLIC);
    add(exact, P.dirname(profile));
    add(exact, profile);
    add(exact, profile, 'AppData');
    add(exact, profile, 'AppData', 'LocalLow');
    add(exact, local);
    add(exact, local, 'Programs');
    add(exact, local, 'Temp');
    add(exact, local, 'Microsoft');
    add(exact, roaming);
    add(exact, roaming, 'Microsoft');
    add(exact, env.OneDrive);
    for (const folder of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'Favorites', 'Saved Games']) {
      add(exact, profile, folder);
    }
    add(trees, sysRoot);
    add(trees, sysDrive, 'System Volume Information');
    add(trees, sysDrive, 'Recovery');
    add(trees, sysDrive, 'Boot');
    add(trees, sysDrive, '$Recycle.Bin');
    add(allowed, sysRoot, 'Temp');
    add(allowed, sysRoot, 'Minidump');
    add(allowed, sysRoot, 'LiveKernelReports');
    add(allowed, sysRoot, 'SoftwareDistribution', 'Download');
  } else {
    for (const dir of ['/home', '/Users', '/Applications', '/Volumes', '/media', '/mnt', '/tmp', '/var', '/var/tmp', '/opt', '/srv', '/Library']) {
      add(exact, dir);
    }
    add(exact, home);
    for (const folder of ['.config', '.local', '.local/share', '.cache', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos',
      'Library', 'Library/Application Support', 'Library/Caches', 'Library/Preferences', 'Applications']) {
      add(exact, home, folder);
    }
    for (const dir of ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/libx32', '/proc', '/run', '/sbin',
      '/sys', '/usr', '/var/lib', '/var/log', '/snap', '/System', '/private']) {
      add(trees, dir);
    }
  }

  /** True when deleting `p` could damage the system or wipe user folders. */
  function isProtectedPath(p) {
    if (typeof p !== 'string' || !p.trim() || !P.isAbsolute(p)) return true;
    const k = key(p);
    if (k === key(P.parse(k).root)) return true; // a drive or filesystem root
    for (const e of exact) {
      if (k === e || isInside(e, k)) return true;
    }
    for (const t of trees) {
      if (isInside(t, k)) return true;
      if (k === t || isInside(k, t)) {
        if (!allowed.some((a) => isInside(k, a))) return true;
      }
    }
    if (isWin) {
      const parent = P.dirname(k);
      if (parent === P.parse(k).root && WIN_ROOT_FILES.has(P.basename(k))) return true;
    }
    return false;
  }

  return { isProtectedPath, isInside, key };
}

/** Normalise a registry path to `HKLM\…` / `HKCU\…` form. */
function normalizeRegistryKey(k) {
  return String(k || '')
    .replace(/^Registry::/i, '')
    .replace(/^HKEY_LOCAL_MACHINE/i, 'HKLM')
    .replace(/^HKEY_CURRENT_USER/i, 'HKCU')
    .replace(/^(HKLM|HKCU):/i, '$1')
    .replace(/\\+$/, '');
}

/** True when deleting a registry key could damage shared system state. */
function isProtectedRegistryKey(k) {
  const parts = normalizeRegistryKey(k).split('\\').filter(Boolean);
  const hive = (parts[0] || '').toUpperCase();
  if (hive !== 'HKLM' && hive !== 'HKCU') return true;
  if ((parts[1] || '').toLowerCase() !== 'software') return true;
  let i = 2;
  if ((parts[i] || '').toLowerCase() === 'wow6432node') i++;
  const vendor = (parts[i] || '').toLowerCase();
  if (!vendor) return true;
  if (REGISTRY_DENY.has(vendor)) {
    // Only individual program entries under ...\CurrentVersion\Uninstall\ are fair game.
    const rest = parts.slice(i).map((s) => s.toLowerCase());
    const uninstall = ['microsoft', 'windows', 'currentversion', 'uninstall'];
    return !(rest.length === 5 && uninstall.every((s, n) => rest[n] === s));
  }
  return false;
}

const safety = createSafety();

module.exports = { createSafety, safety, normalizeRegistryKey, isProtectedRegistryKey };
