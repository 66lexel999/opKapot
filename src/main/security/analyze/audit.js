'use strict';

const K = require('./knowledge');
const {
  P, asArray, asObjects, str, sectionError, classifyIp, daysAgo, finding, pathKind, USER_WRITABLE, KIND_LABEL, normalizeWinPath,
  sigState, signerName, describeSig, isMicrosoftSigned, envGet, SEVERITY_ORDER, CATEGORIES,
} = require('./common');
const { networkFindings, matchRemoteTool } = require('./network');
const { autorunFindings } = require('./autoruns');
const { extensionFindings } = require('./extensions');
const { hostsFindings } = require('./hosts');
const { privacyFindings } = require('./privacy');

const DAY = 86_400_000;
const WINDOWS_SECURITY = { label: 'Open Windows Security', uri: 'windowsdefender://threatsettings' };

function avProducts(a) {
  return asArray(a.avProducts).map((p) => ({
    name: p.name,
    on: ((Number(p.state) >> 12) & 0xf) === 1,
    current: ((Number(p.state) >> 4) & 0xf) === 0,
  }));
}

// ------------------------------------------------------------ protection ---

function exclusionRisk(kind, value, env) {
  const v = String(value).toLowerCase().replace(/\\+$/, '');
  if (kind === 'extension') {
    return /^(exe|dll|scr|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|hta|msi|lnk|sys|pif|jar|wsf)$/.test(v.replace(/^\*?\./, '')) ? 'danger' : 'warning';
  }
  if (kind === 'process') {
    return /(^|\\)(powershell|pwsh|cmd|wscript|cscript|mshta|rundll32|regsvr32|explorer|svchost|msiexec)\.exe$/.test(v) ? 'danger' : 'warning';
  }
  if (/^[a-z]:$/.test(v) || v.includes('*') || v === '') return 'danger';
  const broad = ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'SystemRoot', 'PUBLIC']
    .map((n) => String(envGet(env, n) || '').toLowerCase()).filter(Boolean);
  if (broad.includes(v) || /^[a-z]:\\(users|windows|windows\\system32|programdata|program files( \(x86\))?)$/.test(v)) return 'danger';
  if (/\\(downloads|desktop|appdata|temp)$/.test(v)) return 'danger';
  return 'warning';
}

