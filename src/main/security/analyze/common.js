'use strict';

const path = require('node:path');
const { splitCommandLine } = require('../../lib/cmdline');

const P = path.win32;

const SEVERITY_ORDER = { danger: 0, warning: 1, notice: 2, ok: 3 };

const CATEGORIES = {
  remote: 'Remote access & sign-ins',
  keylogger: 'Keyloggers & spyware',
  network: 'Network & internet',
  browser: 'Browser security',
  protection: 'Windows protection',
  startup: 'Startup & hidden programs',
  accounts: 'User accounts',
  sharing: 'Files & sharing',
};

/** ConvertTo-Json flattens 0/1-item arrays; always get an array back. */
function asArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v) => v != null);
  if (typeof value === 'object' && Object.keys(value).length === 1 && typeof value.error === 'string') return [];
  return [value];
}

/** The error text of a collector section that failed, or null. */
function sectionError(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.error === 'string' ? value.error : null;
}

function envGet(env, name) {
  const key = Object.keys(env || {}).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function expandEnv(text, env) {
  return String(text ?? '').replace(/%([^%\\/]+)%/g, (m, name) => envGet(env, name) ?? m);
}

/** Turn registry/driver style paths into normal absolute Windows paths. */
function normalizeWinPath(value, env) {
  let s = expandEnv(String(value ?? '').trim(), env).replace(/^"+|"+$/g, '');
  s = s.replace(/^\\\?\?\\/, '').replace(/^\\\\\?\\/, '');
  const sysRoot = envGet(env, 'SystemRoot') || envGet(env, 'windir') || 'C:\\Windows';
  if (/^\\systemroot\\/i.test(s)) s = sysRoot + s.slice('\\SystemRoot'.length);
  else if (/^system32\\/i.test(s)) s = P.join(sysRoot, s);
  return s;
}

const SYSTEM_TOOLS = new Set([
  'rundll32.exe', 'regsvr32.exe', 'mshta.exe', 'wscript.exe', 'cscript.exe', 'cmd.exe', 'powershell.exe', 'conhost.exe',
  'schtasks.exe', 'reg.exe', 'msiexec.exe', 'explorer.exe', 'svchost.exe', 'bitsadmin.exe', 'certutil.exe', 'wmic.exe',
]);

const SCRIPT_HOSTS = new Set(['wscript.exe', 'cscript.exe', 'mshta.exe', 'rundll32.exe', 'regsvr32.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe']);

/** Where a file lives, in terms that matter for trust. */
function pathKind(file, env) {
  const p = String(file || '').toLowerCase().replace(/\//g, '\\');
  if (!p) return 'unknown';
  const starts = (v) => {
    const base = String(v || '').toLowerCase().replace(/\\+$/, '');
    return base && (p === base || p.startsWith(`${base}\\`));
  };
  if (p.includes('\\$recycle.bin\\')) return 'recycle';
  if (starts(envGet(env, 'TEMP')) || starts(envGet(env, 'TMP')) || p.includes('\\appdata\\local\\temp\\') || /^[a-z]:\\windows\\temp\\/.test(p)) return 'temp';
  if (starts(envGet(env, 'SystemRoot')) || /^[a-z]:\\windows\\/.test(p)) return 'windows';
  if (starts(envGet(env, 'ProgramFiles')) || starts(envGet(env, 'ProgramFiles(x86)')) || starts(envGet(env, 'ProgramW6432')) || /^[a-z]:\\program files( \(x86\))?\\/.test(p)) return 'programfiles';
  if (starts(envGet(env, 'PUBLIC')) || /^[a-z]:\\users\\public\\/.test(p)) return 'public';
  if (p.includes('\\downloads\\')) return 'downloads';
  if (p.includes('\\desktop\\')) return 'desktop';
  if (p.includes('\\appdata\\')) return 'appdata';
  if (starts(envGet(env, 'ProgramData')) || /^[a-z]:\\programdata\\/.test(p)) return 'programdata';
  if (starts(envGet(env, 'USERPROFILE')) || /^[a-z]:\\users\\/.test(p)) return 'user';
  return 'other';
}

const USER_WRITABLE = new Set(['temp', 'recycle', 'public', 'downloads', 'desktop', 'appdata', 'programdata', 'user']);

const KIND_LABEL = {
  temp: 'a temporary folder', recycle: 'the Recycle Bin', public: 'the Public folder', downloads: 'your Downloads folder',
  desktop: 'your Desktop', appdata: 'an AppData folder', programdata: 'ProgramData', user: 'your user folder',
  windows: 'the Windows folder', programfiles: 'Program Files', other: 'another folder', unknown: 'an unknown place',
};

/**
 * Work out which file a command line actually runs, looking through
 * script hosts (wscript, rundll32, powershell…) to the real payload.
 */
function commandTarget(command, env) {
  const expanded = expandEnv(command, env).trim();
  const split = splitCommandLine(expanded, () => false) || { file: '', args: '' };
  let exe = normalizeWinPath(split.file, env);
  const sysRoot = envGet(env, 'SystemRoot') || 'C:\\Windows';
  if (exe && !/[\\/]/.test(exe)) {
    const name = /\.exe$/i.test(exe) ? exe : `${exe}.exe`;
    if (name.toLowerCase() === 'powershell.exe') exe = P.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    else if (SYSTEM_TOOLS.has(name.toLowerCase())) exe = P.join(sysRoot, 'System32', name);
  }
  const args = split.args || '';
  const exeBase = P.basename(exe).toLowerCase();
  const host = SCRIPT_HOSTS.has(exeBase) ? exeBase : null;
  let payload = null;
  if (host === 'wscript.exe' || host === 'cscript.exe') {
    payload = (args.match(/"([^"]+\.(?:vbs|vbe|js|jse|wsf|wsh))"|(\S+\.(?:vbs|vbe|js|jse|wsf|wsh))/i) || []).slice(1).find(Boolean) || null;
  } else if (host === 'rundll32.exe') {
    const m = /^"?([^",]+?\.(?:dll|cpl|ocx|dat|tmp|bin|[a-z0-9]{1,4}))"?\s*,/i.exec(args.trim());
    payload = m ? m[1] : null;
  } else if (host === 'regsvr32.exe') {
    payload = (args.match(/"([^"]+\.(?:dll|ocx|sct))"|(\S+\.(?:dll|ocx|sct))/i) || []).slice(1).find(Boolean) || null;
  } else if (host === 'mshta.exe') {
    payload = (args.match(/"([^"]+)"|(\S+)/) || []).slice(1).find(Boolean) || null;
  }
  const remote = payload && /^[a-z]+:(?!\\)/i.test(payload);
  if (payload && !remote) payload = normalizeWinPath(payload, env);
  return { exe, args, host, payload, remote: !!remote, file: payload && !remote ? payload : exe };
}

