'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const net = require('../src/main/game/net');
const { buildPlan, parseTasklist } = require('../src/main/game/plan');
const { parseVdf, guessExe, detectGames, presetProfiles } = require('../src/main/game/games');
const { tcpPing, bestOf, transfer } = require('../src/main/game/probe');
const { GameService } = require('../src/main/game/service');
const { SecurityService } = require('../src/main/security/service');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opk-game-'));

// ------------------------------------------------------------ statistics ---

test('ping statistics: average, jitter, loss and spikes', () => {
  const s = net.pingStats([10, 12, 11, -1, 10, 80, 11]);
  assert.equal(s.count, 7);
  assert.equal(s.lost, 1);
  assert.equal(s.loss, 14.3);
  assert.equal(s.min, 10);
  assert.equal(s.max, 80);
  assert.equal(s.median, 11);
  assert.equal(s.spikes, 1);
  assert.ok(s.jitter > 20);
  assert.deepEqual(net.pingStats([-1, -1]).avg, null);
  assert.equal(net.pingStats([]).loss, 100);
});

test('bufferbloat grades follow common test scales', () => {
  assert.deepEqual(net.bufferbloat(20, 22), { increase: 2, grade: 'A+' });
  assert.equal(net.bufferbloat(20, 45).grade, 'A');
  assert.equal(net.bufferbloat(20, 70).grade, 'B');
  assert.equal(net.bufferbloat(20, 150).grade, 'C');
  assert.equal(net.bufferbloat(20, 500).grade, 'F');
  assert.equal(net.bufferbloat(null, 50), null);
});

test('Wi-Fi details are read from netsh in any language', () => {
  const en = net.parseWifi(['    SSID                   : Home', '    State                  : connected', '    Radio type             : 802.11ax', '    Band                   : 5 GHz', '    Channel                : 44', '    Signal                 : 91%']);
  assert.deepEqual(en, { ssid: 'Home', connected: true, signal: 91, radio: '802.11ax', band: '5', channel: 44 });
  const de = net.parseWifi(['    SSID                   : Heim', '    Status                 : Verbunden', '    Kanal                  : 6', '    Signal                 : 40 %']);
  assert.equal(de.signal, 40);
  assert.equal(de.band, '2.4', 'channel 6 means 2.4 GHz');
  assert.equal(net.parseWifi([]), null);
});

test('connection info picks the adapter that carries internet traffic', () => {
  const info = net.connectionInfo({
    adapters: [
      { name: 'Ethernet', description: 'Realtek PCIe GbE Family Controller', index: 5, media: '802.3', receiveBps: 1e9, hardware: true },
      { name: 'NordLynx', description: 'NordLynx Tunnel', index: 9, hardware: false },
    ],
    defaultRoutes: [{ index: 5, nextHop: '192.168.0.1', metric: 25 }, { index: 9, nextHop: '0.0.0.0', metric: 5 }],
    dns: [{ index: 5, servers: ['1.1.1.1', '8.8.8.8'] }],
    traffic: [{ name: 'Ethernet', rxBps: 12e6, txBps: 1e5 }],
    processes: [{ name: 'steam' }, { name: 'explorer' }, { name: 'OneDrive' }],
  });
  assert.equal(info.type, 'ethernet');
  assert.equal(info.gateway, '192.168.0.1');
  assert.equal(info.adapter.linkMbps, 1000);
  assert.deepEqual(info.dns, ['1.1.1.1', '8.8.8.8']);
  assert.deepEqual(info.vpn, ['NordLynx Tunnel']);
  assert.equal(info.background.rxMbps, 12);
  assert.deepEqual(info.hogs, ['steam', 'OneDrive']);
});

// ------------------------------------------------------------- diagnosis ---

const steady = (avg) => ({ avg, loss: 0, jitter: 1, p95: avg + 2, spikes: 0, max: avg + 3 });

