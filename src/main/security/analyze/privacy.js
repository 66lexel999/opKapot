'use strict';

const { asObjects, str, finding } = require('./common');

const CAP_LABEL = { webcam: 'Camera', microphone: 'Microphone', location: 'Location' };

/** "Microsoft.WindowsCamera_8wekyb3d8bbwe" → "Windows Camera"; "C:#Program Files#Zoom#Zoom.exe" → path. */
function appName(entry) {
  if (!entry.packaged) {
    const file = String(entry.name).replace(/#/g, '\\');
    return { name: file.split('\\').pop().replace(/\.exe$/i, ''), path: file };
  }
  const pkg = String(entry.name).split('_')[0];
  const last = pkg.split('.').filter((s) => !/^[0-9A-F]{6,}$/i.test(s)).pop() || pkg;
  const pretty = last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^Windows /, 'Windows ');
  return { name: pretty, path: '', packageName: entry.name };
}

/** Which apps used the camera, microphone or location and when. */
function analyzePrivacy(consent, now = Date.now()) {
  return asObjects(consent)
    .filter((e) => e.start && CAP_LABEL[str(e.cap)] && str(e.name))
    .map((e) => {
      const app = appName(e);
      const inUse = !!e.start && (!e.stop || e.stop === 0);
      return {
        id: `${e.cap}|${e.name}`,
        cap: e.cap,
        device: CAP_LABEL[e.cap] || e.cap,
        name: app.name,
        path: app.path,
        packageName: app.packageName || '',
        packaged: !!e.packaged,
        lastStart: e.start || null,
        lastStop: e.stop || null,
        inUse,
        duration: e.start && e.stop ? Math.max(0, e.stop - e.start) : inUse ? Math.max(0, now - e.start) : null,
      };
    })
    .sort((a, b) => (b.inUse - a.inUse) || ((b.lastStart || 0) - (a.lastStart || 0)));
}

function privacyFindings(rows) {
  const out = [];
  const live = rows.filter((r) => r.inUse && r.cap !== 'location');
  for (const r of live) {
    out.push(finding({
      id: `privacy:live:${r.id}`,
      category: 'keylogger',
      severity: 'warning',
      title: `${r.name} is using your ${r.device.toLowerCase()} right now`,
      summary: 'If you are not on a call or recording, something may be watching or listening.',
      evidence: [r.path || r.packageName],
      advice: 'Close the program if you did not start it, then run a virus scan.',
    }));
  }
  const unusual = rows.filter((r) => !r.inUse && r.cap !== 'location' && r.path && /\\(temp|appdata\\local\\temp|downloads|users\\public)\\/i.test(r.path));
  for (const r of unusual) {
    out.push(finding({
      id: `privacy:odd:${r.id}`,
      category: 'keylogger',
      severity: 'warning',
      title: `An app from an unusual folder used your ${r.device.toLowerCase()}`,
      summary: `${r.name} ran from a temporary or download folder and accessed the ${r.device.toLowerCase()}.`,
      evidence: [r.path],
    }));
  }
  if (!out.length) {
    out.push(finding({
      id: 'privacy:ok', category: 'keylogger', severity: 'ok',
      title: 'Camera and microphone are not in use',
      summary: `${rows.filter((r) => r.cap !== 'location').length} apps have used them before. See Camera & Mic for details.`,
    }));
  }
  return out;
}

module.exports = { analyzePrivacy, privacyFindings, appName };
