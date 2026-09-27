'use strict';

// Curated reference data used by the analyzers.

/** Remote-control software. If you didn't install it, someone else may control your PC with it. */
const REMOTE_TOOLS = [
  { name: 'TeamViewer', process: /^teamviewer(_service|_desktop)?$|^tv_(w32|x64)$/i },
  { name: 'AnyDesk', process: /^anydesk$/i },
  { name: 'RustDesk', process: /^rustdesk$/i },
  { name: 'ScreenConnect (ConnectWise Control)', process: /^screenconnect\./i },
  { name: 'Splashtop', process: /^(srserver|srservice|srmanager|srfeature)$/i },
  { name: 'LogMeIn', process: /^(logmein|lmiguardiansvc|lmi_rescue|logmeinsystray|lmi_rescuesrv)$/i },
  { name: 'GoTo Resolve', process: /^goto(resolve|assist)/i },
  { name: 'Chrome Remote Desktop', process: /^remoting_host$/i },
  { name: 'VNC server', process: /^(winvnc\d*|tvnserver|vncserver|uvnc_service|ultravnc|tightvnc)$/i },
  { name: 'Radmin', process: /^(rserver3|radmin_server)$/i },
  { name: 'Ammyy Admin', process: /^(aa_v3|ammyy_admin)$/i },
  { name: 'Supremo', process: /^supremo(service|system)?$/i },
  { name: 'UltraViewer', process: /^ultraviewer(_service|_desktop)?$/i },
  { name: 'NoMachine', process: /^(nxserver|nxnode|nxd|nxservice\d*)$/i },
  { name: 'Remote Utilities', process: /^(rutserv|rfusclient)$/i },
  { name: 'MeshCentral agent', process: /^meshagent$/i },
  { name: 'Atera agent', process: /^ateraagent$/i },
  { name: 'NetSupport Manager', process: /^client32$/i, company: /netsupport/i },
  { name: 'Zoho Assist', process: /^(zaservice|zohoassist|zohours)/i },
  { name: 'DWService', process: /^(dwagent|dwagsvc)$/i },
  { name: 'Parsec', process: /^parsecd$/i },
  { name: 'Quick Assist', process: /^quickassist$/i },
  { name: 'Action1 agent', process: /^action1_agent/i },
  { name: 'Tactical RMM', process: /^tacticalrmm$/i },
  { name: 'SimpleHelp', process: /^(simplegatewayservice|simpleservice|remote access)$/i },
];

/** Keyloggers and "monitoring" products that record keystrokes, screens and chats. */
const SPYWARE = [
  { name: 'Refog', match: /refog/i },
  { name: 'Spyrix', match: /spyrix/i },
  { name: 'Revealer Keylogger', match: /revealer/i },
  { name: 'Actual Keylogger', match: /actual\s*keylogger|actualkeylogger/i },
  { name: 'Ardamax Keylogger', match: /ardamax/i },
  { name: 'Elite Keylogger', match: /elite\s*keylogger/i },
  { name: 'Kidlogger', match: /kidlogger/i },
  { name: 'SpyAgent (Spytech)', match: /spytech|spyagent/i },
  { name: 'WebWatcher', match: /webwatcher/i },
  { name: 'FlexiSPY', match: /flexispy/i },
  { name: 'Hoverwatch', match: /hoverwatch/i },
  { name: 'Wolfeye', match: /wolfeye/i },
  { name: 'SoftActivity', match: /softactivity/i },
  { name: 'Kickidler', match: /kickidler/i },
  { name: 'Best Free Keylogger', match: /bestfreekeylogger|best free keylogger/i },
  { name: 'Perfect Keylogger (BlazingTools)', match: /blazingtools|perfect\s*keylogger|bpk\.exe/i },
  { name: 'Realtime-Spy', match: /realtime-?spy/i },
  { name: 'Spytector', match: /spytector/i },
  { name: 'iWantSoft keylogger', match: /iwantsoft/i },
  { name: 'StaffCop', match: /staffcop/i, work: true },
  { name: 'Teramind', match: /teramind/i, work: true },
  { name: 'ActivTrak', match: /activtrak/i, work: true },
  { name: 'Veriato', match: /veriato|spector\s*360/i, work: true },
  { name: 'InterGuard', match: /interguard/i, work: true },
  { name: 'Work Examiner', match: /workexaminer|work examiner/i, work: true },
  { name: 'A keylogger program', match: /key\s*-?logg?er|keylog/i },
];