test('diagnosis blames the home network when the router link is unstable', () => {
  const f = net.diagnose({ info: { type: 'wifi', wifi: { signal: 45, band: '2.4', channel: 6 }, gateway: '192.168.1.1' }, router: { avg: 14, loss: 4, jitter: 18, p95: 90, max: 120 }, internet: { avg: 40, loss: 4, jitter: 20, p95: 120, spikes: 3, max: 150 } });
  const ids = f.map((x) => x.id);
  assert.equal(ids[0], 'local');
  assert.ok(!ids.includes('isp'), 'the internet line is not blamed when the router link is already bad');
  assert.ok(ids.includes('wifi-signal') && ids.includes('wifi-band'));
});

test('diagnosis blames the internet line when only the far side is unstable', () => {
  const f = net.diagnose({ info: { type: 'ethernet', gateway: '192.168.1.1' }, router: steady(1), internet: { avg: 35, loss: 3, jitter: 25, p95: 90, spikes: 2, max: 140 } });
  assert.equal(f[0].id, 'isp');
  assert.equal(f[0].severity, 'danger');
});

test('diagnosis spots bufferbloat, background downloads and VPNs', () => {
  const f = net.diagnose({
    info: { type: 'ethernet', gateway: '10.0.0.1', background: { rxMbps: 20, txMbps: 0.2 }, hogs: ['steam'], vpn: ['WireGuard Tunnel'] },
    router: steady(1), internet: steady(20), loaded: steady(180), speed: { download: 200, upload: 20 },
  });
  const byId = Object.fromEntries(f.map((x) => [x.id, x]));
  assert.equal(byId.bufferbloat.severity, 'danger');
  assert.match(byId.bufferbloat.title, /160 ms/);
  assert.equal(byId.background.severity, 'danger');
  assert.equal(byId.vpn.severity, 'warning');
});

test('a healthy connection gets a clean bill of health', () => {
  const f = net.diagnose({ info: { type: 'ethernet', gateway: '10.0.0.1', background: { rxMbps: 0, txMbps: 0 }, hogs: [], vpn: [] }, router: steady(1), internet: steady(12), loaded: steady(16), regions: [{ name: 'London', ms: 14 }], speed: { download: 300, upload: 50 } });
  assert.deepEqual(f.map((x) => x.id), ['ok']);
});

// ------------------------------------------------------------ Game Mode ---

const proc = (pid, name, p, extra = {}) => ({ pid, name, path: p, window: false, memory: 1e8, company: '', description: '', parent: 0, ...extra });

