'use strict';

// opKapot's own file-scanning rules. Pure functions: the scan worker feeds
// them file names and bytes. They complement (not replace) Microsoft Defender:
// they look for tricks and techniques rather than known virus fingerprints.

const { RULES, EICAR, RANSOM_WORDS } = require('./rules');

const decode = (b64) => Buffer.from(b64, 'base64').toString('utf8');
const COMPILED = RULES.map(([id, severity, applies, title, why, pattern]) => ({
  id, severity, applies, title, why, re: new RegExp(decode(pattern), 'i'),
}));
const EICAR_TEXT = decode(EICAR[0]) + decode(EICAR[1]);
const RANSOM_RE = new RegExp(decode(RANSOM_WORDS), 'gi');

const EXEC = new Set(['exe', 'scr', 'com', 'pif', 'cpl', 'msi', 'dll', 'sys', 'jar']);
const SCRIPT = new Set(['ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'bat', 'cmd', 'py', 'pyw', 'sct']);
const DISGUISE = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'mp3', 'mp4', 'avi', 'mkv', 'mov', 'wav', 'csv', 'odt']);
const MACRO_DOCS = new Set(['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'ppsm']);
const NOTE_EXT = new Set(['txt', 'html', 'htm', 'hta', 'url', 'rtf']);
const RANSOM_NAME = /^(how[_ -]?to[_ -]?(decrypt|restore|recover|back ?up)|readme[_ -]?(for|to)?[_ -]?(decrypt|restore|recover)|_readme$|decrypt[_ -]?(instructions?|info|files|me)|restore[_ -]?(my[_ -]?)?files|!+\s*read[_ -]?me|recover[_ -]?(your[_ -]?)?files|your[_ -]?files[_ -]?are[_ -]?encrypted|help[_ -]?decrypt|#?decrypt[_ -]?my[_ -]?files|how[_ -]?to[_ -]?get[_ -]?(your[_ -]?)?data)/i;
const SYSTEM_NAMES = new Set([
  'svchost.exe', 'lsass.exe', 'csrss.exe', 'winlogon.exe', 'services.exe', 'smss.exe', 'wininit.exe', 'spoolsv.exe',
  'taskhostw.exe', 'dwm.exe', 'conhost.exe', 'rundll32.exe', 'lsm.exe', 'explorer.exe', 'dllhost.exe', 'sihost.exe',
  'ctfmon.exe', 'fontdrvhost.exe', 'searchindexer.exe', 'runtimebroker.exe', 'audiodg.exe', 'wuauclt.exe', 'regsvr32.exe',
]);

const SCRIPT_BYTES = 512 * 1024;

function baseName(file) {
  return String(file).split(/[\\/]/).pop();
}

function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase().trim() : '';
}

function hit(id, severity, title, why = '') {
  return { id, severity, title, why };
}

/** Checks that only need the file's name and location. */
function nameHits(file) {
  const hits = [];
  const name = baseName(file);
  const lower = name.toLowerCase();
  const ext = extOf(lower);
  const where = String(file).toLowerCase().replace(/\//g, '\\');

  if (name.includes('\u202e')) {
    hits.push(hit('rtlo', 'high', 'Hides its real file type with a special character', 'The name uses a right-to-left character so a program can look like a text file or picture.'));
  }
  if (/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|gif|txt|rtf|mp3|mp4|avi|mkv|mov|zip|rar|7z)[\s._-]*\.(exe|scr|com|pif|bat|cmd|vbs|vbe|js|jse|wsf|hta|lnk|ps1|msi|jar|cpl)$/i.test(name)) {
    hits.push(hit('double-ext', 'high', 'Fake file extension', `"${name}" pretends to be a document or picture but is really a program.`));
  } else if (/\s{6,}\.(exe|scr|com|pif|bat|cmd|vbs|js|hta|lnk)$/i.test(name)) {
    hits.push(hit('padded-ext', 'high', 'Hides its real file type behind spaces', 'Long runs of spaces push the real extension out of sight in Explorer.'));
  }
  if (ext === 'exe' && SYSTEM_NAMES.has(lower) && !/^[a-z]:\\windows\\/.test(where)
      && !/\\(windows\.old|\$windows\.~bt|\$windows\.~ws|winsxs|windows kits|servicing|\$recycle\.bin)\\/.test(where)) {
    hits.push(hit('fake-system', 'high', 'Fake Windows system file', `The real ${lower} only lives in the Windows folder. Malware copies the name to hide.`));
  }
  if (/\\start menu\\programs\\startup\\/.test(where) && (EXEC.has(ext) || SCRIPT.has(ext))) {
    hits.push(hit('startup-file', 'medium', 'Starts automatically when you sign in', 'Programs and scripts placed directly in the Startup folder run every time you sign in.'));
  }
  if (['scr', 'pif', 'com', 'cpl'].includes(ext) && /\\(downloads|desktop|temp|appdata)\\/.test(where)) {
    hits.push(hit('rare-exec', 'medium', `Unusual .${ext} program`, `.${ext} files are rarely used by legitimate software today but are a common way to spread malware.`));
  }
  return hits;
}

/** Which content checks a file needs, and how many bytes to read for them. */
function contentPlan(file, size) {
  const name = baseName(file);
  const ext = extOf(name);
  const stem = name.replace(/\.[^.]+$/, '');
  const checks = [];
  let bytes = 0;
  const need = (check, n) => {
    checks.push(check);
    bytes = Math.max(bytes, n);
  };
  if (size >= 68 && size <= 512) need('eicar', size);
  if (SCRIPT.has(ext) && size <= 5 * 1024 * 1024) need('script', Math.min(size, SCRIPT_BYTES));
  if (ext === 'lnk' && size <= 256 * 1024) need('lnk', size);
  if (ext === 'url' && size <= 16 * 1024) need('url', size);
  if (ext === 'reg' && size <= 2 * 1024 * 1024) need('reg', size);
  if (DISGUISE.has(ext) && size >= 64) need('disguise', 2);
  if (NOTE_EXT.has(ext) && RANSOM_NAME.test(stem) && size <= 64 * 1024) need('ransom', size);
  if (MACRO_DOCS.has(ext)) checks.push('macro');
  return checks.length ? { checks, bytes } : null;
}

/** Decode script text, handling UTF-16 files. */
function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  let zeros = 0;
  for (let i = 1; i < Math.min(buf.length, 400); i += 2) if (buf[i] === 0) zeros++;
  if (zeros > 60) return buf.toString('utf16le');
  return buf.toString('utf8');
}

function ruleHits(text, applies) {
  const hits = [];
  for (const r of COMPILED) {
    if (r.applies === applies && r.re.test(text)) hits.push(hit(r.id, r.severity, r.title, r.why));
  }
  return hits;
}

/** Checks on the file's bytes, as chosen by contentPlan(). */
function contentHits(file, buf, checks) {
  const hits = [];
  const ext = extOf(baseName(file));
  for (const check of checks) {
    if (check === 'eicar') {
      if (buf.toString('latin1').startsWith(EICAR_TEXT)) {
        hits.push(hit('eicar', 'high', 'EICAR antivirus test file', 'This is the harmless file everyone uses to test antivirus software. It is not a real virus.'));
      }
    } else if (check === 'disguise') {
      if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) {
        hits.push(hit('disguised-exe', 'high', `Program disguised as a .${ext} file`, 'The file is really a Windows program even though its name says otherwise.'));
      }
    } else if (check === 'script') {
      hits.push(...ruleHits(decodeText(buf), 'script'));
    } else if (check === 'lnk') {
      hits.push(...ruleHits(`${buf.toString('utf16le')}\n${buf.toString('latin1')}`, 'lnk'));
    } else if (check === 'url') {
      hits.push(...ruleHits(buf.toString('latin1'), 'url'));
    } else if (check === 'reg') {
      hits.push(...ruleHits(decodeText(buf), 'reg'));
    } else if (check === 'ransom') {
      const words = new Set((decodeText(buf).match(RANSOM_RE) || []).map((w) => w.toLowerCase()));
      if (words.size >= 2) {
        hits.push(hit('ransom-note', 'high', 'Ransomware note', 'This looks like a ransom demand. Disconnect from the internet, don\'t pay, and restore your files from a backup.'));
      }
    }
  }
  return hits;
}

/** Parse an NTFS Zone.Identifier stream (where a download came from). */
function parseZone(text) {
  if (!text) return null;
  const zone = /ZoneId\s*=\s*(\d+)/i.exec(text);
  const url = /HostUrl\s*=\s*(\S+)/i.exec(text);
  const ref = /ReferrerUrl\s*=\s*(\S+)/i.exec(text);
  return { zone: zone ? Number(zone[1]) : null, url: url ? url[1] : '', referrer: ref ? ref[1] : '' };
}

function severityOf(hits) {
  if (hits.some((h) => h.severity === 'high')) return 'danger';
  if (hits.some((h) => h.severity === 'medium')) return 'warning';
  return 'notice';
}

module.exports = { nameHits, contentPlan, contentHits, parseZone, severityOf, extOf, baseName, EXEC, SCRIPT, MACRO_DOCS };
