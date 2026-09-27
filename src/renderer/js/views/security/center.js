import { api, esc, h, formatNumber, relativeTime, plural } from '../../util.js';
import { icon } from '../../icons.js';
import { appState } from '../../store.js';
import { securityStore } from '../../securityStore.js';
import { go } from '../../router.js';
import { viewHeader } from '../common.js';
import { sevIcon, notSupportedHtml, confirmRun } from './shared.js';

const HERO = {
  ok: ['shieldOk', 'You\'re protected', 'No problems found. Keep running a Smart Scan now and then.'],
  warning: ['shieldAlert', 'Attention needed', 'A few things could make your PC easier to attack.'],
  danger: ['shieldAlert', 'Your PC may be at risk', 'Serious problems need your attention.'],
  unknown: ['shieldOk', 'Checking your PC…', ''],
};

/** Security Center: overall status, key protections and recent alerts. */
export class SecurityCenterView {
  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view sec-center">
      ${viewHeader({
        title: 'Your PC\'s security at a glance.',
        info: 'opKapot combines Microsoft Defender\'s virus engine with its own checks for hackers, spyware and keyloggers.',
        actions: '<button class="btn btn-big btn-primary" data-smart>Smart Scan</button>',
      })}
      <div class="sec-body"></div>
    </div>`);
    this.body = this.el.querySelector('.sec-body');
    this.el.querySelector('[data-smart]').addEventListener('click', () => this.smartScan());
    this.body.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) go(nav.dataset.nav);
      const act = e.target.closest('[data-act]');
      if (act) this.action(act.dataset.act);
    });
    for (const ev of ['status', 'audit', 'scan']) securityStore.on(ev, () => this.visible && this.render());
    appState.on('settings', () => this.visible && this.render());
    return this.el;
  }

  onShow() {
    this.visible = true;
    securityStore.loadStatus();
    this.render();
    clearInterval(this.timer);
    this.timer = setInterval(() => securityStore.loadStatus(), 30_000);
  }

  onHide() {
    this.visible = false;
    clearInterval(this.timer);
  }

  refresh() {
    securityStore.loadStatus();
  }

  primaryAction() {
    this.smartScan();
  }

  async smartScan() {
    if (securityStore.audit.running || securityStore.scan.running) return;
    const both = [securityStore.runAudit(), securityStore.runScan('quick')];
    this.render();
    await Promise.all(both);
  }

  async action(kind) {
    if (kind === 'update') {
      await confirmRun({ run: () => api.security.defenderAction('update') });
      securityStore.loadStatus();
    } else if (kind === 'guard-on' || kind === 'guard-off') {
      await appState.updateSettings({ guardEnabled: kind === 'guard-on' });
      securityStore.loadStatus();
    } else if (kind === 'clear-alerts') {
      await api.security.clearAlerts();
      securityStore.loadStatus();
    }
  }

  render() {
    const s = securityStore.status;
    const btn = this.el.querySelector('[data-smart]');
    const busy = securityStore.audit.running || securityStore.scan.running;
    btn.disabled = busy || s?.supported === false;
    btn.textContent = busy ? 'Scanning…' : 'Smart Scan';
    if (!s) {
      this.body.innerHTML = securityStore.statusError
        ? `<div class="empty-state">${icon('alert', { size: 40 })}<div>Could not read security status.</div><div class="empty-sub">${esc(securityStore.statusError)}</div></div>`
        : `<div class="empty-state"><span class="spin big"></span><div>Checking your protection…</div></div>`;
      return;
    }
    if (!s.supported) {
      this.body.innerHTML = notSupportedHtml();
      return;
    }
    const [iconName, title, sub] = HERO[s.overall] || HERO.unknown;
    const progress = busy ? this.progressHtml() : '';
    const issues = s.issues.filter((i) => i.severity !== 'ok').slice(0, 4);
    const av = s.antivirus;
    const def = av.defender;
    const guardOn = appState.settings.guardEnabled && s.guard.enabled;

    const cards = [
      card('virus', 'Antivirus', av.on ? 'on' : 'off', av.on ? `${esc(av.name)} is on` : 'Real-time protection is off',
        def?.active ? `Definitions ${def.signatureAgeDays == null ? 'unknown' : def.signatureAgeDays === 0 ? 'updated today' : `${def.signatureAgeDays} day${def.signatureAgeDays > 1 ? 's' : ''} old`}` : esc(def ? 'Microsoft Defender is resting' : ''),
        def?.active && def.signatureAgeDays > 1 ? '<button class="link-btn" data-act="update">Update now</button>' : '<button class="link-btn" data-nav="security/scan">Scan now</button>'),
      card('lock', 'Firewall', s.firewall.on ? 'on' : 'off', s.firewall.on ? `${esc(s.firewall.name)} is on` : 'Firewall is off',
        s.firewall.on ? 'Blocks unwanted connections' : 'Other devices can reach your PC', '<button class="link-btn" data-nav="security/hackcheck">Check</button>'),
      card('hacker', 'Remote access', s.rdp.sessions ? 'off' : s.remoteTools.length || s.rdp.on ? 'warn' : 'on',
        s.rdp.sessions ? 'Someone is connected!' : s.remoteTools.length ? `${esc(s.remoteTools.join(', '))} running` : s.rdp.on ? 'Remote Desktop is on' : 'Nobody is connected',
        s.rdp.on ? 'Remote Desktop accepts connections' : 'Remote Desktop is off', '<button class="link-btn" data-nav="security/network">See connections</button>'),
      card('camera', 'Camera & microphone', s.devicesInUse.length ? 'warn' : 'on',
        s.devicesInUse.length ? esc(s.devicesInUse.map((d) => `${d.name}: ${d.device.toLowerCase()}`).join(', ')) : 'Not in use',
        s.devicesInUse.length ? 'In use right now' : 'No app is watching or listening', '<button class="link-btn" data-nav="security/privacy">Details</button>'),
      card('radar', 'Real-time Guard', guardOn ? 'on' : 'warn', guardOn ? 'Watching your PC' : 'Off',
        guardOn ? (s.guard.lastTick ? `Last check ${relativeTime(s.guard.lastTick).toLowerCase()}` : 'Starting…') : 'Alerts you to new connections and startup programs',
        `<button class="link-btn" data-act="${guardOn ? 'guard-off' : 'guard-on'}">${guardOn ? 'Turn off' : 'Turn on'}</button>`),
      card('vault', 'Quarantine', s.quarantined ? 'warn' : 'on', s.quarantined ? `${plural(s.quarantined, 'file')} locked away` : 'Empty',
        'Suspicious files are kept here safely', '<button class="link-btn" data-nav="security/quarantine">Open</button>'),
    ].join('');

    this.body.innerHTML = `
      <div class="sec-hero sec-${s.overall}">
        <div class="hero-shield">${icon(iconName, { size: 64 })}</div>
        <div class="hero-text">
          <div class="hero-title">${esc(title)}</div>
          <div class="hero-sub">${esc(busy ? 'Smart Scan is checking your PC…' : sub)}</div>
          ${progress || (issues.length ? `<ul class="hero-issues">${issues.map((i) => `<li>${sevIcon(i.severity, 16)}<span>${esc(i.text)}</span></li>`).join('')}</ul>` : '')}
        </div>
        <div class="hero-meta">
          <div><span class="muted">Last virus scan</span><b>${s.lastScanTime ? relativeTime(s.lastScanTime) : 'Never'}</b></div>
          <div><span class="muted">Last Hack Check</span><b>${s.lastAudit ? relativeTime(s.lastAudit.time) : 'Never'}</b></div>
          ${s.demo ? '<div class="demo-note">Demo data</div>' : ''}
        </div>
      </div>
      <div class="sec-cards">${cards}</div>
      <div class="sec-alerts">
        <div class="sec-alerts-head"><span>Recent alerts</span>${s.alerts.length ? '<button class="link-btn" data-act="clear-alerts">Clear</button>' : ''}</div>
        ${s.alerts.length ? s.alerts.slice(0, 8).map((a) => `
          <div class="alert-row" ${a.view ? `data-nav="${esc(a.view)}"` : ''}>${sevIcon(a.severity, 18)}
            <div class="alert-text"><div class="trunc">${esc(a.title)}</div><div class="muted small trunc">${esc(a.body || '')}</div></div>
            <div class="muted small">${relativeTime(a.time)}</div></div>`).join('')
          : `<div class="muted small alert-empty">No alerts. The Real-time Guard tells you when something new connects, starts up or uses your camera.</div>`}
      </div>`;
  }

  progressHtml() {
    const a = securityStore.audit;
    const sc = securityStore.scan;
    const lines = [];
    if (a.running) lines.push(`<div class="hero-step"><span class="spin"></span>Hack Check: ${esc(a.progress?.text || 'Working…')}</div>`);
    else if (a.result) lines.push(`<div class="hero-step">${icon('checkCircle', { size: 16 })}Hack Check done: ${a.result.summary.counts.danger} danger, ${a.result.summary.counts.warning} warnings</div>`);
    if (sc.running) lines.push(`<div class="hero-step"><span class="spin"></span>Virus scan: ${formatNumber(sc.progress?.scanned || 0)} files checked${sc.progress?.flagged ? `, ${sc.progress.flagged} suspicious` : ''}</div>`);
    else if (sc.result) lines.push(`<div class="hero-step">${icon('checkCircle', { size: 16 })}Virus scan done: ${sc.result.rows.filter((r) => r.active).length} threat(s)</div>`);
    return `<div class="hero-steps">${lines.join('')}</div>`;
  }
}

function card(iconName, title, state, main, sub, action) {
  return `<div class="sec-card state-${state}">
    <div class="sec-card-top"><span class="sec-card-ico">${icon(iconName, { size: 22 })}</span><span class="sec-card-title">${esc(title)}</span><span class="state-dot"></span></div>
    <div class="sec-card-main">${main}</div>
    <div class="sec-card-sub muted">${sub}</div>
    <div class="sec-card-act">${action}</div>
  </div>`;
}
