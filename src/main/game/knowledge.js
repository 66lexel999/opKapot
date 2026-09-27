'use strict';

// What Game Mode knows about games, launchers and background software.
// Process names are matched without ".exe", as Windows reports them.

/** Launchers and platform helpers. A game can need several (FC on Steam needs Steam + the EA app). */
const LAUNCHERS = {
  ea: {
    name: 'EA app',
    processes: /^(EADesktop|EABackgroundService|EALocalHostSvc|EAConnect_microsoft|EACefSubProcess|EALauncher|Link2EA|EAAntiCheat\..*|EAAC.*|EASteamProxy|EAGEP|Origin|OriginWebHelperService|OriginClientService|QtWebEngineProcess)$/i,
    services: /^(EABackgroundService|EAAntiCheatService|Origin Web Helper Service|Origin Client Service)$/i,
  },
  steam: {
    name: 'Steam',
    processes: /^(steam|steamwebhelper|steamservice|gameoverlayui|gameoverlayui64|steamerrorreporter)$/i,
    services: /^(Steam Client Service)$/i,
  },
  epic: {
    name: 'Epic Games',
    processes: /^(EpicGamesLauncher|EpicWebHelper|EpicOnlineServices.*|EOSOverlayRenderer.*)$/i,
    services: /^(EpicOnlineServices)$/i,
  },
  ubisoft: {
    name: 'Ubisoft Connect',
    processes: /^(UbisoftConnect|upc|UplayWebCore|UbisoftGameLauncher.*|uplay_r1_loader.*)$/i,
    services: /^(UplayService)$/i,
  },
  battlenet: {
    name: 'Battle.net',
    processes: /^(Battle\.net|Agent|BlizzardError)$/i,
    services: /^(Battle\.net Update Helper Svc)$/i,
  },
  riot: {
    name: 'Riot Client',
    processes: /^(RiotClientServices|RiotClientUx|RiotClientUxRender|RiotClientCrashHandler|vgtray)$/i,
    services: /^(vgc|vgk)$/i,
  },
  xbox: {
    name: 'Xbox app',
    processes: /^(XboxPcApp|XboxPcAppFT|XboxAppServices|XboxPcTray|gamingservices|gamingservicesnet|GameBar|GameBarFTServer|GameInputSvc)$/i,
    services: /^(GamingServices|GamingServicesNet|XblAuthManager|XblGameSave|XboxNetApiSvc|XboxGipSvc|GameInputSvc)$/i,
  },
};

/** Games with known executables. FC's exe follows the year: FC24.exe, FC25.exe, FC26.exe… */
const PRESETS = [
  {
    id: 'fc27',
    name: 'EA SPORTS FC 27',
    exe: ['FC27.exe', 'FC27_Trial.exe'],
    process: /^FC27(_Trial)?$/i,
    launchers: ['ea'],
    note: 'Needs the EA app (and Steam or Epic if you bought it there). Anti-cheat stays on.',
  },
];

/** Anything EA SPORTS FC, whatever the year. */
const FC_PROCESS = /^FC\d{2}(_Trial)?$/i;

/**
 * Never closed by Game Mode: drivers and control panels for graphics, audio,
 * controllers, keyboards and mice, plus antivirus. Closing these can cost
 * sound, controller input or protection mid-match.
 */