/** Windows process names that malware likes to copy. */
const SYSTEM_PROCESS_NAMES = new Set([
  'svchost.exe', 'lsass.exe', 'csrss.exe', 'winlogon.exe', 'services.exe', 'smss.exe', 'wininit.exe', 'spoolsv.exe',
  'taskhostw.exe', 'dwm.exe', 'conhost.exe', 'rundll32.exe', 'lsm.exe', 'explorer.exe', 'dllhost.exe', 'sihost.exe',
  'ctfmon.exe', 'fontdrvhost.exe', 'searchindexer.exe', 'runtimebroker.exe', 'audiodg.exe', 'wuauclt.exe', 'taskmgr.exe',
  'regsvr32.exe',
]);

/** Keyboard filter drivers from these publishers are normal hardware add-ons. */
const HARDWARE_VENDORS = /microsoft|hewlett|hp inc|\bhp\b|dell|lenovo|logitech|razer|synaptics|elan|asus|acer|intel|corsair|steelseries|alps|cypress|samsung|micro-star|\bmsi\b|toshiba|dynabook|sony|fujitsu|roccat|turtle beach|wooting|hyperx|kingston|cherry|glorious|ducky|vmware|oracle|parallels|citrix|nvidia|realtek|focaltech|huawei|xiaomi|panasonic|getac|zebra|honeywell|gigabyte|avermedia|elgato|keychron|redragon|cooler master|thermaltake/i;

const KNOWN_SECURITY_PACKAGES = new Set(['kerberos', 'msv1_0', 'schannel', 'wdigest', 'tspkg', 'pku2u', 'cloudap', 'negoexts', 'livessp', '""', '']);
const KNOWN_NOTIFICATION_PACKAGES = new Set(['scecli', 'rassfm', 'passfilt', '']);
const KNOWN_AUTH_PACKAGES = new Set(['msv1_0', '']);

/** Accessibility tools that can be launched from the Windows sign-in screen. */
const ACCESSIBILITY_EXES = new Set(['sethc.exe', 'utilman.exe', 'osk.exe', 'narrator.exe', 'magnify.exe', 'displayswitch.exe', 'atbroker.exe', 'editionupgrademanager.exe']);

/** Programs that normally accept connections from the internet. */
const P2P_AND_GAMES = /^(utorrent|qbittorrent|bittorrent|transmission(-qt)?|deluge|tixati|vuze|frostwire|biglybt|steam|steamservice|steamwebhelper|epicgameslauncher|battle\.net|parsecd|discord|spotify|syncthing|resilio sync|dropbox|onedrive|teams|zoom|obs64|nvcontainer|nvidia share|plex media server|jellyfin|emby|minecraft|javaw|java|srcds|valheim_server|terraria|factorio|vrserver|tailscaled|zerotier.*|hamachi.*|radmin vpn)$/i;

/** Ports used for remote control. */
const REMOTE_PORTS = new Map([
  [3389, 'Remote Desktop'], [5900, 'VNC'], [5901, 'VNC'], [5902, 'VNC'], [5938, 'TeamViewer'], [7070, 'AnyDesk'],
  [22, 'SSH'], [23, 'Telnet'], [5985, 'PowerShell remoting'], [5986, 'PowerShell remoting'], [4899, 'Radmin'], [21115, 'RustDesk'],
  [21116, 'RustDesk'], [21118, 'RustDesk'], [6568, 'AnyDesk'], [8040, 'ScreenConnect'], [8041, 'ScreenConnect'],
]);

