'use strict';

// Sample data for --demo: a gaming PC on so-so Wi-Fi with Steam updating in the background.

const LOCAL = 'C:\\Users\\You\\AppData\\Local';
const ROAMING = 'C:\\Users\\You\\AppData\\Roaming';
const PF = 'C:\\Program Files';
const PF86 = 'C:\\Program Files (x86)';

let pid = 4000;
const proc = (name, path, extra = {}) => ({ pid: pid++, name, path, window: false, title: '', memory: 50e6, company: '', description: '', parent: 0, ...extra });

function processes({ gameRunning = false } = {}) {
  pid = 4000;
  const list = [
    proc('explorer', 'C:\\Windows\\explorer.exe', { window: true, memory: 180e6 }),
    proc('SecurityHealthSystray', 'C:\\Windows\\System32\\SecurityHealthSystray.exe'),
    proc('opKapot Uninstaller', `${LOCAL}\\Temp\\opKapot\\opKapot Uninstaller.exe`, { window: true }),
    proc('EADesktop', `${PF}\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe`, { window: true, memory: 310e6, company: 'Electronic Arts', description: 'EA app' }),
    proc('EABackgroundService', `${PF}\\Electronic Arts\\EA Desktop\\EA Desktop\\EABackgroundService.exe`, { company: 'Electronic Arts' }),
    proc('steam', `${PF86}\\Steam\\steam.exe`, { window: true, memory: 140e6, company: 'Valve Corporation', description: 'Steam' }),
    proc('steamwebhelper', `${PF86}\\Steam\\bin\\cef\\cef.win7x64\\steamwebhelper.exe`, { memory: 260e6, company: 'Valve Corporation', parent: 4005 }),
    proc('Discord', `${LOCAL}\\Discord\\app-1.0.9212\\Discord.exe`, { window: true, memory: 420e6, company: 'Discord Inc.', description: 'Discord' }),
    proc('chrome', `${PF}\\Google\\Chrome\\Application\\chrome.exe`, { window: true, title: 'EA SPORTS FC 27 Team of the Week - Google Chrome', memory: 380e6, company: 'Google LLC', description: 'Google Chrome' }),
    proc('chrome', `${PF}\\Google\\Chrome\\Application\\chrome.exe`, { memory: 610e6, company: 'Google LLC', description: 'Google Chrome' }),
    proc('chrome', `${PF}\\Google\\Chrome\\Application\\chrome.exe`, { memory: 290e6, company: 'Google LLC', description: 'Google Chrome' }),
    proc('OneDrive', `${LOCAL}\\Microsoft\\OneDrive\\OneDrive.exe`, { memory: 120e6, company: 'Microsoft Corporation', description: 'Microsoft OneDrive' }),
    proc('Spotify', `${ROAMING}\\Spotify\\Spotify.exe`, { window: true, memory: 330e6, company: 'Spotify Ltd', description: 'Spotify' }),
    proc('ms-teams', `${PF}\\WindowsApps\\MSTeams_24295.605.3225.8804_x64__8wekyb3d8bbwe\\ms-teams.exe`, { memory: 290e6, company: 'Microsoft Corporation', description: 'Microsoft Teams' }),
    proc('CCXProcess', `${PF86}\\Adobe\\Adobe Creative Cloud Experience\\CCXProcess.exe`, { memory: 70e6, company: 'Adobe Inc.', description: 'CCXProcess' }),
    proc('qbittorrent', `${PF}\\qBittorrent\\qbittorrent.exe`, { memory: 95e6, company: 'The qBittorrent project', description: 'qBittorrent' }),
    proc('PhoneExperienceHost', `${PF}\\WindowsApps\\Microsoft.YourPhone_1.24082.126.0_x64__8wekyb3d8bbwe\\PhoneExperienceHost.exe`, { memory: 60e6, company: 'Microsoft Corporation', description: 'Phone Link' }),
    proc('NVIDIA Overlay', `${PF}\\NVIDIA Corporation\\NVIDIA app\\CEF\\NVIDIA Overlay.exe`, { memory: 90e6, company: 'NVIDIA Corporation' }),
    proc('lghub_agent', `${PF}\\LGHUB\\lghub_agent.exe`, { memory: 60e6, company: 'Logitech' }),
    proc('RtkAudUService64', 'C:\\Windows\\System32\\RtkAudUService64.exe', { company: 'Realtek Semiconductor' }),
    proc('DS4Windows', `${PF}\\DS4Windows\\DS4Windows.exe`, { memory: 45e6, description: 'DS4Windows' }),
  ];
  if (gameRunning) {
    const game = proc('FC27', `${PF}\\EA Games\\EA SPORTS FC 27\\FC27.exe`, { window: true, title: 'EA SPORTS FC 27', memory: 6.2e9, company: 'Electronic Arts' });
    list.push(game, proc('EAAntiCheat.GameServiceLauncher', `${PF}\\EA Games\\EA SPORTS FC 27\\EAAntiCheat.GameServiceLauncher.exe`, { parent: game.pid }));
  }
  return list;
}