function protection(a, env, now) {
  const out = [];
  const d = a.defender && !sectionError(a.defender) ? a.defender : null;
  const avs = avProducts(a);
  const others = avs.filter((p) => p.on && !/defender|windows security/i.test(p.name));
  const defenderActive = d && d.antivirusEnabled && d.realTime;

  if (defenderActive) {
    out.push(finding({ id: 'av:on', category: 'protection', severity: 'ok', title: 'Microsoft Defender real-time protection is on', summary: 'Files are checked for viruses as soon as they are opened or downloaded.' }));
  } else if (others.length) {
    out.push(finding({ id: 'av:other', category: 'protection', severity: 'ok', title: `Protected by ${others.map((o) => o.name).join(', ')}`, summary: 'Another antivirus is active, so Microsoft Defender is resting. That\'s normal.' }));
  } else {
    out.push(finding({
      id: 'av:off', category: 'protection', severity: 'danger',
      title: 'Real-time virus protection is off',
      summary: 'Nothing is checking files for viruses as you open or download them. Malware often switches this off.',
      advice: 'Turn it back on. If it keeps turning off, run an offline scan from Virus Scan.',
      fix: d ? { label: 'Turn on', action: { type: 'defender-pref', name: 'realtime' }, confirm: 'Turn Microsoft Defender real-time protection back on?' } : null,
      link: WINDOWS_SECURITY,
    }));
  }

  if (d && d.antivirusEnabled) {
    const age = daysAgo(d.signatureUpdated, now);
    if (age == null || age > 3) {
      out.push(finding({
        id: 'av:signatures', category: 'protection', severity: age == null || age > 7 ? 'warning' : 'notice',
        title: age == null ? 'Virus definitions may be out of date' : `Virus definitions are ${age} days old`,
        summary: 'New viruses appear every day. Old definitions can miss them.',
        fix: { label: 'Update now', action: { type: 'defender-update' }, confirm: 'Download the latest virus definitions now?' },
      }));
    }
    for (const [kind, list] of [['path', d.exclusionPath], ['extension', d.exclusionExtension], ['process', d.exclusionProcess]]) {
      for (const value of asArray(list).map(str)) {
        if (!value || /^N\/A/i.test(value)) continue;
        const sev = exclusionRisk(kind, value, env);
        out.push(finding({
          id: `av:exclusion:${kind}:${value.toLowerCase()}`, category: 'protection', severity: sev,
          title: `Microsoft Defender is told to ignore ${kind === 'path' ? 'a folder' : kind === 'extension' ? 'a file type' : 'a program'}: ${value}`,
          summary: sev === 'danger'
            ? 'This exclusion is very broad. Malware adds exclusions like this so it is never scanned.'
            : 'Games and developer tools sometimes add exclusions, but malware does too.',
          advice: 'Remove it unless you added it on purpose.',
          fix: { label: 'Remove exclusion', action: { type: 'defender-exclusion-remove', kind, value }, confirm: `Stop excluding "${value}" from virus scans?` },
        }));
      }
    }
    const prefs = [
      ['disableBehavior', 'behavior', 'Behaviour monitoring is off', 'It spots programs acting like malware, even brand-new ones.'],
      ['disableIoav', 'ioav', 'Download scanning is off', 'Files you download are not checked.'],
      ['disableScript', 'script', 'Script scanning is off', 'Malicious scripts in files and web pages are not checked.'],
    ];
    for (const [key, name, title, why] of prefs) {
      if (d[key]) out.push(finding({ id: `av:${name}`, category: 'protection', severity: 'warning', title, summary: why, fix: { label: 'Turn on', action: { type: 'defender-pref', name }, confirm: `${title.replace(' is off', '')}: turn it back on?` } }));
    }
    if (d.maps === 0) out.push(finding({ id: 'av:cloud', category: 'protection', severity: 'warning', title: 'Cloud-delivered protection is off', summary: 'Defender can\'t ask Microsoft\'s cloud about new, unknown threats.', fix: { label: 'Turn on', action: { type: 'defender-pref', name: 'maps' }, confirm: 'Turn on cloud-delivered protection?' } }));
    if (d.pua === 0) out.push(finding({ id: 'av:pua', category: 'protection', severity: 'notice', title: 'Unwanted-app blocking is off', summary: 'Turning it on blocks adware, bundleware and fake "PC optimizers".', fix: { label: 'Turn on', action: { type: 'defender-pref', name: 'pua' }, confirm: 'Block potentially unwanted apps?' } }));
    if (!d.tamper) out.push(finding({ id: 'av:tamper', category: 'protection', severity: 'notice', title: 'Tamper Protection is off', summary: 'It stops malware from switching Defender off. It can only be turned on in Windows Security.', link: WINDOWS_SECURITY }));
    const lastScan = Math.max(d.quickScanEnd || 0, d.fullScanEnd || 0);
    if (!lastScan || now - lastScan > 30 * DAY) {
      out.push(finding({ id: 'av:noscan', category: 'protection', severity: 'notice', title: 'No virus scan in the last 30 days', summary: 'Run a Quick Scan from the Virus Scan page.', link: { label: 'Go to Virus Scan', view: 'security/scan' } }));
    }
  }

  // Firewall
  const fwOther = asArray(a.firewallProducts).filter((p) => ((Number(p.state) >> 12) & 0xf) === 1 && !/windows|defender/i.test(p.name));
  const profiles = asArray(a.firewall);
  const off = profiles.filter((p) => String(p.enabled) !== 'True');
  if (profiles.length && off.length && !fwOther.length) {
    const publicOff = off.some((p) => /public/i.test(p.name));
    out.push(finding({
      id: 'fw:off', category: 'protection', severity: publicOff ? 'danger' : 'warning',
      title: `Windows Firewall is off for ${off.map((p) => p.name).join(', ')} networks`,
      summary: 'Other devices on the network can reach programs on your PC directly.',
      fix: { label: 'Turn on', action: { type: 'firewall-on' }, confirm: 'Turn Windows Firewall on for all networks?' },
    }));
  } else if (profiles.length || fwOther.length) {
    out.push(finding({ id: 'fw:on', category: 'protection', severity: 'ok', title: fwOther.length ? `Firewall: ${fwOther[0].name}` : 'Windows Firewall is on', summary: 'Unrequested connections from other devices are blocked.' }));
  }
  const allowAll = profiles.filter((p) => String(p.enabled) === 'True' && String(p.inbound) === 'Allow');
  if (allowAll.length) {
    out.push(finding({ id: 'fw:inbound', category: 'protection', severity: 'warning', title: 'Firewall lets all incoming connections through', summary: `The ${allowAll.map((p) => p.name).join(', ')} profile allows every inbound connection by default.` }));
  }

  const s = a.settings && !sectionError(a.settings) ? a.settings : {};
  if (s.enableLua === 0) {
    out.push(finding({ id: 'uac:off', category: 'protection', severity: 'danger', title: 'User Account Control (UAC) is off', summary: 'Every program gets full administrator rights without asking you.', fix: { label: 'Turn on', action: { type: 'reg-set', regKey: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'EnableLUA', value: 1, valueType: 'DWord' }, confirm: 'Turn UAC back on? You need to restart Windows afterwards.' } }));
  } else if (s.consentAdmin === 0) {
    out.push(finding({ id: 'uac:silent', category: 'protection', severity: 'warning', title: 'Programs get admin rights without asking', summary: 'UAC is set to "Never notify", so malware can change your system silently.', fix: { label: 'Ask me', action: { type: 'reg-set', regKey: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', name: 'ConsentPromptBehaviorAdmin', value: 5, valueType: 'DWord' }, confirm: 'Ask for permission before programs make changes?' } }));
  }
  if (s.smartScreenPolicy === 0 || /^off$/i.test(s.smartScreenExplorer || '')) {
    out.push(finding({ id: 'smartscreen:off', category: 'protection', severity: 'warning', title: 'SmartScreen is off', summary: 'Windows won\'t warn you before you run unknown downloaded programs.', link: WINDOWS_SECURITY }));
  }

  const os = a.os && !sectionError(a.os) ? a.os : {};
  const updAge = daysAgo(os.lastUpdate, now);
  if (updAge != null && updAge > 45) {
    out.push(finding({ id: 'updates:old', category: 'protection', severity: 'warning', title: `Windows hasn't installed updates for ${updAge} days`, summary: 'Updates close security holes that attackers use.', link: { label: 'Open Windows Update', uri: 'ms-settings:windowsupdate' } }));
  }
  const bcd = asArray(os.bcd).join('\n');
  if (/testsigning\s+yes/i.test(bcd) || /nointegritychecks\s+yes/i.test(bcd)) {
    out.push(finding({ id: 'bcd:testsigning', category: 'protection', severity: 'danger', title: 'Driver signature checks are disabled', summary: 'Windows is allowing unsigned drivers. Rootkits need this to load.', evidence: asArray(os.bcd).filter((l) => /testsigning|nointegritychecks/i.test(l)) }));
  }
  if (os.secureBoot === false) {
    out.push(finding({ id: 'secureboot:off', category: 'protection', severity: 'notice', title: 'Secure Boot is off', summary: 'Secure Boot stops bootkits from loading before Windows. You can turn it on in your PC\'s BIOS/UEFI settings.' }));
  }
  return out;
}

// ---------------------------------------------------------------- remote ---

function remote(a, ctx) {
  const out = [];
  const r = a.rdp && !sectionError(a.rdp) ? a.rdp : {};
  const sessions = asArray(r.sessions).filter((l) => /rdp-tcp#\d+/i.test(l));
  if (sessions.length) {
    out.push(finding({
      id: 'rdp:session', category: 'remote', severity: 'danger',
      title: 'Someone is connected with Remote Desktop right now',
      summary: 'A remote session is open on this PC. If it isn\'t you, disconnect the network cable or Wi-Fi now and change your password.',
      evidence: sessions.map((l) => l.trim()),
      fix: { label: 'Turn off Remote Desktop', action: { type: 'rdp-off' }, confirm: 'Turn off Remote Desktop? Current remote sessions will stop working.' },
    }));
  }
  if (r.deny === 0) {
    out.push(finding({
      id: 'rdp:on', category: 'remote', severity: r.nla === 0 ? 'danger' : 'warning',
      title: 'Remote Desktop is turned on',
      summary: `Anyone who knows (or guesses) your password can control this PC over the network${r.nla === 0 ? ', and extra sign-in protection (NLA) is off' : ''}.`,
      evidence: [`Port ${r.port || 3389}`],
      advice: 'Turn it off unless you use it to reach this PC from elsewhere.',
      fix: { label: 'Turn off', action: { type: 'rdp-off' }, confirm: 'Turn off Remote Desktop?' },
    }));
  } else if (r.deny === 1) {
    out.push(finding({ id: 'rdp:off', category: 'remote', severity: 'ok', title: 'Remote Desktop is off', summary: 'Nobody can connect to this PC with Remote Desktop.' }));
  }
  if (r.remoteAssistance === 1) {
    out.push(finding({ id: 'ra:on', category: 'remote', severity: 'notice', title: 'Remote Assistance invitations are allowed', summary: 'Tech-support scammers ask victims to send these invitations.', fix: { label: 'Turn off', action: { type: 'ra-off' }, confirm: 'Turn off Remote Assistance?' } }));
  }

  // Remote-control programs running or installed
  const running = new Map();
  for (const p of asArray(a.processes)) {
    const tool = matchRemoteTool(p);
    if (tool && !running.has(tool.name)) running.set(tool.name, p);
  }
  for (const [name, p] of running) {
    out.push(finding({
      id: `remote-tool:${name.toLowerCase()}`, category: 'remote', severity: 'warning',
      title: `${name} is running`,
      summary: `${name} lets someone see and control your screen. Fine if you use it; if you didn't install it, a scammer or attacker may have.`,
      evidence: [p.path || p.name],
      advice: 'Close and uninstall it if you don\'t use it.',
      fix: { label: 'Close it', action: { type: 'kill-process', pid: p.pid }, confirm: `Close ${name} now?` },
    }));
  }
  const installed = new Set();
  for (const prog of asArray(a.programs)) {
    const tool = K.REMOTE_TOOLS.find((t) => new RegExp(t.name.split(' ')[0], 'i').test(prog.name));
    if (tool && !running.has(tool.name) && !installed.has(tool.name)) {
      installed.add(tool.name);
      out.push(finding({ id: `remote-installed:${tool.name.toLowerCase()}`, category: 'remote', severity: 'notice', title: `${prog.name} is installed`, summary: 'Remote-control software. Remove it in Programs if you don\'t use it.' }));
    }
  }
  if (!running.size) out.push(finding({ id: 'remote-tool:none', category: 'remote', severity: 'ok', title: 'No remote-control programs are running', summary: 'Checked for TeamViewer, AnyDesk, RustDesk, VNC, ScreenConnect and 20 more.' }));

  // Sign-ins from other computers
  const logons = a.logons && !sectionError(a.logons) ? a.logons : {};
  const localIps = new Set(ctx.localIps || []);
  const remoteLogons = asArray(logons.success)
    .filter((l) => l.ip && l.ip !== '-' && !['loopback', 'none'].includes(classifyIp(l.ip)) && !localIps.has(l.ip));
  const rdpLogons = [...asArray(logons.rdp).filter((l) => l.ip), ...remoteLogons.filter((l) => String(l.type) === '10')];
  const internet = remoteLogons.filter((l) => classifyIp(l.ip) === 'public').concat(rdpLogons.filter((l) => classifyIp(l.ip) === 'public'));
  if (internet.length) {
    out.push(finding({
      id: 'logon:internet', category: 'remote', severity: 'danger',
      title: 'Someone signed in to this PC from the internet',
      summary: 'A sign-in came from an internet address, not from your own network.',
      evidence: dedupeLogons(internet).map(fmtLogon),
      advice: 'Change your Windows password now, turn off Remote Desktop and file sharing, and check Startup Manager.',
    }));
  }
  const lan = [...remoteLogons, ...rdpLogons].filter((l) => classifyIp(l.ip) !== 'public');
  if (lan.length) {
    out.push(finding({
      id: 'logon:lan', category: 'remote', severity: rdpLogons.some((l) => classifyIp(l.ip) !== 'public') ? 'warning' : 'notice',
      title: 'Other computers on your network signed in to this PC',
      summary: 'For example to open shared folders or use Remote Desktop. Check that you know these devices.',
      evidence: dedupeLogons(lan).map(fmtLogon),
    }));
  }
  const failed = asArray(logons.failed);
  if (failed.length) {
    const byIp = new Map();
    for (const f of failed) byIp.set(f.ip || '-', (byIp.get(f.ip || '-') || 0) + 1);
    const publicFails = failed.filter((f) => classifyIp(f.ip) === 'public').length;
    const sev = publicFails >= 5 || failed.length >= 30 ? 'danger' : failed.length >= 10 ? 'warning' : 'notice';
    out.push(finding({
      id: 'logon:failed', category: 'remote', severity: sev,
      title: `${failed.length} failed sign-in attempt${failed.length > 1 ? 's' : ''} in the last 14 days`,
      summary: sev === 'notice' ? 'Probably just mistyped passwords.' : 'Someone may be trying to guess your password.',
      evidence: [...byIp].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([ip, n]) => `${n}× from ${ip === '-' ? 'this PC' : ip}`),
    }));
  }
  if (!internet.length && !lan.length && !sessions.length && !failed.length && !sectionError(a.logons)) {
    out.push(finding({ id: 'logon:ok', category: 'remote', severity: 'ok', title: 'No one else has signed in to this PC', summary: 'No remote or network sign-ins in the last 14 days.' }));
  }

  const s = a.settings && !sectionError(a.settings) ? a.settings : {};
  if (s.remoteRegistry && /running/i.test(s.remoteRegistry.status)) {
    out.push(finding({ id: 'remote-registry', category: 'remote', severity: 'warning', title: 'Remote Registry is running', summary: 'Other computers can read and change this PC\'s settings.', fix: { label: 'Disable', action: { type: 'remote-registry-off' }, confirm: 'Stop and disable the Remote Registry service?' } }));
  }

  // Router port forwards to this PC (UPnP)
  const upnp = ctx.upnp && !sectionError(ctx.upnp) ? ctx.upnp : null;
  const mine = asArray(upnp?.mappings).filter((m) => m.enabled && localIps.has(m.client));
  for (const m of mine) {
    const known = /steam|teredo|xbox|torrent|plex|discord|parsec|skype|playstation|nintendo|minecraft|epic|battle\.net|syncthing|zoom/i.test(m.description);
    out.push(finding({
      id: `upnp:${m.protocol}:${m.external}`, category: 'remote', severity: known ? 'notice' : 'warning',
      title: `Your router forwards internet port ${m.external} to this PC`,
      summary: known ? `Opened automatically by "${m.description}". Normal for games and file sharing.` : `Anyone on the internet can reach port ${m.internal} on this PC. Opened by "${m.description || 'unknown'}".`,
      evidence: [`${m.protocol} ${m.externalIp || 'internet'}:${m.external} → ${m.client}:${m.internal}`],
      advice: known ? '' : 'Remove it in your router\'s settings (UPnP / port forwarding) if you don\'t know what opened it.',
    }));
  }

  out.push(...networkFindings(ctx.connections || []));
  return out;
}

function dedupeLogons(list) {
  const seen = new Map();
  for (const l of list) {
    const key = `${l.user}|${l.ip}`;
    if (!seen.has(key) || (seen.get(key).time || 0) < (l.time || 0)) seen.set(key, l);
  }
  return [...seen.values()].sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 10);
}

function fmtLogon(l) {
  const when = l.time ? new Date(l.time).toISOString().replace('T', ' ').slice(0, 16) : 'recently';
  const how = String(l.type) === '10' || l.type === undefined ? 'Remote Desktop' : 'network';
  return `${when}: ${l.user || 'unknown user'} from ${l.ip} (${how})`;
}

// ------------------------------------------------------------- keylogger ---

function keylogger(a, ctx) {
  const out = [];
  const { sigs, env } = ctx;
  const kb = a.keyboard && !sectionError(a.keyboard) ? a.keyboard : null;
  if (kb) {
    const extra = asArray(kb.drivers).filter((d) => !/^kbdclass$/i.test(d.name));
    let suspicious = 0;
    for (const d of extra) {
      const file = driverFile(d, env);
      const sig = sigs[file];
      const vendor = signerName(sig) || '';
      const trusted = sigState(sig) === 'signed' && K.HARDWARE_VENDORS.test(vendor);
      if (trusted) {
        out.push(finding({ id: `kbd:${d.name}`, category: 'keylogger', severity: 'notice', title: `Keyboard add-on driver from ${vendor}: ${d.display || d.name}`, summary: 'Hardware makers add these for special keys. It is signed, so it\'s normal.', evidence: [file] }));
      } else {
        suspicious++;
        out.push(finding({
          id: `kbd:${d.name}`, category: 'keylogger', severity: 'danger',
          title: `Unknown driver is reading your keyboard: ${d.display || d.name}`,
          summary: 'A driver that sits between your keyboard and Windows can record every key you press. This is how kernel keyloggers work.',
          evidence: [file || d.image, describeSig(sig)],
          advice: 'Look the name up online. If it isn\'t from your PC or keyboard maker, run an offline scan from Virus Scan.',
        }));
      }
    }
    if (!suspicious) out.push(finding({ id: 'kbd:ok', category: 'keylogger', severity: 'ok', title: 'No keylogger driver on your keyboard', summary: 'Only trusted drivers sit between your keyboard and Windows.' }));
  }

  const inj = a.injection && !sectionError(a.injection) ? a.injection : null;
  if (inj) {
    for (const [dlls, load, key] of [[inj.appInit, inj.loadAppInit, 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows'], [inj.appInit32, inj.loadAppInit32, 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows NT\\CurrentVersion\\Windows']]) {
      if (String(dlls || '').trim() && Number(load) === 1) {
        out.push(finding({
          id: `appinit:${key}`, category: 'keylogger', severity: 'danger',
          title: 'A DLL is injected into every program (AppInit_DLLs)',
          summary: 'This old Windows feature loads a file into every app you open. Spyware and keyloggers use it to watch everything.',
          evidence: [`DLLs: ${dlls}`],
          fix: { label: 'Turn off', action: { type: 'reg-set', regKey: key, name: 'LoadAppInit_DLLs', value: 0, valueType: 'DWord' }, confirm: 'Stop loading AppInit DLLs? A backup is saved first.' },
        }));
      }
    }
    for (const i of asObjects(inj.ifeo)) {
      const exe = str(i.exe).toLowerCase();
      const dbg = str(i.debugger);
      if (!exe || !dbg || !str(i.key)) continue;
      const access = K.ACCESSIBILITY_EXES.has(exe);
      const benign = /vsjitdebugger|procexp|windbg|devenv/i.test(dbg) && !access;
      out.push(finding({
        id: `ifeo:${exe}`, category: 'keylogger', severity: access ? 'danger' : benign ? 'notice' : 'warning',
        title: access ? `Sign-in screen backdoor on ${i.exe}` : `${i.exe} is secretly replaced by another program`,
        summary: access
          ? 'Pressing an accessibility shortcut on the lock screen opens another program with full SYSTEM rights, letting anyone in without a password.'
          : 'Whenever this program starts, Windows runs a different one instead. Malware uses this to block security tools or to hide.',
        evidence: [`Runs instead: ${dbg}`],
        fix: { label: 'Remove', action: { type: 'reg-delete-value', regKey: str(i.key).replace(/^HKEY_LOCAL_MACHINE/, 'HKLM'), name: 'Debugger' }, confirm: `Remove the redirect on ${i.exe}? A backup is saved first.` },
      }));
    }
    for (const sx of asObjects(inj.silentExit)) {
      if (!str(sx.key) || !str(sx.monitor)) continue;
      out.push(finding({
        id: `silentexit:${sx.exe}`, category: 'keylogger', severity: 'warning',
        title: `A hidden program runs whenever ${sx.exe} closes`,
        summary: 'A rarely used Windows feature (SilentProcessExit) that malware uses to stay on your PC.',
        evidence: [`Runs: ${sx.monitor}`],
        fix: { label: 'Remove', action: { type: 'reg-delete-value', regKey: str(sx.key).replace(/^HKEY_LOCAL_MACHINE/, 'HKLM'), name: 'MonitorProcess' }, confirm: 'Remove this hidden trigger? A backup is saved first.' },
      }));
    }
    const wl = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';
    if (str(inj.shell).trim() && !/^explorer\.exe,?$/i.test(str(inj.shell).trim())) {
      out.push(finding({ id: 'winlogon:shell', category: 'keylogger', severity: 'danger', title: 'Windows starts an extra program at sign-in (Winlogon Shell)', summary: 'The Windows desktop normally starts only explorer.exe here.', evidence: [`Shell = ${inj.shell}`], fix: { label: 'Restore', action: { type: 'reg-set', regKey: wl, name: 'Shell', value: 'explorer.exe', valueType: 'String' }, confirm: 'Restore the Windows default (explorer.exe)? A backup is saved first.' } }));
    }
    if (str(inj.userinit).trim() && !/^[a-z]:\\windows\\system32\\userinit\.exe,?$/i.test(str(inj.userinit).trim())) {
      out.push(finding({ id: 'winlogon:userinit', category: 'keylogger', severity: 'danger', title: 'Windows starts an extra program at sign-in (Userinit)', summary: 'Only userinit.exe should run here.', evidence: [`Userinit = ${inj.userinit}`], fix: { label: 'Restore', action: { type: 'reg-set', regKey: wl, name: 'Userinit', value: `${envGet(env, 'SystemRoot') || 'C:\\Windows'}\\system32\\userinit.exe,`, valueType: 'String' }, confirm: 'Restore the Windows default? A backup is saved first.' } }));
    }
    if (str(inj.userShell).trim()) {
      out.push(finding({ id: 'winlogon:usershell', category: 'keylogger', severity: 'danger', title: 'Your account starts a custom program instead of the normal desktop', summary: 'A per-user Winlogon Shell is set. That is unusual and often malicious.', evidence: [`Shell = ${inj.userShell}`], fix: { label: 'Remove', action: { type: 'reg-delete-value', regKey: 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon', name: 'Shell' }, confirm: 'Remove the custom shell? A backup is saved first.' } }));
    }
    const lsa = [
      ['security', K.KNOWN_SECURITY_PACKAGES, 'Security Packages'],
      ['notification', K.KNOWN_NOTIFICATION_PACKAGES, 'Notification Packages'],
      ['authentication', K.KNOWN_AUTH_PACKAGES, 'Authentication Packages'],
    ];
    for (const [key, known, label] of lsa) {
      for (const name of asArray(inj[key])) {
        const n = String(name).trim().toLowerCase();
        if (known.has(n)) continue;
        const file = P.join(envGet(env, 'SystemRoot') || 'C:\\Windows', 'System32', `${name}.dll`);
        if (isMicrosoftSigned(sigs[file])) continue;
        out.push(finding({
          id: `lsa:${key}:${n}`, category: 'keylogger', severity: 'danger',
          title: `Unknown add-on loaded into Windows sign-in: ${name}`,
          summary: 'Files listed in LSA ' + label + ' see your Windows password every time you sign in or change it. Password stealers install themselves here.',
          evidence: [file, describeSig(sigs[file])],
          advice: 'Look the name up. If it isn\'t from your security or company software, run an offline scan.',
        }));
      }
    }
    if (Number(inj.wdigest) === 1) {
      out.push(finding({ id: 'wdigest', category: 'keylogger', severity: 'danger', title: 'Windows keeps your password in readable form in memory', summary: 'WDigest is switched on, so password-stealing tools (like Mimikatz) can read your password in plain text.', fix: { label: 'Turn off', action: { type: 'reg-set', regKey: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\SecurityProviders\\WDigest', name: 'UseLogonCredential', value: 0, valueType: 'DWord' }, confirm: 'Turn off WDigest plain-text passwords? A backup is saved first.' } }));
    }
  }

  // Spyware / monitoring software
  const seen = new Set();
  const sources = [
    ...asArray(a.processes).map((p) => ({ kind: 'running', text: `${p.name} ${p.description || ''} ${p.company || ''} ${p.path || ''}`, label: p.path || p.name })),
    ...asArray(a.programs).map((p) => ({ kind: 'installed', text: `${p.name} ${p.publisher || ''} ${p.location || ''}`, label: p.name })),
  ];
  for (const s of sources) {
    const spy = K.SPYWARE.find((x) => x.match.test(s.text));
    if (!spy || seen.has(spy.name)) continue;
    seen.add(spy.name);
    out.push(finding({
      id: `spyware:${spy.name.toLowerCase()}`, category: 'keylogger', severity: 'danger',
      title: `${spy.name} is ${s.kind === 'running' ? 'running' : 'installed'}`,
      summary: spy.work
        ? 'Employee-monitoring software records what you type and do. If this is your personal PC, someone installed it to spy on you.'
        : 'This software records keystrokes, screenshots, chats and passwords and can send them to someone else.',
      evidence: [s.label],
      advice: 'Uninstall it from Programs (or ask your employer if this is a work PC), then change your important passwords from another device.',
    }));
  }

  // Processes pretending to be Windows, or running unsigned from risky folders
  const flagged = [];
  for (const raw of asObjects(a.processes)) {
    const p = { ...raw, path: typeof raw.path === 'string' ? raw.path : '', name: str(raw.name) };
    if (!p.path) continue;
    const base = P.basename(p.path).toLowerCase();
    const kind = pathKind(p.path, env);
    if (K.SYSTEM_PROCESS_NAMES.has(base) && kind !== 'windows') {
      out.push(finding({
        id: `masquerade:${p.path.toLowerCase()}`, category: 'keylogger', severity: 'danger',
        title: `Fake Windows process: ${base}`,
        summary: `A program named like a core Windows process is running from ${KIND_LABEL[kind]}. Malware does this to hide in Task Manager.`,
        evidence: [p.path],
        fix: { label: 'Stop it', action: { type: 'kill-process', pid: p.pid }, confirm: `Stop ${base} (${p.path})? Then run a virus scan.` },
      }));
      continue;
    }
    const sig = sigs[p.path];
    if (sigState(sig) === 'unsigned' && ['temp', 'recycle', 'public', 'downloads'].includes(kind)) flagged.push({ p, kind });
  }
  for (const { p, kind } of flagged.slice(0, 10)) {
    out.push(finding({
      id: `proc-unsigned:${p.path.toLowerCase()}`, category: 'keylogger', severity: kind === 'downloads' ? 'notice' : 'warning',
      title: `Unsigned program running from ${KIND_LABEL[kind]}: ${p.name}`,
      summary: 'Unsigned programs running from temporary or shared folders are a common sign of malware (or a program that is still installing).',
      evidence: [p.path],
      fix: { label: 'Stop it', action: { type: 'kill-process', pid: p.pid }, confirm: `Stop ${p.name}?` },
    }));
  }
  out.push(...privacyFindings(ctx.privacy || []));
  return out;
}

function driverFile(d, env) {
  const img = String(d.image || '').trim();
  if (!img) return P.join(envGet(env, 'SystemRoot') || 'C:\\Windows', 'System32', 'drivers', `${d.name}.sys`);
  return normalizeWinPath(img, env);
}

// -------------------------------------------------------------- accounts ---

function accounts(a, ctx) {
  const out = [];
  const acc = a.accounts && !sectionError(a.accounts) ? a.accounts : null;
  if (!acc) return out;
  const me = ctx.userSid;
  for (const u of asArray(acc.users)) {
    if (!u.enabled) continue;
    if (/-501$/.test(u.sid)) {
      out.push(finding({ id: 'acct:guest', category: 'accounts', severity: 'warning', title: 'The Guest account is turned on', summary: 'Anyone can use this PC without a password.', fix: { label: 'Turn off', action: { type: 'user-disable', sid: u.sid }, confirm: 'Disable the Guest account?' } }));
    } else if (/-500$/.test(u.sid) && u.sid !== me) {
      out.push(finding({ id: 'acct:admin', category: 'accounts', severity: 'warning', title: 'The hidden built-in Administrator account is turned on', summary: 'Attackers target this account because its name is always the same.', fix: { label: 'Turn off', action: { type: 'user-disable', sid: u.sid }, confirm: 'Disable the built-in Administrator account?' } }));
    } else if (!u.passwordRequired && /^S-1-5-21-/.test(u.sid) && !/-50[0-3]$/.test(u.sid) && u.name !== 'WDAGUtilityAccount') {
      out.push(finding({ id: `acct:nopass:${u.sid}`, category: 'accounts', severity: 'notice', title: `"${u.name}" may not need a password`, summary: 'This account is allowed to have no password.' }));
    }
  }
  const admins = asArray(acc.admins).map((m) => ({ ...m, short: String(m.name).split('\\').pop() }));
  const unusual = admins.filter((m) => m.sid !== me && !/-500$/.test(m.sid) && !/-512$|-519$|domain admins/i.test(`${m.sid} ${m.name}`) && m.type !== 'Group');
  if (unusual.length) {
    out.push(finding({
      id: 'acct:admins', category: 'accounts', severity: 'notice',
      title: `${unusual.length} other account${unusual.length > 1 ? 's have' : ' has'} administrator rights`,
      summary: 'Check that you know every account that can control this PC.',
      evidence: unusual.map((m) => `${m.name}${m.source ? ` (${m.source})` : ''}`),
    }));
  }
  const changes = asArray(a.logons?.accountChanges);
  for (const c of changes) {
    if (c.id === 4720) {
      out.push(finding({ id: `acct:new:${c.target}`, category: 'accounts', severity: 'warning', title: `New account created: ${c.target}`, summary: `Created ${c.time ? new Date(c.time).toLocaleDateString() : 'recently'} by ${c.by || 'unknown'}. Attackers create accounts to get back in later.` }));
    } else if (c.id === 4732 && /S-1-5-32-544/i.test(c.targetSid || '') && c.memberSid !== me) {
      out.push(finding({ id: `acct:promoted:${c.memberSid}`, category: 'accounts', severity: 'warning', title: 'An account was given administrator rights', summary: `${c.member && c.member !== '-' ? c.member : c.memberSid} was added to Administrators by ${c.by || 'unknown'}.` }));
    }
  }
  if (!out.length) out.push(finding({ id: 'acct:ok', category: 'accounts', severity: 'ok', title: 'User accounts look normal', summary: `${asArray(acc.users).filter((u) => u.enabled).length} active account${asArray(acc.users).filter((u) => u.enabled).length === 1 ? '' : 's'}, no guest access, no new admins.` }));
  return out;
}

// --------------------------------------------------------------- sharing ---

function sharing(a) {
  const out = [];
  const sh = a.sharing && !sectionError(a.sharing) ? a.sharing : null;
  if (!sh) return out;
  const shares = asObjects(sh.shares).filter((s) => str(s.name) && !s.special && !/^(print\$|ipc\$|admin\$)$/i.test(str(s.name)));
  for (const s of shares) {
    const open = asObjects(s.access).some((x) => /everyone|guest|anonymous|jeder|tout le monde|todos/i.test(str(x.account)) && /full|change/i.test(str(x.right)) && /allow/i.test(str(x.type)));
    out.push(finding({
      id: `share:${str(s.name).toLowerCase()}`, category: 'sharing', severity: open ? 'warning' : 'notice',
      title: `Folder shared on the network: ${s.name}`,
      summary: open ? 'Everyone on your network can change or delete these files.' : 'Other devices on your network can open this folder.',
      evidence: [str(s.path), ...asObjects(s.access).map((x) => `${str(x.account)}: ${str(x.right)}`)].filter(Boolean),
      advice: 'Stop sharing it in the folder\'s Properties → Sharing if you don\'t need it.',
    }));
  }
  for (const s of asObjects(sh.sessions)) {
    out.push(finding({
      id: `smb-session:${s.client}`, category: 'sharing', severity: classifyIp(s.client) === 'public' ? 'danger' : 'warning',
      title: `${s.client} is connected to your shared files right now`,
      summary: `Signed in as ${s.user || 'unknown'} with ${s.opens} file${s.opens === 1 ? '' : 's'} open.`,
      evidence: asObjects(sh.openFiles).filter((f) => f.client === s.client).slice(0, 10).map((f) => str(f.path)),
    }));
  }
  if (sh.smb1) {
    out.push(finding({ id: 'smb1', category: 'sharing', severity: 'warning', title: 'Old file sharing (SMBv1) is on', summary: 'SMBv1 is how WannaCry spread. Nothing modern needs it.', fix: { label: 'Turn off', action: { type: 'smb1-off' }, confirm: 'Turn off SMBv1?' } }));
  }
  if (!out.length) out.push(finding({ id: 'share:ok', category: 'sharing', severity: 'ok', title: 'No folders are shared', summary: 'Nobody on your network is connected to your files.' }));
  return out;
}

// --------------------------------------------------------------- network ---

function internet(a, ctx) {
  const out = [];
  if (ctx.hostsText != null) out.push(...hostsFindings(ctx.hostsText, ctx.hostsPath));
  const n = a.internet && !sectionError(a.internet) ? a.internet : {};
  const is = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  if (Number(n.proxyEnable) === 1 && n.proxyServer) {
    const local = /^(https?:\/\/)?(127\.|localhost|\[::1\])/i.test(n.proxyServer);
    out.push(finding({
      id: 'proxy:user', category: 'network', severity: local ? 'notice' : 'warning',
      title: `Your internet traffic goes through a proxy: ${n.proxyServer}`,
      summary: local ? 'A program on this PC (VPN, ad blocker or debugging tool) is filtering your traffic.' : 'Every website you visit passes through this server. Malware sets this to spy on or change your traffic.',
      fix: { label: 'Turn off proxy', action: { type: 'reg-set', regKey: is, name: 'ProxyEnable', value: 0, valueType: 'DWord' }, confirm: 'Turn off the proxy? A backup is saved first.' },
    }));
  }
  if (n.autoConfig) {
    out.push(finding({
      id: 'proxy:pac', category: 'network', severity: 'warning',
      title: 'A proxy script controls your internet traffic',
      summary: 'A proxy auto-config (PAC) script can quietly send some websites through another server.',
      evidence: [n.autoConfig],
      fix: { label: 'Remove', action: { type: 'reg-delete-value', regKey: is, name: 'AutoConfigURL' }, confirm: 'Remove the proxy script? A backup is saved first.' },
    }));
  }
  const winhttp = asArray(n.winhttp).find((l) => /proxy server\(s\)\s*:/i.test(l));
  if (winhttp) out.push(finding({ id: 'proxy:winhttp', category: 'network', severity: 'notice', title: 'Windows services use a proxy', summary: winhttp.trim() }));
  const openWifi = asArray(n.wlan).find((l) => /^\s*authentication\s*:\s*open\s*$/i.test(l));
  if (openWifi) out.push(finding({ id: 'wifi:open', category: 'network', severity: 'warning', title: 'You\'re on an open Wi-Fi network', summary: 'Others on this network may see unencrypted traffic. Use a VPN or a trusted network for anything private.' }));
  const dns = asArray(n.dns).flatMap((d) => asArray(d.servers).map((s) => `${s} (${d.alias})`));
  if (dns.length) out.push(finding({ id: 'dns', category: 'network', severity: 'ok', title: 'DNS servers', summary: 'These servers translate website names into addresses. Malware sometimes changes them.', evidence: [...new Set(dns)].slice(0, 6) }));

  const certs = asArray(a.certificates);
  const seen = new Set();
  for (const c of certs) {
    if (seen.has(c.thumbprint)) continue;
    seen.add(c.thumbprint);
    const text = `${c.subject} ${c.issuer} ${c.friendly}`;
    if (K.BAD_ROOTS.test(text)) {
      out.push(finding({ id: `cert:${c.thumbprint}`, category: 'network', severity: 'danger', title: 'A known dangerous root certificate is installed', summary: 'It lets attackers fake secure websites (HTTPS). Remove it in certmgr.msc.', evidence: [c.subject, `Thumbprint ${c.thumbprint}`] }));
    } else if (c.hasPrivateKey && c.store !== 'Cert:\\LocalMachine\\AuthRoot') {
      const dev = /cn=localhost|mkcert|asp\.net|iis express|dotnet|vite|webpack/i.test(text);
      out.push(finding({
        id: `cert:${c.thumbprint}`, category: 'network', severity: dev ? 'notice' : 'warning',
        title: dev ? 'Developer HTTPS certificate is trusted' : 'A program can decrypt your secure (HTTPS) traffic',
        summary: dev ? 'Created by a developer tool for local websites.' : 'A trusted root certificate with its private key on this PC lets software read encrypted traffic. OK if you use Fiddler, antivirus web scanning or similar; otherwise it\'s spying.',
        evidence: [c.subject, `Thumbprint ${c.thumbprint}`],
      }));
    } else if (K.INTERCEPT_ROOTS.test(text)) {
      out.push(finding({ id: `cert:${c.thumbprint}`, category: 'network', severity: 'notice', title: 'HTTPS-inspection certificate installed', summary: 'Security software, parental controls or debugging tools use these to scan encrypted traffic.', evidence: [c.subject] }));
    }
  }
  return out;
}

// --------------------------------------------------------------- browser ---

function browser(a, ctx) {
  const out = [];
  const domain = !!a.os?.domain;
  for (const pol of asObjects(a.browserPolicies)) {
    const polKey = str(pol.key);
    if (!polKey) continue;
    const name = /Google\\Chrome/i.test(polKey) ? 'Chrome' : /Brave/i.test(polKey) ? 'Brave' : /Edge/i.test(polKey) ? 'Edge' : /Firefox/i.test(polKey) ? 'Firefox' : /Opera/i.test(polKey) ? 'Opera' : /Vivaldi/i.test(polKey) ? 'Vivaldi' : 'Chromium';
    const regKey = polKey.replace(/^(HKLM|HKCU):\\/, '$1\\');
    const values = pol.values && typeof pol.values === 'object' && !Array.isArray(pol.values) ? pol.values : {};
    for (const sub of asObjects(pol.subkeys)) {
      if (/^ExtensionInstallForcelist$/i.test(str(sub.name))) {
        const ids = Object.values(sub.values && typeof sub.values === 'object' ? sub.values : {}).map(String);
        out.push(finding({
          id: `policy:forcelist:${regKey}`, category: 'browser', severity: domain ? 'notice' : 'danger',
          title: `${name} is forced to install ${ids.length} extension${ids.length > 1 ? 's' : ''}`,
          summary: domain ? 'Set by your organisation.' : 'On a home PC this is almost always a browser hijacker. It stops you removing the extension and shows "Managed by your organization".',
          evidence: ids,
          fix: domain ? null : { label: 'Remove policy', action: { type: 'reg-delete-key', regKey: `${regKey}\\${sub.name}` }, confirm: `Remove the forced-extension policy from ${name}? A backup is saved first. Then remove the extension in ${name}.` },
        }));
      }
    }
    const proxyKeys = Object.keys(values).filter((k) => /^Proxy/i.test(k));
    if (proxyKeys.length) {
      out.push(finding({
        id: `policy:proxy:${regKey}`, category: 'browser', severity: domain ? 'notice' : 'danger',
        title: `${name}'s traffic is forced through a proxy`,
        summary: 'A policy sends everything you browse through another server.',
        evidence: proxyKeys.map((k) => `${k} = ${values[k]}`),
        fix: domain ? null : { label: 'Remove', action: { type: 'reg-delete-values', regKey, names: proxyKeys }, confirm: 'Remove the proxy policy? A backup is saved first.' },
      }));
    }
    const hijack = Object.keys(values).filter((k) => /^(HomepageLocation|NewTabPageLocation|DefaultSearchProvider\w*|RestoreOnStartup\w*|HomepageIsNewTabPage)$/i.test(k));
    if (hijack.length) {
      out.push(finding({
        id: `policy:hijack:${regKey}`, category: 'browser', severity: domain ? 'notice' : 'warning',
        title: `${name}'s homepage or search engine is locked by a policy`,
        summary: 'Browser hijackers lock these so you can\'t change them back.',
        evidence: hijack.map((k) => `${k} = ${values[k]}`),
        fix: domain ? null : { label: 'Unlock', action: { type: 'reg-delete-values', regKey, names: hijack }, confirm: 'Remove these policies? A backup is saved first.' },
      }));
    }
    const other = Object.keys(values).filter((k) => !proxyKeys.includes(k) && !hijack.includes(k));
    if (other.length && !domain) {
      out.push(finding({ id: `policy:other:${regKey}`, category: 'browser', severity: 'notice', title: `${name} shows "Managed by your organization"`, summary: `${other.length} browser polic${other.length > 1 ? 'ies are' : 'y is'} set. Some programs (antivirus, parental controls) do this legitimately.`, evidence: other.slice(0, 10).map((k) => `${k} = ${values[k]}`) }));
    }
  }
  for (const e of asObjects(a.externalExtensions)) {
    if (!str(e.key)) continue;
    const store = /clients2\.google\.com|edge\.microsoft\.com\/extensionwebstorebase/i.test(str(e.updateUrl));
    out.push(finding({
      id: `ext-reg:${e.key}`, category: 'browser', severity: store ? 'notice' : 'warning',
      title: `A program adds a browser extension automatically: ${e.id}`,
      summary: store ? 'It comes from the official store, installed by another program (often password managers or antivirus).' : 'It is installed from outside the official store. Adware does this.',
      evidence: [e.key, e.updateUrl || e.path].filter(Boolean),
      fix: { label: 'Remove', action: { type: 'reg-delete-key', regKey: str(e.key).replace(/^(HKLM|HKCU):\\/, '$1\\') }, confirm: 'Stop this program from adding the extension? A backup is saved first.' },
    }));
  }
  out.push(...extensionFindings(asObjects(ctx.extensions)));
  return out;
}

// ------------------------------------------------------------------ main ---

/** Files whose signatures the audit needs (drivers, LSA packages, running programs). */
function auditFiles(a, env) {
  const files = [];
  if (!a || typeof a !== 'object') return files;
  for (const d of asObjects(a.keyboard?.drivers)) if (!/^kbdclass$/i.test(str(d.name))) files.push(driverFile(d, env));
  const sys = P.join(envGet(env, 'SystemRoot') || 'C:\\Windows', 'System32');
  for (const key of ['security', 'notification', 'authentication']) {
    for (const n of asArray(a.injection?.[key])) {
      const name = String(n).trim().toLowerCase();
      const known = { security: K.KNOWN_SECURITY_PACKAGES, notification: K.KNOWN_NOTIFICATION_PACKAGES, authentication: K.KNOWN_AUTH_PACKAGES }[key];
      if (!known.has(name)) files.push(P.join(sys, `${n}.dll`));
    }
  }
  for (const p of asObjects(a.processes)) {
    if (typeof p.path === 'string' && p.path && USER_WRITABLE.has(pathKind(p.path, env))) files.push(p.path);
  }
  return files.filter((f) => typeof f === 'string' && f);
}

/** A finding that says part of the check failed, with enough detail to report it. */
function crashFinding(category, err) {
  const frame = String(err?.stack || '').split('\n').find((l) => /\.js:\d+/.test(l)) || '';
  const where = (frame.match(/([\w.-]+\.js):(\d+)/) || []).slice(1).join(':');
  return finding({
    id: `audit:error:${category}`,
    category,
    severity: 'notice',
    title: `Part of the check could not finish: ${CATEGORIES[category] || category}`,
    summary: 'Windows returned information in a form opKapot didn\'t expect. The other checks still ran.',
    evidence: [String(err?.message || err), where ? `at ${where}` : ''].filter(Boolean),
    advice: 'Please report this with the details above so it can be fixed.',
  });
}

function analyzeAudit(ctx) {
  const a = ctx.audit || {};
  const env = ctx.env || {};
  const now = ctx.now || Date.now();
  const full = { ...ctx, sigs: ctx.sigs || {}, env, userSid: ctx.userSid || a.os?.userSid };
  // Each area runs on its own: unexpected data in one never stops the others.
  const area = (category, run) => {
    try {
      return run();
    } catch (err) {
      return [crashFinding(category, err)];
    }
  };
  const findings = [
    ...area('protection', () => protection(a, env, now)),
    ...area('remote', () => remote(a, full)),
    ...area('keylogger', () => keylogger(a, full)),
    ...area('network', () => internet(a, full)),
    ...area('browser', () => browser(a, full)),
    ...area('startup', () => autorunFindings(ctx.autoruns || [])),
    ...area('accounts', () => accounts(a, full)),
    ...area('sharing', () => sharing(a)),
  ];
  // A failed collector section is reported, never silently treated as "safe".
  const failed = Object.entries(a).filter(([, v]) => sectionError(v)).map(([k, v]) => `${k}: ${sectionError(v)}`);
  if (failed.length) {
    findings.push(finding({ id: 'audit:partial', category: 'protection', severity: 'notice', title: 'Some checks could not run', summary: 'Windows didn\'t allow these checks, so their results are missing.', evidence: failed.slice(0, 12) }));
  }
  const unique = new Map();
  for (const f of findings) if (!unique.has(f.id)) unique.set(f.id, f);
  return [...unique.values()].sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
}

function summarize(findings) {
  const counts = { danger: 0, warning: 0, notice: 0, ok: 0 };
  for (const f of findings) counts[f.severity]++;
  const status = counts.danger ? 'danger' : counts.warning ? 'warning' : 'ok';
  return { counts, status, categories: CATEGORIES };
}

module.exports = { analyzeAudit, summarize, auditFiles, exclusionRisk, crashFinding };