const KEEP = [
  // Graphics
  /^(nvcontainer|NVDisplay\.Container|nvsphelper64|NVIDIA (Share|Overlay|Web Helper|app)|nvidia.*|NVIDIA app.*|RadeonSoftware|AMDRSServ|AMDRSSrcExt|amdow|atiesrxx|atieclxx|AMD.*|igfx.*|IntelGraphicsSoftware.*|IGCC.*|OneApp\.IGCC.*)$/i,
  // Audio
  /^(audiodg|RtkAudUService64|RtkNGUI64|Realtek.*|Nahimic.*|WavesSvc64|WavesSysSvc64|MaxxAudio.*|DolbyDAX.*|SonicStudio.*|SteelSeriesSonar.*|VoiceMeeter.*|voicemeeter.*)$/i,
  // Controllers, keyboards, mice, lighting
  /^(DS4Windows|DSX|DualSenseX|x360ce|ScpService|ViGEmBus.*|HidHide.*|lghub.*|LGHUB.*|LogiOptions.*|RazerCentral.*|Razer.*|RzSDKService|iCUE|Corsair.*|SteelSeries.*|ArmouryCrate.*|ArmourySocketServer|MSI.*Center.*|LightingService|ROGLiveService|WootilityCore|Wooting.*|SignalRgb.*|OpenRGB)$/i,
  // Antivirus and security
  /^(MsMpEng|NisSrv|SecurityHealth.*|MpDefenderCoreService|avastui|AvastSvc|avgui|AVGSvc|avp|avpui|ekrn|egui|bdagent|bdservicehost|vsserv|mbam|MBAMService|mcshield|mcuicnt|McAfee.*|Norton.*|NortonSecurity|nsWscSvc|SophosUI|Sophos.*|wrsa|MBAMTray|HitmanPro.*|ZAM.*)$/i,
  // Windows helpers that live outside C:\Windows or are needed for input and display
  /^(ctfmon|TextInputHost|SearchHost|StartMenuExperienceHost|ShellExperienceHost|explorer|dwm|sihost|fontdrvhost|conhost|RuntimeBroker|ApplicationFrameHost|SystemSettings|LockApp|WidgetService|msedgewebview2|backgroundTaskHost|dllhost|smartscreen|SecurityHealthSystray|OneDriveStandaloneUpdater)$/i,
];

/** Voice chat: kept by default so a party chat doesn't drop. You can still tick them. */
const VOICE_CHAT = /^(Discord|DiscordPTB|DiscordCanary|ts3client_win64|ts3client_win32|TeamSpeak|Mumble|Guilded|Vesktop)$/i;

/** Friendly names and hints for common background apps. */
const APP_HINTS = [
  [/^(OneDrive|Dropbox|GoogleDriveFS|pCloud|MEGAsync|iCloudDrive|iCloudServices)$/i, 'Syncs files: uses internet and disk'],
  [/^(msedge|chrome|firefox|brave|opera|vivaldi|iexplore)$/i, 'Web browser: tabs keep using memory and internet'],
  [/^(Teams|ms-teams|Slack|Zoom|Skype|Telegram|WhatsApp|Signal)$/i, 'Chat app'],
  [/^(Spotify|iTunes|AppleMusic|Deezer|TIDAL)$/i, 'Music app'],
  [/^(qbittorrent|uTorrent|BitTorrent|Deluge|transmission-qt|Vuze|tixati)$/i, 'Torrent client: can ruin your ping'],
  [/^(steam|EpicGamesLauncher|UbisoftConnect|upc|Battle\.net|RiotClientServices|EADesktop|GalaxyClient)$/i, 'Game launcher: may download updates in the background'],
  [/^(Creative Cloud|CCXProcess|CCLibrary|CoreSync|AdobeIPCBroker|Adobe.*|AcroTray)$/i, 'Adobe background app'],
  [/^(PhoneExperienceHost|YourPhone|Widgets|Cortana|GameBar)$/i, 'Windows extra'],
  [/^(obs64|obs32|Streamlabs.*|XSplit.*)$/i, 'Streaming or recording app'],
];

