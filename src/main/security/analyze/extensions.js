'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { finding } = require('./common');

// Chromium "location" values from extensions settings.
const LOCATION = {
  1: 'store', 2: 'external', 3: 'external', 4: 'sideloaded', 5: 'builtin', 6: 'external',
  7: 'policy', 8: 'sideloaded', 9: 'policy', 10: 'builtin',
};
const SOURCE_LABEL = {
  store: 'Web store', external: 'Installed by another program', sideloaded: 'Loaded manually (developer mode)',
  policy: 'Forced by a policy', builtin: 'Built in', unknown: 'Unknown source',
};

const BROAD = /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*|\*:\/\/\*\/|file:\/\/\/\*)$/;

const CAPABILITIES = [
  ['debugger', 'Can take full control of web pages (debugger)', 3],
  ['proxy', 'Can route your traffic through another server', 3],
  ['nativeMessaging', 'Can talk to programs installed on your PC', 2],
  ['cookies', 'Can read your login cookies', 2],
  ['webRequest', 'Can see and change your web traffic', 2],
  ['webRequestBlocking', 'Can block or rewrite your web traffic', 2],
  ['management', 'Can install, disable or remove other extensions', 2],
  ['clipboardRead', 'Can read your clipboard', 2],
  ['history', 'Can read your browsing history', 1],
  ['downloads', 'Can manage your downloads', 1],
  ['privacy', 'Can change privacy settings', 1],
  ['desktopCapture', 'Can record your screen', 2],
  ['tabCapture', 'Can record your tabs', 1],
  ['declarativeNetRequestWithHostAccess', 'Can redirect the pages you visit', 1],
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function browserRoots(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return {
      chromium: [
        ['Google Chrome', path.join(local, 'Google', 'Chrome', 'User Data')],
        ['Microsoft Edge', path.join(local, 'Microsoft', 'Edge', 'User Data')],
        ['Brave', path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')],
        ['Vivaldi', path.join(local, 'Vivaldi', 'User Data')],
        ['Chromium', path.join(local, 'Chromium', 'User Data')],
        ['Opera', path.join(roaming, 'Opera Software', 'Opera Stable'), true],
        ['Opera GX', path.join(roaming, 'Opera Software', 'Opera GX Stable'), true],
      ],
      firefox: path.join(roaming, 'Mozilla', 'Firefox', 'Profiles'),
    };
  }
  if (platform === 'darwin') {
    const lib = path.join(home, 'Library', 'Application Support');
    return {
      chromium: [
        ['Google Chrome', path.join(lib, 'Google', 'Chrome')],
        ['Microsoft Edge', path.join(lib, 'Microsoft Edge')],
        ['Brave', path.join(lib, 'BraveSoftware', 'Brave-Browser')],
        ['Vivaldi', path.join(lib, 'Vivaldi')],
        ['Chromium', path.join(lib, 'Chromium')],
      ],
      firefox: path.join(lib, 'Firefox', 'Profiles'),
    };
  }
  const cfg = path.join(home, '.config');
  return {
    chromium: [
      ['Google Chrome', path.join(cfg, 'google-chrome')],
      ['Microsoft Edge', path.join(cfg, 'microsoft-edge')],
      ['Brave', path.join(cfg, 'BraveSoftware', 'Brave-Browser')],
      ['Vivaldi', path.join(cfg, 'vivaldi')],
      ['Chromium', path.join(cfg, 'chromium')],
      ['Opera', path.join(cfg, 'opera'), true],
    ],
    firefox: path.join(home, '.mozilla', 'firefox'),
  };
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function compareVersions(a, b) {
  const pa = a.split(/[._]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[._]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

/** Resolve "__MSG_name__" strings from the extension's locale files. */
function localize(value, dir, manifest) {
  const m = /^__MSG_(.+)__$/.exec(String(value || ''));
  if (!m) return value || '';
  const want = m[1].toLowerCase();
  for (const locale of [manifest.default_locale, 'en', 'en_US', 'en_GB'].filter(Boolean)) {
    const messages = readJson(path.join(dir, '_locales', locale, 'messages.json'));
    if (!messages) continue;
    const key = Object.keys(messages).find((k) => k.toLowerCase() === want);
    if (key && messages[key]?.message) return messages[key].message;
  }
  return value;
}

function iconDataUrl(dir, manifest) {
  const icons = manifest.icons || {};
  const sizes = Object.keys(icons).map(Number).filter(Boolean).sort((a, b) => a - b);
  const pick = sizes.find((s) => s >= 32) ?? sizes[sizes.length - 1];
  if (!pick) return null;
  const file = path.join(dir, String(icons[pick]).replace(/^\//, ''));
  try {
    const data = fs.readFileSync(file);
    if (data.length > 150_000) return null;
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

/** What an extension is able to do, in plain words, plus a 0-10 power score. */
function assess(permissions, hosts, contentMatches) {
  const perms = new Set(permissions.map(String));
  const broadHosts = hosts.some((h) => BROAD.test(h)) || perms.has('<all_urls>');
  const broadScripts = contentMatches.some((h) => BROAD.test(h));
  const caps = [];
  let score = 0;
  if (broadScripts) {
    caps.push('Runs code on every website (can see what you type)');
    score += 3;
  }
  if (broadHosts) {
    caps.push('Can read and change data on all websites');
    score += 3;
  }
  for (const [perm, label, weight] of CAPABILITIES) {
    if (perms.has(perm)) {
      caps.push(label);
      score += weight;
    }
  }
  return { caps, score: Math.min(score, 10), broad: broadHosts || broadScripts };
}

function riskOf(source, assessment, enabled) {
  if (source === 'builtin') return 'ok';
  if ((source === 'sideloaded' || source === 'policy') && assessment.broad) return 'danger';
  if (source === 'sideloaded' || source === 'policy') return 'warning';
  if (source === 'external' && assessment.broad) return 'warning';
  if (assessment.score >= 7) return 'notice';
  return enabled ? 'ok' : 'ok';
}

function chromiumExtensions(browser, root, isProfileDir) {
  const out = [];
  const profiles = isProfileDir ? [''] : listDirs(root).filter((n) => n === 'Default' || /^Profile \d+$/.test(n));
  for (const profile of profiles) {
    const profileDir = path.join(root, profile);
    const prefs = readJson(path.join(profileDir, 'Preferences')) || {};
    const secure = readJson(path.join(profileDir, 'Secure Preferences')) || {};
    const settings = { ...(prefs.extensions?.settings || {}), ...(secure.extensions?.settings || {}) };
    const profileName = prefs.profile?.name || profile || 'Default';
    const extRoot = path.join(profileDir, 'Extensions');
    const ids = new Set([...listDirs(extRoot), ...Object.keys(settings).filter((id) => settings[id]?.path && path.isAbsolute(settings[id].path))]);
    for (const id of ids) {
      const s = settings[id] || {};
      const source = LOCATION[s.location] || (s.from_webstore ? 'store' : 'unknown');
      if (source === 'builtin') continue;
      let dir = null;
      const versions = listDirs(path.join(extRoot, id)).sort(compareVersions);
      if (versions.length) dir = path.join(extRoot, id, versions[versions.length - 1]);
      else if (s.path && path.isAbsolute(s.path)) dir = s.path;
      if (!dir) continue;
      const manifest = readJson(path.join(dir, 'manifest.json'));
      if (!manifest || manifest.theme) continue;
      const permissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])].filter((p) => typeof p === 'string');
      const hosts = [...(manifest.host_permissions || []), ...permissions.filter((p) => p.includes('://') || p === '<all_urls>')];
      const contentMatches = (manifest.content_scripts || []).flatMap((c) => c.matches || []);
      const reasons = s.disable_reasons;
      const enabled = s.state === 0 ? false : !(Array.isArray(reasons) ? reasons.length : Number(reasons || 0));
      const assessment = assess(permissions, hosts, contentMatches);
      out.push({
        id: `${browser}|${profile}|${id}`,
        extensionId: id,
        browser,
        profile: profileName,
        name: localize(manifest.name, dir, manifest) || id,
        description: localize(manifest.description, dir, manifest) || '',
        version: manifest.version || '',
        source,
        sourceLabel: SOURCE_LABEL[source],
        enabled,
        installed: s.install_time ? Math.round(Number(s.install_time) / 1000 - 11_644_473_600_000) : null,
        capabilities: assessment.caps,
        power: assessment.score,
        risk: riskOf(source, assessment, enabled),
        folder: dir,
        icon: iconDataUrl(dir, manifest),
        storeUrl: source === 'store' ? (browser === 'Microsoft Edge'
          ? `https://microsoftedge.microsoft.com/addons/detail/${id}` : `https://chromewebstore.google.com/detail/${id}`) : null,
      });
    }
  }
  return out;
}

function firefoxExtensions(root) {
  const out = [];
  for (const profile of listDirs(root)) {
    const data = readJson(path.join(root, profile, 'extensions.json'));
    for (const a of data?.addons || []) {
      if (a.type !== 'extension' || !/^app-profile$|^app-global$/.test(a.location || '')) continue;
      const perms = a.userPermissions?.permissions || [];
      const origins = a.userPermissions?.origins || [];
      const assessment = assess(perms, origins, []);
      const source = a.signedState >= 2 || a.signedState === undefined ? 'store' : 'sideloaded';
      out.push({
        id: `Firefox|${profile}|${a.id}`,
        extensionId: a.id,
        browser: 'Firefox',
        profile: profile.replace(/^[a-z0-9]+\./, ''),
        name: a.defaultLocale?.name || a.id,
        description: a.defaultLocale?.description || '',
        version: a.version || '',
        source,
        sourceLabel: source === 'store' ? 'Firefox add-ons (signed)' : 'Unsigned add-on',
        enabled: !!a.active,
        installed: a.installDate || null,
        capabilities: assessment.caps,
        power: assessment.score,
        risk: riskOf(source, assessment, !!a.active),
        folder: a.path || '',
        icon: null,
        storeUrl: `https://addons.mozilla.org/firefox/addon/${encodeURIComponent(a.id)}/`,
      });
    }
  }
  return out;
}

/** Every browser extension installed for this user. */
function scanExtensions({ platform, env, home } = {}) {
  const roots = browserRoots(platform, env, home);
  const list = [];
  for (const [browser, root, isProfileDir] of roots.chromium) list.push(...chromiumExtensions(browser, root, isProfileDir));
  list.push(...firefoxExtensions(roots.firefox));
  return list;
}

/** Hack Check findings about browser extensions and browser policies. */
function extensionFindings(extensions) {
  const out = [];
  for (const e of extensions) {
    if (e.risk !== 'danger' && e.risk !== 'warning') continue;
    out.push(finding({
      id: `ext:${e.id}`,
      category: 'browser',
      severity: e.risk,
      title: `${e.browser}: "${e.name}" was ${e.source === 'policy' ? 'force-installed' : e.source === 'sideloaded' ? 'loaded outside the store' : 'added by another program'}`,
      summary: e.source === 'policy'
        ? 'Browser hijackers force-install extensions with policies so you can\'t remove them.'
        : 'Extensions that don\'t come from the official store are a common way to spy on browsing and steal logins.',
      evidence: [...e.capabilities.map((c) => `• ${c}`), `Folder: ${e.folder}`],
      advice: `If you didn't add it yourself, remove it from ${e.browser}'s extensions page and scan your PC.`,
    }));
  }
  const powerful = extensions.filter((e) => e.enabled && e.power >= 7 && e.risk === 'notice');
  if (powerful.length) {
    out.push(finding({
      id: 'ext:powerful',
      category: 'browser',
      severity: 'notice',
      title: `${powerful.length} extension${powerful.length > 1 ? 's' : ''} can read everything on the sites you visit`,
      summary: 'They come from the official store, but they could see passwords you type. Keep only ones you trust.',
      evidence: powerful.map((e) => `${e.browser}: ${e.name}`),
    }));
  }
  if (!out.length) {
    out.push(finding({
      id: 'ext:ok', category: 'browser', severity: 'ok',
      title: 'Browser extensions look fine',
      summary: `Checked ${extensions.length} extension${extensions.length === 1 ? '' : 's'} in Chrome, Edge, Brave, Opera, Vivaldi and Firefox.`,
    }));
  }
  return out;
}

module.exports = { scanExtensions, extensionFindings, assess, browserRoots };