/** Red flags inside a startup/task command line. */
function commandRedFlags(command) {
  const c = String(command || '');
  const flags = [];
  if (/powershell|pwsh/i.test(c) && /\s-(e|en|enc|enco|encod|encode|encoded|encodedcommand)\s+[a-z0-9+/=]{20,}/i.test(c)) flags.push('runs a hidden (encoded) PowerShell command');
  if (/powershell|pwsh/i.test(c) && /-w(indowstyle)?\s+h(idden)?/i.test(c)) flags.push('runs PowerShell in a hidden window');
  if (/(downloadstring|downloadfile|invoke-webrequest|\biwr\b|\birm\b|net\.webclient|start-bitstransfer)/i.test(c)) flags.push('downloads something from the internet');
  if (/(mshta|regsvr32|rundll32)[^\n]*(https?:|javascript:|vbscript:)/i.test(c)) flags.push('runs a script straight from the internet');
  if (/(\biex\b|invoke-expression)/i.test(c)) flags.push('executes code built at runtime');
  if (/certutil[^\n]*(-urlcache|-decode)/i.test(c)) flags.push('uses certutil to download or decode files');
  if (/bitsadmin[^\n]*\/transfer/i.test(c)) flags.push('uses bitsadmin to download files');
  if (/frombase64string/i.test(c)) flags.push('decodes hidden (Base64) data');
  return flags;
}

function sigState(sig) {
  if (!sig) return 'unknown';
  if (sig.exists === false) return 'missing';
  if (sig.status === 'Valid') return 'signed';
  if (sig.status === 'NotSigned') return 'unsigned';
  if (sig.status === 'HashMismatch' || sig.status === 'NotTrusted') return 'bad';
  return 'unknown';
}

function signerName(sig) {
  if (!sig) return '';
  const text = String(sig.signer || '');
  const m = /(?:^|,\s*)O="?([^",]+)"?/.exec(text) || /(?:^|,\s*)CN="?([^",]+)"?/.exec(text);
  return (m ? m[1] : sig.company || '').trim();
}

function isMicrosoftSigned(sig) {
  return sigState(sig) === 'signed' && /microsoft/i.test(signerName(sig) || sig.signer || '');
}

/** Describe a signature for people. */
function describeSig(sig) {
  const state = sigState(sig);
  if (state === 'signed') return `Signed by ${signerName(sig) || 'a trusted publisher'}`;
  if (state === 'unsigned') return 'Not digitally signed';
  if (state === 'missing') return 'File no longer exists';
  if (state === 'bad') return 'Signature is invalid or was tampered with';
  return 'Signature unknown';
}

function classifyIp(ip) {
  let a = String(ip ?? '').trim().toLowerCase();
  if (!a || a === '*') return 'none';
  a = a.replace(/^::ffff:/, '').replace(/%.*$/, '');
  if (a === '0.0.0.0' || a === '::') return 'any';
  if (/^127\./.test(a) || a === '::1') return 'loopback';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) {
    const [x, y] = a.split('.').map(Number);
    if (x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168)) return 'private';
    if (x === 100 && y >= 64 && y <= 127) return 'private';
    if (x === 169 && y === 254) return 'linklocal';
    if (x >= 224) return 'multicast';
    return 'public';
  }
  if (a.startsWith('fe80:')) return 'linklocal';
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return 'private';
  if (a.startsWith('ff')) return 'multicast';
  return 'public';
}

const IP_LABEL = { public: 'Internet', private: 'Local network', loopback: 'This PC', any: 'All networks', linklocal: 'Local network', multicast: 'Broadcast', none: '' };

function daysAgo(ms, now = Date.now()) {
  return ms ? Math.floor((now - ms) / 86_400_000) : null;
}

/** Build a finding with sane defaults. */
function finding(fields) {
  return {
    evidence: [],
    advice: '',
    fix: null,
    link: null,
    ...fields,
  };
}

module.exports = {
  P, SEVERITY_ORDER, CATEGORIES, asArray, sectionError, envGet, expandEnv, normalizeWinPath, pathKind, USER_WRITABLE, KIND_LABEL,
  commandTarget, commandRedFlags, sigState, signerName, isMicrosoftSigned, describeSig, classifyIp, IP_LABEL, daysAgo, finding,
};