test('Game Mode keeps the game, its launchers, drivers and Windows', () => {
  const processes = [
    proc(10, 'explorer', 'C:\\Windows\\explorer.exe'),
    proc(11, 'FC27', 'D:\\Games\\EA SPORTS FC 27\\FC27.exe', { window: true }),
    proc(12, 'EAAntiCheat.GameServiceLauncher', 'D:\\Games\\EA SPORTS FC 27\\EAAntiCheat.GameServiceLauncher.exe', { parent: 11 }),
    proc(13, 'EADesktop', 'C:\\Program Files\\Electronic Arts\\EA Desktop\\EADesktop.exe'),
    proc(14, 'steam', 'C:\\Program Files (x86)\\Steam\\steam.exe', { window: true }),
    proc(15, 'steamwebhelper', 'C:\\Program Files (x86)\\Steam\\bin\\steamwebhelper.exe', { parent: 14 }),
    proc(16, 'Discord', 'C:\\Users\\a\\AppData\\Local\\Discord\\Discord.exe', { window: true }),
    proc(17, 'chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', { window: true }),
    proc(18, 'nvcontainer', 'C:\\Program Files\\NVIDIA Corporation\\NvContainer\\nvcontainer.exe'),
    proc(19, 'SynTPEnh', 'C:\\Program Files\\Synaptics\\SynTP\\SynTPEnh.exe', { company: 'Synaptics Incorporated' }),
    proc(20, 'MsMpEng', 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform\\MsMpEng.exe'),
    proc(21, 'opKapot Uninstaller', 'C:\\Tools\\opKapot.exe'),
    proc(22, 'OneDrive', 'C:\\Users\\a\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe'),
  ];
  const services = [{ name: 'wuauserv', canStop: true }, { name: 'SysMain', canStop: true }, { name: 'Audiosrv', canStop: true }, { name: 'GoogleUpdaterService128.0', canStop: true }];
  const plan = buildPlan({
    processes, services, launchers: ['ea'], selfPaths: ['C:\\Tools\\opKapot.exe'],
    game: { name: 'EA SPORTS FC 27', exe: 'D:\\Games\\EA SPORTS FC 27\\FC27.exe', processes: ['FC27'] },
  });
  assert.deepEqual(plan.apps.map((a) => a.name).sort(), ['chrome', 'Discord', 'OneDrive', 'steam'].sort());
  const steam = plan.apps.find((a) => a.name === 'steam');
  assert.deepEqual(steam.pids, [14, 15], 'helpers are grouped under the app that started them');
  assert.deepEqual(steam.targets.map((t) => t.path), [processes[4].path, processes[5].path], 'each process is closed by its own path');
  assert.equal(plan.apps.find((a) => a.name === 'Discord').checked, false, 'voice chat is kept by default');
  assert.equal(plan.gameRunning, true);
  assert.deepEqual(plan.gamePids, [11]);
  assert.deepEqual(plan.services.map((s) => [s.name, s.checked]), [['wuauserv', true], ['SysMain', false], ['GoogleUpdaterService128.0', true]]);
  assert.ok(plan.kept.some((k) => k.name === 'EAAntiCheat.GameServiceLauncher'), 'anti-cheat stays');
  assert.ok(plan.kept.some((k) => k.name === 'SynTPEnh' && k.why === 'Hardware software'));
});

test('Steam is kept when the game needs it', () => {
  const plan = buildPlan({
    processes: [proc(14, 'steam', 'C:\\Steam\\steam.exe'), proc(15, 'steamwebhelper', 'C:\\Steam\\bin\\steamwebhelper.exe', { parent: 14 })],
    services: [], launchers: ['ea', 'steam'], game: { name: 'FC', processes: ['FC27'] },
  });
  assert.deepEqual(plan.apps, []);
});

test('tasklist output is parsed in any language', () => {
  const out = '\r\n"FC27.exe","4242","Console","1","6,210,344 K"\r\n"steam.exe","880","Console","1","120,000 K"\r\nINFO: rien\r\n';
  assert.deepEqual(parseTasklist(out), [{ name: 'FC27', pid: 4242 }, { name: 'steam', pid: 880 }]);
});

// ------------------------------------------------------ game detection ---

test('Valve KeyValues files are parsed', () => {
  const v = parseVdf('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1" { "path" "D:\\\\SteamLibrary" }\n}');
  assert.equal(v.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
  assert.equal(v.libraryfolders['1'].path, 'D:\\SteamLibrary');
});

test('the main game exe is picked over helpers', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'FC27.exe'), Buffer.alloc(3000));
  fs.writeFileSync(path.join(dir, 'unins000.exe'), Buffer.alloc(9000));
  fs.writeFileSync(path.join(dir, 'EAAntiCheat.Installer.exe'), Buffer.alloc(9000));
  fs.mkdirSync(path.join(dir, '__Installer'));
  fs.writeFileSync(path.join(dir, '__Installer', 'Touchup.exe'), Buffer.alloc(9000));
  assert.equal(path.basename(guessExe(dir, 'EA SPORTS FC 27')), 'FC27.exe');
});