const services = [
  'wuauserv', 'UsoSvc', 'BITS', 'DoSvc', 'WSearch', 'DiagTrack', 'WerSvc', 'SysMain', 'Spooler', 'edgeupdate', 'gupdate',
  'AdobeARMservice', 'MapsBroker', 'EABackgroundService', 'Steam Client Service', 'Audiosrv', 'Dhcp', 'Dnscache',
].map((name) => ({ name, display: name, canStop: true }));

const games = [
  { id: 'ea:fc27', name: 'EA SPORTS FC 27', exe: `${PF}\\EA Games\\EA SPORTS FC 27\\FC27.exe`, platform: 'EA app', launchers: ['ea'] },
  { id: 'steam:2669320', name: 'EA SPORTS FC 26', exe: `${PF86}\\Steam\\steamapps\\common\\EA SPORTS FC 26\\FC26.exe`, platform: 'Steam', launchers: ['ea', 'steam'] },
  { id: 'steam:730', name: 'Counter-Strike 2', exe: `${PF86}\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe`, platform: 'Steam', launchers: ['steam'] },
  { id: 'epic:Sugar', name: 'Rocket League', exe: `${PF}\\Epic Games\\rocketleague\\Binaries\\Win64\\RocketLeague.exe`, platform: 'Epic Games', launchers: ['epic'] },
];

const REGION_MS = {
  'eu-west-2': 19, 'eu-west-1': 27, 'eu-central-1': 33, 'eu-west-3': 26, 'eu-north-1': 46, 'eu-south-1': 41, 'me-central-1': 118, 'me-south-1': 112,
  'ap-south-1': 128, 'ap-southeast-1': 171, 'ap-northeast-1': 232, 'ap-southeast-2': 279, 'us-east-1': 81, 'us-east-2': 92, 'us-west-2': 142, 'us-west-1': 150,
  'ca-central-1': 88, 'sa-east-1': 191, 'af-south-1': 168,
};

const jitter = (base, spread, n, spikes = []) => Array.from({ length: n }, (_, i) => (spikes.includes(i) ? base + 60 + Math.round(Math.random() * 40) : Math.max(1, Math.round(base + (Math.random() - 0.5) * spread))));

function netinfo() {
  return {
    adapters: [{ name: 'Wi-Fi', description: 'Intel(R) Wi-Fi 6 AX201 160MHz', index: 12, media: 'Native 802.11', medium: '9', linkSpeed: '144.4 Mbps', receiveBps: 144400000, virtual: false, hardware: true }],
    defaultRoutes: [{ index: 12, nextHop: '192.168.1.1', metric: 35, alias: 'Wi-Fi' }],
    dns: [{ index: 12, servers: ['192.168.1.1'] }],
    wifi: ['', 'There is 1 interface on the system:', '', '    Name                   : Wi-Fi', '    State                  : connected', '    SSID                   : VM4829183', '    Radio type             : 802.11n', '    Band                   : 2.4 GHz', '    Channel                : 6', '    Receive rate (Mbps)    : 144.4', '    Signal                 : 58%'],
    traffic: [{ name: 'Wi-Fi', rxBps: 6_400_000, txBps: 350_000 }],
    processes: processes().map(({ pid: id, name, path }) => ({ pid: id, name, path })),
    services: [{ name: 'wuauserv', status: 'Running' }, { name: 'BITS', status: 'Running' }],
    downloads: [],
    connections: [],
  };
}

function ping(targets, { loaded = false } = {}) {
  return {
    results: targets.map((t) => {
      const n = 24;
      let samples;
      if (t.id === 'router') samples = jitter(4, 8, n, [5, 17]);
      else if (loaded) samples = jitter(112, 60, n);
      else samples = jitter(t.id === 'google' ? 31 : 27, 10, n, [11]);
      if (t.id === 'router') samples[20] = -1;
      return { id: t.id, host: t.host, ip: t.host, samples };
    }),
  };
}

module.exports = { processes, services, games, netinfo, ping, REGION_MS, jitter };