/** Domains that must never be blocked or redirected by the hosts file. */
const SECURITY_DOMAINS = /(^|\.)(windowsupdate\.(com|microsoft\.com)|update\.microsoft\.com|download\.microsoft\.com|wdcp\.microsoft\.com|wdcpalt\.microsoft\.com|definitionupdates\.microsoft\.com|smartscreen(-prod)?\.microsoft\.com|go\.microsoft\.com|virustotal\.com|malwarebytes\.(com|org)|kaspersky\.(com|ru)|avast\.com|avg\.com|eset\.com|bitdefender\.(com|net)|norton\.com|symantec\.com|mcafee\.com|sophos\.com|trendmicro\.com|avira\.com|f-secure\.com|emsisoft\.com|hitmanpro\.com|drweb\.com|zemana\.com|adwcleaner\.com)$/i;

/** Popular sites that phishing malware redirects through the hosts file. */
const POPULAR_DOMAINS = /(^|\.)(google\.[a-z.]+|gmail\.com|youtube\.com|facebook\.com|instagram\.com|whatsapp\.(com|net)|twitter\.com|x\.com|microsoft\.com|live\.com|outlook\.com|office\.com|apple\.com|icloud\.com|amazon\.[a-z.]+|paypal\.com|ebay\.[a-z.]+|netflix\.com|steamcommunity\.com|steampowered\.com|discord\.com|discordapp\.com|epicgames\.com|roblox\.com|binance\.com|coinbase\.com|blockchain\.com|metamask\.io|github\.com|yahoo\.com|bing\.com|linkedin\.com|tiktok\.com|reddit\.com|twitch\.tv|spotify\.com)$|bank|login|secure|account|wallet/i;

/** Root certificates known to be dangerous, and tools that intercept HTTPS on purpose. */
const BAD_ROOTS = /superfish|edellroot|dsdtestprovider|privdog|komodia|visualdiscovery|sendori/i;
const INTERCEPT_ROOTS = /fiddler|do_not_trust|charles proxy|portswigger|burp|mitmproxy|telerik|proxyman|httptoolkit|http toolkit|zscaler|netfree|kaspersky|avast|avg|eset|bitdefender|norton|sophos|fortinet|cisco umbrella|adguard|net nanny|qustodio/i;

/** Plain-English meaning of Microsoft Defender threat-name prefixes. */
const THREAT_TYPES = [
  [/^ransom/i, 'Ransomware', 'Encrypts your files and demands payment.'],
  [/^(trojanspy|pws|spyware|infostealer)/i, 'Spyware / password stealer', 'Steals passwords, cookies or records what you type.'],
  [/^backdoor/i, 'Backdoor', 'Lets attackers control your PC remotely.'],
  [/^trojandownloader|^trojandropper/i, 'Downloader', 'Downloads and installs more malware.'],
  [/^trojan/i, 'Trojan', 'Malicious program disguised as something harmless.'],
  [/^(worm)/i, 'Worm', 'Spreads itself to other files or computers.'],
  [/^virus/i, 'Virus', 'Infects other programs on your PC.'],
  [/^exploit/i, 'Exploit', 'Abuses a security hole to get into your system.'],
  [/^hacktool/i, 'Hack tool', 'Often a crack, keygen or activator for pirated software. These frequently hide real malware.'],
  [/^(pua|pup|adware|browsermodifier|softwarebundler)/i, 'Unwanted software', 'Adware, bundleware or a program that changes your browser.'],
  [/^behavior/i, 'Suspicious behaviour', 'A program acted like malware while it was running.'],
  [/^settingsmodifier/i, 'Settings hijack', 'Changes important Windows or browser settings.'],
  [/^(misleading|rogue)/i, 'Scareware', 'Fake alerts that trick you into paying or installing things.'],
  [/^(coinminer|trojan:.*coinminer)/i, 'Crypto miner', 'Uses your PC to mine cryptocurrency.'],
  [/^(virtool|script)/i, 'Malicious tool', 'Tool used to hide or run malware.'],
];

module.exports = {
  REMOTE_TOOLS, SPYWARE, SYSTEM_PROCESS_NAMES, HARDWARE_VENDORS, KNOWN_SECURITY_PACKAGES, KNOWN_NOTIFICATION_PACKAGES,
  KNOWN_AUTH_PACKAGES, ACCESSIBILITY_EXES, P2P_AND_GAMES, REMOTE_PORTS, SECURITY_DOMAINS, POPULAR_DOMAINS, BAD_ROOTS,
  INTERCEPT_ROOTS, THREAT_TYPES,
};