test('installed games are found in Steam libraries and Epic manifests', () => {
  const root = tmp();
  const steam = path.join(root, 'Steam');
  const apps = path.join(steam, 'steamapps');
  fs.mkdirSync(path.join(apps, 'common', 'EA SPORTS FC 27'), { recursive: true });
  fs.writeFileSync(path.join(apps, 'common', 'EA SPORTS FC 27', 'FC27.exe'), Buffer.alloc(100));
  fs.writeFileSync(path.join(apps, 'libraryfolders.vdf'), '"libraryfolders" { }');
  fs.writeFileSync(path.join(apps, 'appmanifest_1.acf'), '"AppState" { "appid" "1" "name" "EA SPORTS FC 27" "installdir" "EA SPORTS FC 27" }');
  fs.writeFileSync(path.join(apps, 'appmanifest_228980.acf'), '"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" "installdir" "Steamworks Shared" }');
  const pd = path.join(root, 'ProgramData');
  const manifests = path.join(pd, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  fs.mkdirSync(manifests, { recursive: true });
  const rl = path.join(root, 'rocketleague');
  fs.mkdirSync(rl);
  fs.writeFileSync(path.join(manifests, 'a.item'), JSON.stringify({ DisplayName: 'Rocket League', AppName: 'Sugar', InstallLocation: rl, LaunchExecutable: 'Binaries\\Win64\\RocketLeague.exe', AppCategories: ['games'] }));
  // detectGames uses Windows paths; on other systems map them back to the temp folder.
  const games = detectGames({ steam }, { programData: pd, exists: () => true });
  const names = games.map((g) => g.name);
  assert.ok(names.includes('Rocket League'));
  if (process.platform === 'win32') {
    const fc = games.find((g) => g.name === 'EA SPORTS FC 27');
    assert.deepEqual(fc.launchers, ['ea', 'steam'], 'FC on Steam needs both the EA app and Steam');
    assert.equal(presetProfiles(games)[0].installed, true);
  }
  assert.ok(!names.some((n) => /Redistributable/.test(n)));
});

// ---------------------------------------------------------------- probes ---

test('TCP ping and the speed test measure a local server', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/__down')) {
      res.writeHead(200);
      const chunk = Buffer.alloc(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 20e6) {
          sent += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      pump();
    } else {
      req.resume();
      req.on('end', () => res.end('ok'));
    }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  try {
    const t = await tcpPing('127.0.0.1', port, { count: 3, gapMs: 0 });
    assert.equal(t.samples.length, 3);
    assert.ok(bestOf(t.samples) >= 0);
    const closed = await tcpPing('127.0.0.1', 1, { count: 1, timeoutMs: 500, gapMs: 0 });
    assert.deepEqual(closed.samples, [-1]);
    const down = await transfer({ base: `http://127.0.0.1:${port}`, direction: 'down', seconds: 1.5, streams: 2 });
    const up = await transfer({ base: `http://127.0.0.1:${port}`, direction: 'up', seconds: 1.5, streams: 2 });
    assert.ok(down.mbps > 10 && up.mbps > 10, `${down.mbps} / ${up.mbps}`);
  } finally {
    srv.close();
  }
});

// ------------------------------------------------------- whole service ---

test('demo PC: Game Mode on and off restores everything', async () => {
  const dir = tmp();
  const actions = [];
  const sec = new SecurityService({ demo: true, userDataDir: dir, backupDir: dir, trash: async () => {}, getSettings: () => ({}), addHistory: () => {} });
  const modes = [];
  const game = new GameService({ demo: true, userDataDir: dir, runAction: (a) => { actions.push(a.type); return sec.runAction(a); }, onModeChange: (on) => modes.push(on) });
  const plan = await game.plan();
  assert.equal(plan.game.name, 'EA SPORTS FC 27');
  const on = await game.enable({ apps: plan.apps.filter((a) => a.checked).map((a) => a.id), services: plan.services.filter((s) => s.checked).map((s) => s.name) });
  assert.ok(on.ok);
  assert.ok(game.status().active.closed > 0);
  await assert.rejects(game.enable({}), /already on/);
  const off = await game.disable();
  assert.ok(off.ok);
  assert.equal(game.status().active, null);
  assert.deepEqual(modes, [true, false]);
  assert.deepEqual(actions, ['close-apps', 'services-stop', 'power-high', 'services-start', 'power-restore', 'reopen-apps']);
});

test('choosing FC always keeps the EA app', () => {
  const dir = tmp();
  const game = new GameService({ demo: true, userDataDir: dir, runAction: async () => ({ ok: true }) });
  const g = game.select({ name: 'FC 27', exe: 'C:\\Steam\\steamapps\\common\\FC\\FC27.exe', launchers: ['steam'] });
  assert.deepEqual(g.launchers, ['ea', 'steam']);
  assert.throws(() => game.select({ name: '', exe: '' }), /Choose a game|no program/);
});
