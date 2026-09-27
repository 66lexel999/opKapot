'use strict';

// Finds installed games (Steam, EA app, Epic) and guesses each game's main .exe.

const fs = require('node:fs');
const path = require('node:path');
const { asObjects, str } = require('../security/analyze/common');
const { PRESETS, FC_PROCESS } = require('./knowledge');

const P = path.win32;
// Files are read with the host's path rules (Windows in real use, POSIX in tests).
const norm = (p) => (process.platform === 'win32' ? String(p).replace(/\//g, '\\') : String(p));

// Executables that are never the game itself.
const HELPER_EXE = /(unins|setup|install|crash|report|redist|vcredist|vc_redist|dxsetup|directx|dotnet|ue4prereq|ue5prereq|prereq|anticheat|easyanticheat|eaanticheat|battleye|touchup|cleanup|helper|update|patch|cef|webhelper|overlay|benchmark|config|settings|launcher|activation|register|server|editor|tool|sdk|capture|(^|[^a-z])vr([^a-z]|$))/i;

/** Tiny parser for Valve's KeyValues (.vdf / .acf) files. */
function parseVdf(text) {
  const root = {};
  const stack = [root];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let key = null;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const top = stack[stack.length - 1];
    if (m[2] === '{') {
      const obj = {};
      if (key != null) top[key] = obj;
      stack.push(obj);
      key = null;
    } else if (m[2] === '}') {
      if (stack.length > 1) stack.pop();
      key = null;
    } else if (key == null) {
      key = m[1].replace(/\\\\/g, '\\');
    } else {
      top[key] = m[1].replace(/\\\\/g, '\\');
      key = null;
    }
  }
  return root;
}

function listExes(dir, depth = 2, out = [], budget = { n: 600 }) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (budget.n-- <= 0) break;
    const full = path.join(dir, e.name);
    if (e.isFile() && /\.exe$/i.test(e.name)) {
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch { /* ignore */ }
      out.push({ path: full, name: e.name, size, depth });
    } else if (e.isDirectory() && depth > 0 && !/^(_commonredist|redist|support|directx|dotnet|__installer|installer|tools?|docs?|prereq.*)$/i.test(e.name)) {
      listExes(full, depth - 1, out, budget);
    }
  }
  return out;
}

const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w.length > 1);

/** The most likely main executable in a game folder. */
function guessExe(dir, name) {
  const exes = listExes(dir).filter((e) => !HELPER_EXE.test(e.name));
  if (!exes.length) return '';
  const want = new Set(words(name));
  const score = (e) => {
    const w = words(e.name.replace(/\.exe$/i, ''));
    const overlap = w.filter((x) => want.has(x)).length;
    const fc = FC_PROCESS.test(e.name.replace(/\.exe$/i, '')) ? 5 : 0;
    return overlap * 3 + fc + (e.depth === 2 ? 1 : 0) + Math.log10(1 + e.size / 1e6);
  };
  return exes.sort((a, b) => score(b) - score(a))[0].path;
}

function launchersFor(dir) {
  const d = String(dir || '').toLowerCase();
  if (d.includes('\\steamapps\\')) return ['steam'];
  if (d.includes('\\epic games\\')) return ['epic'];
  if (d.includes('\\ubisoft')) return ['ubisoft'];
  if (d.includes('\\riot games\\')) return ['riot'];
  if (d.includes('\\windowsapps\\') || d.includes('\\xboxgames\\')) return ['xbox'];
  return [];
}

function steamGames(steamDir) {
  if (!steamDir) return [];
  const root = norm(steamDir);
  const libs = new Set([root]);
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    const folders = vdf.libraryfolders || vdf.LibraryFolders || {};
    for (const v of Object.values(folders)) {
      const p = typeof v === 'string' ? v : v?.path;
      if (p && (/^[a-z]:/i.test(p) || p.startsWith('/'))) libs.add(norm(p));
    }
  } catch { /* single library */ }
  const out = [];
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try {
      files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const st = parseVdf(fs.readFileSync(path.join(apps, file), 'utf8')).AppState || {};
        const name = str(st.name);
        if (!name || /redistributable|steamworks|proton|runtime|dedicated server|soundtrack|sdk/i.test(name) || st.appid === '228980') continue;
        const dir = path.join(apps, 'common', str(st.installdir));
        out.push({ id: `steam:${st.appid}`, name, dir, platform: 'Steam', launchers: ['steam'] });
      } catch { /* skip */ }
    }
  }
  return out;
}

