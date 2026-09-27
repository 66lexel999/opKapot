'use strict';

// Sample data shaped exactly like the PowerShell collectors' output, used by
// `npm run demo` and the tests. The real analyzers run on it.

const DAY = 86_400_000;
const now = () => Date.now();

const ENV = {
  SystemRoot: 'C:\\Windows', windir: 'C:\\Windows', SystemDrive: 'C:', USERPROFILE: 'C:\\Users\\You',
  APPDATA: 'C:\\Users\\You\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\You\\AppData\\Local',
  TEMP: 'C:\\Users\\You\\AppData\\Local\\Temp', TMP: 'C:\\Users\\You\\AppData\\Local\\Temp', ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', PUBLIC: 'C:\\Users\\Public',
  COMPUTERNAME: 'GAMING-PC', USERNAME: 'You',
};
const USER_SID = 'S-1-5-21-3623811015-3361044348-30300820-1001';
const TEMP_SVC = 'C:\\Users\\You\\AppData\\Local\\Temp\\upd4231\\svc.exe';

const PROCESSES = [
  [4, 'System', ''],
  [812, 'svchost', 'C:\\Windows\\System32\\svchost.exe', 'Microsoft Corporation'],
  [1044, 'svchost', 'C:\\Windows\\System32\\svchost.exe', 'Microsoft Corporation'],
  [5120, 'explorer', 'C:\\Windows\\explorer.exe', 'Microsoft Corporation'],
  [6012, 'chrome', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'Google LLC'],
  [6420, 'brave', 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', 'Brave Software, Inc.'],
  [7188, 'Discord', 'C:\\Users\\You\\AppData\\Local\\Discord\\app-1.0.9163\\Discord.exe', 'Discord Inc.'],
  [7340, 'steam', 'C:\\Program Files (x86)\\Steam\\steam.exe', 'Valve Corporation'],
  [7702, 'TeamViewer_Service', 'C:\\Program Files\\TeamViewer\\TeamViewer_Service.exe', 'TeamViewer Germany GmbH'],
  [7710, 'TeamViewer', 'C:\\Program Files\\TeamViewer\\TeamViewer.exe', 'TeamViewer Germany GmbH'],
  [8120, 'qbittorrent', 'C:\\Program Files\\qBittorrent\\qbittorrent.exe', 'The qBittorrent project'],
  [8844, 'NVDisplay.Container', 'C:\\Windows\\System32\\DriverStore\\FileRepository\\nv_dispi.inf_amd64\\Display.NvContainer\\NVDisplay.Container.exe', 'NVIDIA Corporation'],
  [9310, 'svc', TEMP_SVC, ''],
  [9420, 'Spotify', 'C:\\Users\\You\\AppData\\Roaming\\Spotify\\Spotify.exe', 'Spotify Ltd'],
].map(([pid, name, path, company = '']) => ({ pid, name, path, company, description: name }));

const SIGNED = (signer) => ({ exists: true, status: 'Valid', signer: `CN=${signer}, O=${signer}, C=US`, type: 'Authenticode' });
const SIGNATURES = {
  'C:\\Windows\\System32\\svchost.exe': SIGNED('Microsoft Windows'),
  'C:\\Windows\\explorer.exe': SIGNED('Microsoft Windows'),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe': SIGNED('Google LLC'),
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe': SIGNED('Brave Software, Inc.'),
  'C:\\Users\\You\\AppData\\Local\\Discord\\app-1.0.9163\\Discord.exe': SIGNED('Discord Inc.'),
  'C:\\Users\\You\\AppData\\Local\\Discord\\Update.exe': SIGNED('Discord Inc.'),
  'C:\\Program Files (x86)\\Steam\\steam.exe': SIGNED('Valve Corp.'),
  'C:\\Program Files (x86)\\Common Files\\Steam\\steamservice.exe': SIGNED('Valve Corp.'),
  'C:\\Program Files\\TeamViewer\\TeamViewer_Service.exe': SIGNED('TeamViewer Germany GmbH'),
  'C:\\Program Files\\TeamViewer\\TeamViewer.exe': SIGNED('TeamViewer Germany GmbH'),
  'C:\\Program Files\\qBittorrent\\qbittorrent.exe': { exists: true, status: 'NotSigned', signer: '' },
  'C:\\Users\\You\\AppData\\Roaming\\Spotify\\Spotify.exe': SIGNED('Spotify AB'),
  'C:\\Program Files (x86)\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe': SIGNED('Microsoft Corporation'),
  'C:\\Program Files (x86)\\Google\\Update\\GoogleUpdate.exe': SIGNED('Google LLC'),
  'C:\\Program Files\\Razer\\Synapse3\\Service\\Razer Synapse Service.exe': SIGNED('Razer USA Ltd.'),
  'C:\\Program Files (x86)\\EasyAntiCheat\\EasyAntiCheat.exe': SIGNED('Epic Games Inc.'),
  'C:\\Users\\You\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe': SIGNED('Microsoft Corporation'),
  'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe': SIGNED('Microsoft Windows'),
  [TEMP_SVC]: { exists: true, status: 'NotSigned', signer: '' },
  'C:\\Users\\You\\AppData\\Local\\OldGame\\launcher_helper.exe': { exists: false },
};

function audit() {
  const t = now();
  return {
    os: {
      caption: 'Microsoft Windows 11 Pro', version: '10.0.26100', build: '26100', lastBoot: t - 2 * DAY, domain: false,
      computer: 'GAMING-PC', user: 'You', userSid: USER_SID, lastUpdate: t - 6 * DAY, secureBoot: true,
      bcd: ['Windows Boot Loader', 'identifier              {current}', 'nx                      OptIn'],
    },
    processes: PROCESSES,
    programs: [
      { name: 'TeamViewer', publisher: 'TeamViewer Germany GmbH', location: 'C:\\Program Files\\TeamViewer' },
      { name: 'Steam', publisher: 'Valve Corporation', location: 'C:\\Program Files (x86)\\Steam' },
      { name: 'Discord', publisher: 'Discord Inc.', location: 'C:\\Users\\You\\AppData\\Local\\Discord' },
      { name: 'qBittorrent 4.6.3', publisher: 'The qBittorrent project', location: 'C:\\Program Files\\qBittorrent' },
    ],
    defender: {
      serviceEnabled: true, antivirusEnabled: true, realTime: true, behavior: true, ioav: true, tamper: true, runningMode: 'Normal',
      signatureVersion: '1.421.1043.0', signatureUpdated: t - 1 * DAY, quickScanEnd: t - 9 * DAY, fullScanEnd: t - 40 * DAY,
      exclusionPath: ['C:\\Users\\You\\AppData\\Roaming'], exclusionExtension: [], exclusionProcess: [],
      disableRealtime: false, disableBehavior: false, disableIoav: false, disableScript: false, pua: 0, cfa: 0, maps: 2,
    },
    avProducts: [{ name: 'Windows Defender', state: 397568, path: 'windowsdefender://' }],
    firewallProducts: [],
    firewall: ['Domain', 'Private', 'Public'].map((name) => ({ name, enabled: 'True', inbound: 'NotConfigured' })),
    firewallRules: [],
    rdp: { deny: 1, nla: 1, port: 3389, remoteAssistance: 1, sessions: [' SESSIONNAME       USERNAME     ID  STATE', '>console           You           1  Active'] },
    accounts: {
      users: [
        { name: 'Administrator', enabled: false, sid: 'S-1-5-21-3623811015-3361044348-30300820-500', passwordRequired: true },
        { name: 'DefaultAccount', enabled: false, sid: 'S-1-5-21-3623811015-3361044348-30300820-503', passwordRequired: false },
        { name: 'Guest', enabled: false, sid: 'S-1-5-21-3623811015-3361044348-30300820-501', passwordRequired: false },
        { name: 'You', enabled: true, sid: USER_SID, passwordRequired: true, lastLogon: t - 2 * DAY },
        { name: 'WDAGUtilityAccount', enabled: false, sid: 'S-1-5-21-3623811015-3361044348-30300820-504', passwordRequired: true },
      ],
      admins: [
        { name: 'GAMING-PC\\Administrator', sid: 'S-1-5-21-3623811015-3361044348-30300820-500', source: 'Local', type: 'User' },
        { name: 'GAMING-PC\\You', sid: USER_SID, source: 'Local', type: 'User' },
      ],
    },
    logons: {
      success: [],
      failed: [
        { time: t - 3 * DAY, type: '2', user: 'You', ip: '-', workstation: 'GAMING-PC' },
        { time: t - 3 * DAY + 20_000, type: '2', user: 'You', ip: '-', workstation: 'GAMING-PC' },
      ],
      accountChanges: [],
      rdp: [],
    },
    keyboard: { upper: ['kbdclass'], lower: [], drivers: [{ name: 'kbdclass', image: '\\SystemRoot\\System32\\drivers\\kbdclass.sys', display: 'Keyboard Class Driver' }] },
    injection: {
      appInit: '', loadAppInit: 0, appInit32: '', loadAppInit32: 0, shell: 'explorer.exe', userinit: 'C:\\Windows\\system32\\userinit.exe,', userShell: '',
      notification: ['scecli'], security: ['kerberos', 'msv1_0', 'schannel', 'wdigest', 'tspkg', 'pku2u'], authentication: ['msv1_0'],
      wdigest: null, ifeo: [], silentExit: [],
    },
    sharing: {
      shares: [
        { name: 'ADMIN$', path: 'C:\\Windows', special: true, access: [] },
        { name: 'C$', path: 'C:\\', special: true, access: [] },
        { name: 'IPC$', path: '', special: true, access: [] },
        { name: 'Games', path: 'D:\\Games', special: false, access: [{ account: 'Everyone', right: 'Read', type: 'Allow' }] },
      ],
      sessions: [], openFiles: [], smb1: false,
    },
    internet: {
      proxyEnable: 0, proxyServer: '', autoConfig: '',
      winhttp: ['Current WinHTTP proxy settings:', '', '    Direct access (no proxy server).'],
      wlan: ['    Name                   : Wi-Fi', '    Authentication         : WPA2-Personal'],
      dns: [{ alias: 'Wi-Fi', servers: ['192.168.1.1'] }],
    },
    certificates: [
      { store: 'Cert:\\LocalMachine\\Root', subject: 'CN=DigiCert Global Root G2, OU=www.digicert.com, O=DigiCert Inc, C=US', issuer: '', thumbprint: 'DF3C24F9BFD666761B268073FE06D1CC8D4F82A4', hasPrivateKey: false, friendly: 'DigiCert Global Root G2' },
      { store: 'Cert:\\LocalMachine\\Root', subject: 'CN=Microsoft Root Certificate Authority 2011, O=Microsoft Corporation', issuer: '', thumbprint: '8F43288AD272F3103B6FB1428485EA3014C0BCFE', hasPrivateKey: false, friendly: 'Microsoft Root Certificate Authority 2011' },
    ],
    browserPolicies: [{
      key: 'HKLM:\\SOFTWARE\\Policies\\Google\\Chrome',
      values: {},
      subkeys: [{ name: 'ExtensionInstallForcelist', values: { 1: 'mdpfkohgmkmhbnhkdebapfbccmnaoeem;https://pdf-convert-pro.example/crx/update.xml' } }],
    }],
    externalExtensions: [],
    settings: { enableLua: 1, consentAdmin: 5, smartScreenPolicy: null, smartScreenExplorer: 'Warn', remoteRegistry: { status: 'Stopped', start: 'Disabled' } },
  };
}

function autoruns() {
  const approvedDisabled = Buffer.from([3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64');
  return {
    run: {
      entries: [
        { hive: 'HKCU', key: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', kind: 'Run', name: 'Discord', command: '"C:\\Users\\You\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe' },
        { hive: 'HKCU', key: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', kind: 'Run', name: 'Steam', command: '"C:\\Program Files (x86)\\Steam\\steam.exe" -silent' },
        { hive: 'HKCU', key: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', kind: 'Run', name: 'OneDrive', command: '"C:\\Users\\You\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe" /background' },
        { hive: 'HKCU', key: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', kind: 'Run', name: 'WindowsHelper', command: 'powershell.exe -w hidden -nop -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA' },
        { hive: 'HKLM', key: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', kind: 'Run', name: 'OldGameHelper', command: '"C:\\Users\\You\\AppData\\Local\\OldGame\\launcher_helper.exe"' },
      ],
      approved: { 'HKCU\\Run': { OneDrive: approvedDisabled }, 'HKLM\\Run': {}, 'HKLM\\Run32': {}, 'HKCU\\StartupFolder': {}, 'HKLM\\StartupFolder': {} },
    },
    startupFolder: [
      { hive: 'HKCU', folder: 'C:\\Users\\You\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup', path: 'C:\\Users\\You\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Spotify.lnk', name: 'Spotify.lnk', target: { target: 'C:\\Users\\You\\AppData\\Roaming\\Spotify\\Spotify.exe', args: '--autostart --minimized' } },
    ],
    tasks: [
      { path: '\\', name: 'GoogleUpdateTaskMachineCore', state: 'Ready', author: 'Google LLC', runLevel: 'Highest', user: 'SYSTEM', hidden: false, actions: [{ exe: 'C:\\Program Files (x86)\\Google\\Update\\GoogleUpdate.exe', args: '/c' }], triggers: ['MSFT_TaskLogonTrigger'] },
      { path: '\\', name: 'MicrosoftEdgeUpdateTaskMachineUA', state: 'Ready', author: 'Microsoft', runLevel: 'Highest', user: 'SYSTEM', hidden: false, actions: [{ exe: 'C:\\Program Files (x86)\\Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe', args: '/ua /installsource scheduler' }], triggers: ['MSFT_TaskTimeTrigger'] },
      { path: '\\', name: 'SystemUpdateCheck', state: 'Ready', author: '', runLevel: 'Highest', user: 'SYSTEM', hidden: true, actions: [{ exe: TEMP_SVC, args: '--silent' }], triggers: ['MSFT_TaskLogonTrigger'] },
    ],
    services: [
      { name: 'Steam Client Service', display: 'Steam Client Service', path: '"C:\\Program Files (x86)\\Common Files\\Steam\\steamservice.exe" /RunAsService', start: 'Manual', state: 'Stopped', account: 'LocalSystem' },
      { name: 'TeamViewer', display: 'TeamViewer', path: '"C:\\Program Files\\TeamViewer\\TeamViewer_Service.exe"', start: 'Auto', state: 'Running', account: 'LocalSystem' },
      { name: 'Razer Synapse Service', display: 'Razer Synapse Service', path: '"C:\\Program Files\\Razer\\Synapse3\\Service\\Razer Synapse Service.exe"', start: 'Auto', state: 'Running', account: 'LocalSystem' },
      { name: 'EasyAntiCheat', display: 'EasyAntiCheat', path: '"C:\\Program Files (x86)\\EasyAntiCheat\\EasyAntiCheat.exe"', start: 'Manual', state: 'Stopped', account: 'LocalSystem' },
    ],
    drivers: [],
    wmi: { filters: [], commandConsumers: [], scriptConsumers: [], bindings: [] },
  };
}

function network() {
  const tcp = [
    ['Listen', '0.0.0.0', 135, '0.0.0.0', 0, 1044],
    ['Listen', '0.0.0.0', 445, '0.0.0.0', 0, 4],
    ['Listen', '0.0.0.0', 27036, '0.0.0.0', 0, 7340],
    ['Listen', '127.0.0.1', 6463, '0.0.0.0', 0, 7188],
    ['Listen', '0.0.0.0', 6881, '0.0.0.0', 0, 8120],
    ['Established', '192.168.1.23', 6881, '89.187.160.12', 51234, 8120],
    ['Established', '192.168.1.23', 52110, '142.250.180.14', 443, 6012],
    ['Established', '192.168.1.23', 52114, '172.217.16.46', 443, 6012],
    ['Established', '192.168.1.23', 52301, '104.18.32.47', 443, 6420],
    ['Established', '192.168.1.23', 52402, '162.159.135.234', 443, 7188],
    ['Established', '192.168.1.23', 52455, '155.133.248.39', 27030, 7340],
    ['Established', '192.168.1.23', 52560, '188.172.219.21', 5938, 7702],
    ['Established', '192.168.1.23', 52611, '45.137.21.9', 8080, 9310],
    ['Established', '192.168.1.23', 52701, '35.186.224.25', 443, 9420],
  ].map(([state, la, lp, ra, rp, pid], i) => ({ proto: 'TCP', state, localAddress: la, localPort: lp, remoteAddress: ra, remotePort: rp, pid, created: now() - (i + 1) * 60_000 }));
  const udp = [['0.0.0.0', 5353, 6012], ['0.0.0.0', 27036, 7340]]
    .map(([la, lp, pid]) => ({ proto: 'UDP', state: 'Listen', localAddress: la, localPort: lp, remoteAddress: '', remotePort: 0, pid }));
  const processes = {};
  for (const p of PROCESSES) processes[String(p.pid)] = { name: p.name, path: p.path, company: p.company, description: p.description };
  return { tcp, udp, processes, localIps: ['192.168.1.23', '127.0.0.1', '::1', 'fe80::a4c1:1b2e:9d3f:12'] };
}

function status() {
  const a = audit();
  const t = now();
  return {
    defender: a.defender,
    avProducts: a.avProducts,
    firewallProducts: [],
    firewall: a.firewall,
    rdp: a.rdp,
    rdpSessions: a.rdp.sessions,
    processes: PROCESSES,
    consent: [
      { cap: 'microphone', packaged: false, name: 'C:#Users#You#AppData#Local#Discord#app-1.0.9163#Discord.exe', start: t - 25 * 60_000, stop: 0 },
      { cap: 'webcam', packaged: false, name: 'C:#Users#You#AppData#Roaming#Zoom#bin#Zoom.exe', start: t - 3 * DAY, stop: t - 3 * DAY + 45 * 60_000 },
      { cap: 'microphone', packaged: false, name: 'C:#Users#You#AppData#Roaming#Zoom#bin#Zoom.exe', start: t - 3 * DAY, stop: t - 3 * DAY + 45 * 60_000 },
      { cap: 'webcam', packaged: true, name: 'Microsoft.WindowsCamera_8wekyb3d8bbwe', start: t - 9 * DAY, stop: t - 9 * DAY + 5 * 60_000 },
      { cap: 'microphone', packaged: false, name: 'C:#Program Files (x86)#Steam#steam.exe', start: t - 12 * DAY, stop: t - 12 * DAY + 2 * 3_600_000 },
      { cap: 'location', packaged: false, name: 'C:#Program Files#Google#Chrome#Application#chrome.exe', start: t - DAY, stop: t - DAY + 1000 },
    ],
  };
}

const UPNP = {
  available: true,
  mappings: [
    { external: 27036, protocol: 'UDP', internal: 27036, client: '192.168.1.23', enabled: true, description: 'Steam In-Home Streaming', externalIp: '81.2.69.160' },
    { external: 6881, protocol: 'TCP', internal: 6881, client: '192.168.1.23', enabled: true, description: 'qBittorrent/4.6.3', externalIp: '81.2.69.160' },
    { external: 4444, protocol: 'TCP', internal: 4444, client: '192.168.1.23', enabled: true, description: '', externalIp: '81.2.69.160' },
  ],
};

const EXTENSIONS = [
  { id: 'Brave|Default|cjpalhdlnbpafiamejdnhcphjbkeiagm', extensionId: 'cjpalhdlnbpafiamejdnhcphjbkeiagm', browser: 'Brave', profile: 'Person 1', name: 'uBlock Origin', description: 'Finally, an efficient blocker.', version: '1.61.2', source: 'store', sourceLabel: 'Web store', enabled: true, capabilities: ['Runs code on every website (can see what you type)', 'Can read and change data on all websites', 'Can see and change your web traffic', 'Can block or rewrite your web traffic'], power: 10, risk: 'notice', folder: 'C:\\Users\\You\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Extensions\\cjpalhdlnbpafiamejdnhcphjbkeiagm\\1.61.2_0', icon: null, storeUrl: 'https://chromewebstore.google.com/detail/cjpalhdlnbpafiamejdnhcphjbkeiagm' },
  { id: 'Google Chrome|Default|nngceckbapebfimnlniiiahkandclblb', extensionId: 'nngceckbapebfimnlniiiahkandclblb', browser: 'Google Chrome', profile: 'You', name: 'Bitwarden Password Manager', description: 'A secure and free password manager.', version: '2024.9.0', source: 'store', sourceLabel: 'Web store', enabled: true, capabilities: ['Runs code on every website (can see what you type)', 'Can read and change data on all websites', 'Can read your clipboard'], power: 8, risk: 'notice', folder: 'C:\\Users\\You\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\nngceckbapebfimnlniiiahkandclblb', icon: null, storeUrl: 'https://chromewebstore.google.com/detail/nngceckbapebfimnlniiiahkandclblb' },
  { id: 'Google Chrome|Default|mdpfkohgmkmhbnhkdebapfbccmnaoeem', extensionId: 'mdpfkohgmkmhbnhkdebapfbccmnaoeem', browser: 'Google Chrome', profile: 'You', name: 'PDF Converter Pro', description: 'Convert any page to PDF', version: '3.2.1', source: 'policy', sourceLabel: 'Forced by a policy', enabled: true, capabilities: ['Runs code on every website (can see what you type)', 'Can read and change data on all websites', 'Can read your login cookies', 'Can see and change your web traffic', 'Can manage your downloads'], power: 10, risk: 'danger', folder: 'C:\\Users\\You\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\mdpfkohgmkmhbnhkdebapfbccmnaoeem\\3.2.1_0', icon: null, storeUrl: null },
  { id: 'Microsoft Edge|Default|jbbplnpkjmmeebjpijfedlgcdilocofh', extensionId: 'jbbplnpkjmmeebjpijfedlgcdilocofh', browser: 'Microsoft Edge', profile: 'Profile 1', name: 'Grammarly', description: 'Write your best with Grammarly.', version: '14.1190.0', source: 'store', sourceLabel: 'Web store', enabled: false, capabilities: ['Runs code on every website (can see what you type)', 'Can read and change data on all websites', 'Can read your login cookies'], power: 8, risk: 'notice', folder: '', icon: null, storeUrl: 'https://microsoftedge.microsoft.com/addons/detail/jbbplnpkjmmeebjpijfedlgcdilocofh' },
  { id: 'Firefox|default-release|addon@darkreader.org', extensionId: 'addon@darkreader.org', browser: 'Firefox', profile: 'default-release', name: 'Dark Reader', description: 'Dark mode for every website.', version: '4.9.92', source: 'store', sourceLabel: 'Firefox add-ons (signed)', enabled: true, capabilities: ['Can read and change data on all websites'], power: 3, risk: 'ok', folder: '', icon: null, storeUrl: 'https://addons.mozilla.org/firefox/addon/darkreader/' },
];

const HOSTS = [
  '# Copyright (c) 1993-2009 Microsoft Corp.',
  '#',
  '# This is a sample HOSTS file used by Microsoft TCP/IP for Windows.',
  '#',
  '# localhost name resolution is handled within DNS itself.',
  '#\t127.0.0.1       localhost',
  '#\t::1             localhost',
  '0.0.0.0 ads.doubleclick.example',
  '0.0.0.0 telemetry.example-tracker.com',
].join('\r\n');

function defender() {
  const t = now();
  return {
    threats: [
      { id: '2147735503', name: 'HackTool:Win32/Keygen', severity: 4, category: 42, active: false, executed: false, status: 3, resources: [] },
      { id: '311978', name: 'PUA:Win32/Presenoker', severity: 1, category: 27, active: false, executed: false, status: 4, resources: [] },
    ],
    detections: [
      { id: '2147735503', detectionId: '{8A7B1C2D-0001}', time: t - 12 * DAY, changed: t - 12 * DAY, remediated: t - 12 * DAY, status: 3, success: true, source: 3, process: 'C:\\Windows\\explorer.exe', user: 'GAMING-PC\\You', resources: ['file:_C:\\Users\\You\\Downloads\\crack\\keygen.exe'] },
      { id: '311978', detectionId: '{8A7B1C2D-0002}', time: t - 30 * DAY, changed: t - 30 * DAY, remediated: t - 30 * DAY, status: 4, success: true, source: 1, process: 'Unknown', user: 'GAMING-PC\\You', resources: ['file:_C:\\Users\\You\\Downloads\\free-pc-optimizer-setup.exe'] },
    ],
  };
}

const SCAN_FINDINGS = [
  {
    path: 'C:\\Users\\You\\Downloads\\Invoice_2026-09.pdf.exe', name: 'Invoice_2026-09.pdf.exe', size: 1_482_240, mtime: now() - 2 * DAY, severity: 'danger',
    hits: [{ id: 'double-ext', severity: 'high', title: 'Fake file extension', why: '"Invoice_2026-09.pdf.exe" pretends to be a document or picture but is really a program.' }],
    origin: { zone: 3, url: 'https://mail-attachments.example.net/dl/8812', referrer: '' }, sha256: '5f4dcc3b5aa765d61d8327deb882cf99e3b0c44298fc1c149afbf4c8996fb924',
  },
  {
    path: 'C:\\Users\\You\\AppData\\Roaming\\Microsoft\\svchost.exe', name: 'svchost.exe', size: 348_160, mtime: now() - 5 * DAY, severity: 'danger',
    hits: [{ id: 'fake-system', severity: 'high', title: 'Fake Windows system file', why: 'The real svchost.exe only lives in the Windows folder. Malware copies the name to hide.' }],
    origin: null, sha256: '9b74c9897bac770ffc029102a200c5de7e7b6f3f2f8e8b4b8e0c9b4b9b1a2c3d',
  },
];

module.exports = {
  ENV, USER_SID, SIGNATURES, UPNP, EXTENSIONS, HOSTS, SCAN_FINDINGS,
  audit, autoruns, network, status, defender,
};
