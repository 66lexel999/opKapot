'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { powershell, powershellJson, psQuote, asArray } = require('../lib/exec');
const { runJob } = require('./jobs');

const P = path.win32;

const LIST_SCRIPT = `
$out = foreach ($p in @(Get-AppxPackage -PackageTypeFilter Main)) {
  if ($p.IsFramework -or $p.NonRemovable -or ([string]$p.SignatureKind -eq 'System')) { continue }
  [ordered]@{
    Name = [string]$p.Name; FullName = [string]$p.PackageFullName; FamilyName = [string]$p.PackageFamilyName
    Publisher = [string]$p.Publisher; Version = [string]$p.Version
    InstallLocation = [string]$p.InstallLocation; SignatureKind = [string]$p.SignatureKind
  }
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress`;

// Store apps whose manifests only carry resource ids for their display name.
const KNOWN_NAMES = {
  'Microsoft.WindowsCalculator': 'Calculator',
  'Microsoft.ZuneMusic': 'Media Player',
  'Microsoft.ZuneVideo': 'Movies & TV',
  'Microsoft.BingWeather': 'Weather',
  'Microsoft.BingNews': 'News',
  'Microsoft.BingSearch': 'Bing Search',
  'Microsoft.GetHelp': 'Get Help',
  'Microsoft.Getstarted': 'Tips',
  'Microsoft.MicrosoftSolitaireCollection': 'Solitaire & Casual Games',
  'Microsoft.WindowsAlarms': 'Clock',
  'Microsoft.WindowsCamera': 'Camera',
  'microsoft.windowscommunicationsapps': 'Mail and Calendar',
  'Microsoft.WindowsFeedbackHub': 'Feedback Hub',
  'Microsoft.WindowsMaps': 'Maps',
  'Microsoft.WindowsSoundRecorder': 'Sound Recorder',
  'Microsoft.XboxApp': 'Xbox Console Companion',
  'Microsoft.GamingApp': 'Xbox',
  'Microsoft.XboxGamingOverlay': 'Xbox Game Bar',
  'Microsoft.XboxIdentityProvider': 'Xbox Identity Provider',
  'Microsoft.XboxSpeechToTextOverlay': 'Xbox Speech to Text',
  'Microsoft.Xbox.TCUI': 'Xbox Live in-game experience',
  'Microsoft.YourPhone': 'Phone Link',
  'Microsoft.Todos': 'Microsoft To Do',
  'Microsoft.People': 'People',
  'Microsoft.MicrosoftStickyNotes': 'Sticky Notes',
  'Microsoft.Paint': 'Paint',
  'Microsoft.MSPaint': 'Paint 3D',
  'Microsoft.Microsoft3DViewer': '3D Viewer',
  'Microsoft.WindowsNotepad': 'Notepad',
  'Microsoft.WindowsTerminal': 'Terminal',
  'Microsoft.ScreenSketch': 'Snipping Tool',
  'Microsoft.Windows.Photos': 'Photos',
  'Microsoft.WindowsStore': 'Microsoft Store',
  'Microsoft.MicrosoftOfficeHub': 'Microsoft 365 (Office)',
  'Microsoft.OutlookForWindows': 'Outlook (new)',
  'Microsoft.PowerAutomateDesktop': 'Power Automate',
  'Microsoft.549981C3F5F10': 'Cortana',
  'Microsoft.MicrosoftEdge.Stable': 'Microsoft Edge',
  'Microsoft.SkypeApp': 'Skype',
  'Microsoft.MixedReality.Portal': 'Mixed Reality Portal',
  'Microsoft.WindowsAlarms.Clock': 'Clock',
  'Microsoft.Copilot': 'Copilot',
  'Microsoft.Windows.DevHome': 'Dev Home',
  'MicrosoftCorporationII.QuickAssist': 'Quick Assist',
  'MicrosoftTeams': 'Microsoft Teams (personal)',
  'MSTeams': 'Microsoft Teams',
  'Clipchamp.Clipchamp': 'Microsoft Clipchamp',
  '5319275A.WhatsAppDesktop': 'WhatsApp',
};