function epicGames(programData) {
  const dir = path.join(programData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /\.item$/i.test(f));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (Array.isArray(m.AppCategories) && !m.AppCategories.includes('games')) continue;
      const loc = str(m.InstallLocation);
      out.push({
        id: `epic:${str(m.AppName) || f}`,
        name: str(m.DisplayName) || str(m.AppName),
        dir: loc,
        exe: loc && str(m.LaunchExecutable) ? path.join(loc, norm(m.LaunchExecutable)) : '',
        platform: 'Epic Games',
        launchers: ['epic'],
      });
    } catch { /* skip */ }
  }
  return out;
}

/** Everything we can find, merged and de-duplicated by folder. */
function detectGames(raw, { programData, exists = fs.existsSync } = {}) {
  const found = [
    ...steamGames(str(raw?.steam)),
    ...epicGames(programData),
    ...asObjects(raw?.ea).filter((g) => str(g.dir)).map((g) => ({ id: `ea:${str(g.name)}`, name: str(g.displayName) || str(g.name), dir: str(g.dir), platform: 'EA app', launchers: ['ea'] })),
    ...asObjects(raw?.uninstall).filter((g) => str(g.dir) && str(g.name)).map((g) => {
      const ea = /electronic arts|ea sports/i.test(str(g.publisher));
      const l = launchersFor(g.dir);
      return { id: `reg:${str(g.key)}`, name: str(g.name), dir: str(g.dir), platform: ea ? 'EA app' : l[0] === 'steam' ? 'Steam' : l[0] === 'epic' ? 'Epic Games' : str(g.publisher), launchers: ea ? ['ea', ...l] : l };
    }),
  ];
  const byDir = new Map();
  for (const g of found) {
    const key = g.dir.toLowerCase().replace(/\\+$/, '');
    if (!key || !exists(g.dir)) continue;
    const prev = byDir.get(key);
    if (prev) {
      prev.launchers = [...new Set([...prev.launchers, ...g.launchers])];
      if (!prev.exe && g.exe) prev.exe = g.exe;
    } else {
      byDir.set(key, { ...g, launchers: [...g.launchers] });
    }
  }
  const games = [...byDir.values()];
  for (const g of games) {
    if (!g.exe) g.exe = guessExe(g.dir, g.name);
    // EA SPORTS FC always runs through the EA app, whichever store sold it.
    if (/\bFC\b|FIFA/i.test(g.name) && /EA SPORTS|FIFA/i.test(g.name) && !g.launchers.includes('ea')) g.launchers.unshift('ea');
  }
  return games.filter((g) => g.exe).sort((a, b) => a.name.localeCompare(b.name));
}

/** A game description the rest of Game Mode understands. */
function gameProfile(g) {
  const exeName = P.basename(str(g.exe));
  const procs = [...new Set([...(g.processes || []), exeName.replace(/\.exe$/i, '')].filter(Boolean))];
  return { id: g.id, name: g.name, exe: g.exe || '', processes: procs, launchers: [...new Set(g.launchers || [])], platform: g.platform || '' };
}

/** The FC 27 preset, filled in with the real install when we found one. */
function presetProfiles(games) {
  return PRESETS.map((p) => {
    const installed = games.find((g) => p.process.test(P.basename(str(g.exe)).replace(/\.exe$/i, '')));
    return {
      id: p.id,
      name: p.name,
      exe: installed?.exe || '',
      processes: p.exe.map((e) => e.replace(/\.exe$/i, '')),
      launchers: [...new Set([...p.launchers, ...(installed?.launchers || [])])],
      platform: installed?.platform || 'EA app',
      installed: !!installed,
      note: p.note,
      preset: true,
    };
  });
}

module.exports = { parseVdf, guessExe, detectGames, gameProfile, presetProfiles, launchersFor, HELPER_EXE };