/** Services that are safe to pause during a match and are restored afterwards. */
const SERVICES = [
  { name: 'wuauserv', label: 'Windows Update', why: 'Stops update downloads during your match', default: true },
  { name: 'UsoSvc', label: 'Update Orchestrator', why: 'Starts Windows Update checks', default: true },
  { name: 'BITS', label: 'Background downloads (BITS)', why: 'Used by Windows and apps to download in the background', default: true },
  { name: 'DoSvc', label: 'Delivery Optimization', why: 'Shares Windows updates with other PCs over your internet', default: true },
  { name: 'WSearch', label: 'Windows Search indexing', why: 'Reads your disk to index files', default: true },
  { name: 'DiagTrack', label: 'Telemetry', why: 'Sends usage data to Microsoft', default: true },
  { name: 'dmwappushservice', label: 'Telemetry push', why: 'Telemetry helper', default: true },
  { name: 'WerSvc', label: 'Error reporting', why: 'Uploads crash reports', default: true },
  { name: 'MapsBroker', label: 'Offline maps updates', why: 'Downloads map data', default: true },
  { name: 'PcaSvc', label: 'Program Compatibility Assistant', why: 'Watches programs you start', default: true },
  { name: 'WMPNetworkSvc', label: 'Media sharing', why: 'Shares media on your network', default: true },
  { name: 'SysMain', label: 'SysMain (app preloading)', why: 'Preloads apps; can cause disk spikes on hard drives', default: false },
  { name: 'Spooler', label: 'Printing', why: 'Only needed to print', default: false },
  { name: 'edgeupdate', label: 'Microsoft Edge updater', why: 'Checks for Edge updates', default: true },
  { name: 'edgeupdatem', label: 'Microsoft Edge updater', why: 'Checks for Edge updates', default: true },
  { name: 'gupdate', label: 'Google updater', why: 'Checks for Chrome updates', default: true },
  { name: 'gupdatem', label: 'Google updater', why: 'Checks for Chrome updates', default: true },
  { name: 'GoogleUpdaterService', label: 'Google updater', why: 'Checks for Chrome updates', default: true, prefix: true },
  { name: 'GoogleUpdaterInternalService', label: 'Google updater', why: 'Checks for Chrome updates', default: true, prefix: true },
  { name: 'brave', label: 'Brave updater', why: 'Checks for Brave updates', default: true },
  { name: 'bravem', label: 'Brave updater', why: 'Checks for Brave updates', default: true },
  { name: 'MozillaMaintenance', label: 'Firefox updater', why: 'Installs Firefox updates', default: true },
  { name: 'AdobeARMservice', label: 'Adobe updater', why: 'Checks for Adobe updates', default: true },
  { name: 'AdobeUpdateService', label: 'Adobe updater', why: 'Checks for Adobe updates', default: true },
  { name: 'AGSService', label: 'Adobe Genuine Software', why: 'Adobe licence checks', default: true },
  { name: 'AGMService', label: 'Adobe Genuine Monitor', why: 'Adobe licence checks', default: true },
  { name: 'OneDrive Updater Service', label: 'OneDrive updater', why: 'Updates OneDrive', default: true },
  { name: 'DbxSvc', label: 'Dropbox helper', why: 'Dropbox background service', default: true },
  { name: 'ClickToRunSvc', label: 'Microsoft Office updates', why: 'Keep it if you have Office open', default: false },
];

// Power plans (well-known Windows GUIDs).
const POWER = {
  high: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e',
  ultimate: 'e9a42b02-d5df-448d-aa00-03f14749eb61',
};

/**
 * Cloud regions where online game servers (including EA's) are hosted.
 * Latency to a region is a good guide to the ping you'll get on servers there.
 */
const REGIONS = [
  ['eu-west-2', 'London'], ['eu-west-1', 'Ireland'], ['eu-central-1', 'Frankfurt'], ['eu-west-3', 'Paris'],
  ['eu-north-1', 'Stockholm'], ['eu-south-1', 'Milan'], ['me-central-1', 'UAE'], ['me-south-1', 'Bahrain'],
  ['ap-south-1', 'Mumbai'], ['ap-southeast-1', 'Singapore'], ['ap-northeast-1', 'Tokyo'], ['ap-southeast-2', 'Sydney'],
  ['us-east-1', 'Virginia (US East)'], ['us-east-2', 'Ohio'], ['us-west-2', 'Oregon (US West)'], ['us-west-1', 'California'],
  ['ca-central-1', 'Canada'], ['sa-east-1', 'São Paulo'], ['af-south-1', 'Cape Town'],
].map(([id, name]) => ({ id, name, host: `dynamodb.${id}.amazonaws.com`, port: 443 }));

/** Programs that often download or upload in the background. */
const BANDWIDTH_HOGS = /^(qbittorrent|uTorrent|BitTorrent|Deluge|transmission-qt|Vuze|tixati|steam|EpicGamesLauncher|EADesktop|UbisoftConnect|upc|Battle\.net|RiotClientServices|GalaxyClient|OneDrive|Dropbox|GoogleDriveFS|MEGAsync|iCloudDrive|obs64|Streamlabs.*|XboxPcApp|gamingservices)$/i;

/** Network adapters that belong to VPNs (they add a detour to every packet). */
const VPN_ADAPTER = /(tap-windows|wintun|wireguard|openvpn|nordlynx|nordvpn|expressvpn|protonvpn|surfshark|cyberghost|hotspot shield|private internet access|windscribe|mullvad|tunnelbear|fortinet|forticlient|cisco anyconnect|globalprotect|pangp|zerotier|hamachi|radmin vpn|tailscale|juniper|sonicwall|checkpoint)/i;

module.exports = { LAUNCHERS, PRESETS, FC_PROCESS, KEEP, VOICE_CHAT, APP_HINTS, SERVICES, POWER, REGIONS, BANDWIDTH_HOGS, VPN_ADAPTER };