function prettifyPackageName(name) {
  if (KNOWN_NAMES[name]) return KNOWN_NAMES[name];
  const last = name.split('.').filter((s) => !/^[0-9A-F]{6,}$/i.test(s)).pop() || name;
  return last
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function tag(xml, name) {
  const m = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : '';
}

async function readManifest(location) {
  try {
    const xml = await fs.promises.readFile(P.join(location, 'AppxManifest.xml'), 'utf8');
    const props = /<Properties>([\s\S]*?)<\/Properties>/.exec(xml)?.[1] || '';
    return { displayName: tag(props, 'DisplayName'), publisher: tag(props, 'PublisherDisplayName'), logo: tag(props, 'Logo') };
  } catch {
    return {};
  }
}

/** Resolve "Assets\\StoreLogo.png" to the scaled file that actually exists and inline it. */
async function logoDataUrl(location, logo) {
  if (!logo) return null;
  const full = P.join(location, logo);
  const dir = P.dirname(full);
  const ext = P.extname(full);
  const base = P.basename(full, ext).toLowerCase();
  try {
    const files = (await fs.promises.readdir(dir)).filter((f) => {
      const lower = f.toLowerCase();
      return lower.endsWith(ext.toLowerCase()) && (lower === `${base}${ext.toLowerCase()}` || lower.startsWith(`${base}.`));
    });
    if (!files.length) return null;
    const rank = (f) => (/scale-100|targetsize-48/i.test(f) ? 0 : /scale-200|targetsize-32/i.test(f) ? 1 : 2);
    files.sort((a, b) => rank(a) - rank(b));
    const data = await fs.promises.readFile(P.join(dir, files[0]));
    if (data.length > 256 * 1024) return null;
    return `data:image/png;base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

async function listApps() {
  const raw = asArray(await powershellJson(LIST_SCRIPT, { timeout: 120_000 }));
  const apps = await Promise.all(raw.filter((a) => a && a.FullName).map(async (a) => {
    const manifest = a.InstallLocation ? await readManifest(a.InstallLocation) : {};
    let displayName = manifest.displayName || '';
    if (!displayName || displayName.startsWith('ms-resource:')) displayName = prettifyPackageName(a.Name);
    let installDate = null;
    try {
      const stat = await fs.promises.stat(a.InstallLocation);
      installDate = stat.birthtimeMs || stat.mtimeMs;
    } catch { /* ignore */ }
    const publisher = manifest.publisher && !manifest.publisher.startsWith('ms-resource:')
      ? manifest.publisher
      : (/CN=([^,]+)/.exec(a.Publisher)?.[1] || '');
    return {
      id: a.FullName,
      name: displayName,
      packageName: a.Name,
      fullName: a.FullName,
      publisher,
      version: a.Version,
      installLocation: a.InstallLocation,
      installDate,
      size: null,
      icon: a.InstallLocation ? await logoDataUrl(a.InstallLocation, manifest.logo) : null,
    };
  }));

  const locations = apps.map((a) => a.installLocation).filter(Boolean);
  if (locations.length) {
    const { sizes } = await runJob('folderSizes', { paths: locations });
    for (const app of apps) app.size = sizes[app.installLocation] ?? null;
  }
  return apps;
}

async function removeApp(app) {
  const res = await powershell(`Remove-AppxPackage -Package ${psQuote(app.fullName)} -ErrorAction Stop; 'OK'`, { timeout: 600_000 });
  if (res.stdout.includes('OK')) return { ok: true };
  return { ok: false, error: (res.stderr || 'Removal failed').trim().split(/\r?\n/)[0] };
}

module.exports = { listApps, removeApp, prettifyPackageName };
