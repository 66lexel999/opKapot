'use strict';

// Sample data for `npm run demo`: lets the UI be explored (and screenshotted)
// on any OS without touching the real system. Every action here is simulated.

const { sleep } = require('./common');

const DAY = 86_400_000;
const MB = 1024 * 1024;
const GB = 1024 * MB;

// [name, publisher, size, installed days ago (+minutes), last used days ago, folder]
const SAMPLE = [
  ['MSI Afterburner 4.6.6', 'MSI Co., LTD', 52 * MB, [45, 0], 2, 'C:\\Program Files (x86)\\MSI Afterburner'],
  ['RivaTuner Statistics Server 7.3.7', 'Unwinder', 38 * MB, [45, 1], 2, 'C:\\Program Files (x86)\\RivaTuner Statistics Server'],
  ['Razer Cortex (x64)', 'Razer Inc.', 410 * MB, [120, 0], 160, 'C:\\Program Files\\Razer\\Razer Cortex'],
  ['Razer Synapse', 'Razer Inc.', 780 * MB, [120, 6], 3, 'C:\\Program Files\\Razer\\Synapse3'],
  ['Rockstar Games Launcher', 'Rockstar Games', 520 * MB, [210, 0], 95, 'C:\\Program Files\\Rockstar Games\\Launcher'],
  ['Rockstar Games SDK', 'Rockstar Games', 95 * MB, [210, 2], null, 'C:\\Program Files\\Rockstar Games\\Social Club'],
  ['Google Chrome', 'Google LLC', 610 * MB, [400, 0], 0, 'C:\\Program Files\\Google\\Chrome\\Application'],
  ['Discord', 'Discord Inc.', 390 * MB, [12, 0], 1, 'C:\\Users\\You\\AppData\\Local\\Discord'],
  ['Steam', 'Valve Corporation', 1.2 * GB, [300, 0], 4, 'C:\\Program Files (x86)\\Steam'],
  ['VLC media player', 'VideoLAN', 160 * MB, [90, 0], 30, 'C:\\Program Files\\VideoLAN\\VLC'],
  ['7-Zip 23.01 (x64)', 'Igor Pavlov', 5.6 * MB, [500, 0], 8, 'C:\\Program Files\\7-Zip'],
  ['Spotify', 'Spotify AB', 380 * MB, [5, 0], 0, 'C:\\Users\\You\\AppData\\Roaming\\Spotify'],
  ['Microsoft Visual Studio Code', 'Microsoft Corporation', 420 * MB, [150, 0], 0, 'C:\\Users\\You\\AppData\\Local\\Programs\\Microsoft VS Code'],
  ['OBS Studio', 'OBS Project', 450 * MB, [20, 0], 6, 'C:\\Program Files\\obs-studio'],
  ['Adobe Acrobat Reader', 'Adobe Inc.', 1.1 * GB, [260, 0], 70, 'C:\\Program Files\\Adobe\\Acrobat DC'],
  ['McAfee WebAdvisor', 'McAfee, LLC', 45 * MB, [260, 1], null, 'C:\\Program Files\\McAfee\\WebAdvisor'],
  ['NVIDIA Graphics Driver 551.86', 'NVIDIA Corporation', 1.6 * GB, [33, 0], 0, 'C:\\Program Files\\NVIDIA Corporation\\Display.NvContainer'],
  ['NVIDIA PhysX System Software 9.23', 'NVIDIA Corporation', 520 * MB, [33, 2], 40, 'C:\\Program Files (x86)\\NVIDIA Corporation\\PhysX'],
  ['NVIDIA HD Audio Driver 1.4.0.1', 'NVIDIA Corporation', 12 * MB, [33, 3], null, 'C:\\Program Files\\NVIDIA Corporation\\HDAudio'],
  ['WinRAR 7.00 (64-bit)', 'win.rar GmbH', 9 * MB, [380, 0], 50, 'C:\\Program Files\\WinRAR'],
  ['Zoom Workplace', 'Zoom Video Communications, Inc.', 310 * MB, [540, 0], 410, 'C:\\Users\\You\\AppData\\Roaming\\Zoom'],
  ['Epic Games Launcher', 'Epic Games, Inc.', 2.4 * GB, [330, 0], 120, 'C:\\Program Files (x86)\\Epic Games\\Launcher'],
  ['Python 3.12.2 (64-bit)', 'Python Software Foundation', 110 * MB, [3, 0], 0, 'C:\\Users\\You\\AppData\\Local\\Programs\\Python\\Python312'],
  ['Notepad++ (64-bit x64)', 'Notepad++ Team', 15 * MB, [620, 0], 1, 'C:\\Program Files\\Notepad++'],
  ['Audacity 3.4.2', 'Audacity Team', 70 * MB, [470, 0], 250, 'C:\\Program Files\\Audacity'],
  ['CCleaner', 'Piriform', 90 * MB, [700, 0], 365, 'C:\\Program Files\\CCleaner'],
  ['Opera GX Stable', 'Opera Software', 400 * MB, [300, 1], 300, 'C:\\Users\\You\\AppData\\Local\\Programs\\Opera GX'],
  ['Microsoft Edge WebView2 Runtime', 'Microsoft Corporation', 600 * MB, [410, 0], null, 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application'],
  ['Microsoft Visual C++ 2015-2022 Redistributable (x64)', 'Microsoft Corporation', 20 * MB, [410, 0], null, ''],
  ['Logitech G HUB', 'Logitech', 690 * MB, [75, 0], 11, 'C:\\Program Files\\LGHUB'],
];

const STORE_APPS = [
  ['Microsoft.BingWeather', 'Weather', 'Microsoft Corporation', 28 * MB],
  ['Microsoft.MicrosoftSolitaireCollection', 'Solitaire & Casual Games', 'Microsoft Studios', 160 * MB],
  ['Microsoft.GamingApp', 'Xbox', 'Microsoft Corporation', 310 * MB],
  ['Microsoft.WindowsCalculator', 'Calculator', 'Microsoft Corporation', 12 * MB],
  ['Clipchamp.Clipchamp', 'Microsoft Clipchamp', 'Clipchamp Pty Ltd', 95 * MB],
  ['SpotifyAB.SpotifyMusic', 'Spotify Music', 'Spotify AB', 210 * MB],
  ['Disney.37853FC22B2CE', 'Disney+', 'Disney', 80 * MB],
  ['BytedancePte.Ltd.TikTok', 'TikTok', 'TikTok Pte. Ltd.', 140 * MB],
  ['Microsoft.YourPhone', 'Phone Link', 'Microsoft Corporation', 190 * MB],
  ['Microsoft.WindowsFeedbackHub', 'Feedback Hub', 'Microsoft Corporation', 45 * MB],
  ['Microsoft.GetHelp', 'Get Help', 'Microsoft Corporation', 18 * MB],
  ['Microsoft.Todos', 'Microsoft To Do', 'Microsoft Corporation', 60 * MB],
];

function buildPrograms() {
  const now = Date.now();
  return SAMPLE.map(([name, publisher, size, [days, minutes], lastUsed, location], i) => {
    const installTime = now - days * DAY + minutes * 60_000 - 3 * 3_600_000;
    return {
      id: `demo:${i}`,
      name,
      version: (/\s(\d+(?:\.\d+)+)/.exec(name) || [])[1] || `${(i % 5) + 1}.${i % 10}.${(i * 7) % 13}`,
      publisher,
      installDate: installTime,
      installTime,
      installTimePrecise: true,
      size: Math.round(size),
      installLocation: location,
      locationGuessed: false,
      uninstallString: location ? `"${location}\\uninstall.exe"` : 'MsiExec.exe /X{00000000-0000-0000-0000-000000000000}',
      registryKey: `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${name}`,
      source: 'demo',
      sourceLabel: 'Demo',
      systemComponent: false,
      canUninstall: true,
      canRemoveEntry: true,
      lastUsed: lastUsed == null ? null : now - lastUsed * DAY - 5 * 3_600_000,
      website: '',
      description: '',
    };
  });
}

function createDemoProvider() {
  let programs = buildPrograms();
  let apps = STORE_APPS.map(([name, displayName, publisher, size], i) => ({
    id: `demo-app:${i}`,
    name: displayName,
    packageName: name,
    fullName: `${name}_1.0.${i}.0_x64__8wekyb3d8bbwe`,
    publisher,
    version: `1.${i}.${(i * 3) % 10}.0`,
    size,
    installDate: Date.now() - (30 + i * 40) * DAY,
    installLocation: `C:\\Program Files\\WindowsApps\\${name}_x64`,
    icon: null,
  }));

  return {
    demo: true,
    async listPrograms() {
      await sleep(350);
      return programs.map((p) => ({ ...p }));
    },
    async uninstall(program, { onStatus = () => {}, quiet } = {}) {
      onStatus('running', quiet ? 'Uninstalling silently…' : 'Running the uninstaller…');
      await sleep(1200);
      onStatus('waiting', 'Waiting for the uninstaller to finish…');
      await sleep(900);
      programs = programs.filter((p) => p.id !== program.id);
      return { status: 'removed', message: 'Removed.' };
    },
    async removeEntry(program) {
      programs = programs.filter((p) => p.id !== program.id);
      return { ok: true };
    },
    async iconCandidates() {
      return [];
    },
    async usage(list) {
      return Object.fromEntries(list.map((p) => [p.id, p.lastUsed]));
    },
    async createRestorePoint() {
      await sleep(800);
      return { ok: true };
    },
    leftovers(program) {
      const folder = program.name.replace(/\s*\(.*?\)|\s+\d+(\.\d+)+/g, '').trim();
      const seed = program.name.length;
      return [
        { kind: 'folder', path: `C:\\ProgramData\\${folder}`, size: (seed * 1.7 + 3) * MB, confidence: 'high' },
        { kind: 'folder', path: `C:\\Users\\You\\AppData\\Roaming\\${folder}`, size: (seed * 0.6 + 1) * MB, confidence: 'high' },
        { kind: 'shortcut', path: `C:\\Users\\Public\\Desktop\\${folder}.lnk`, size: 2048, confidence: 'high' },
        { kind: 'registry', path: `HKCU\\Software\\${program.publisher.split(/[ ,]/)[0]}\\${folder}`, size: null, confidence: 'high', reason: `Named after ${program.name}` },
        { kind: 'registry', path: `HKLM\\SOFTWARE\\WOW6432Node\\${program.publisher.split(/[ ,]/)[0]}`, size: null, confidence: 'medium', reason: `Publisher key (${program.publisher})` },
      ].map((item) => ({ ...item, size: item.size && Math.round(item.size) }));
    },
    async listApps() {
      await sleep(250);
      return apps.map((a) => ({ ...a }));
    },
    async removeApp(app) {
      await sleep(700);
      apps = apps.filter((a) => a.id !== app.id);
      return { ok: true };
    },
  };
}

module.exports = { createDemoProvider };
