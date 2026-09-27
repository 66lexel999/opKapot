import { esc, h, relativeTime } from '../../util.js';
import { icon } from '../../icons.js';
import { confirmDialog, toast } from '../../components/overlay.js';
import { securityStore } from '../../securityStore.js';
import { go } from '../../router.js';
import { viewHeader } from '../common.js';
import { sevIcon, sevPill, showFinding, openLink, notSupportedHtml } from './shared.js';

const CATEGORY_ORDER = ['remote', 'keylogger', 'startup', 'browser', 'network', 'protection', 'accounts', 'sharing'];
const CATEGORY_ICON = { remote: 'hacker', keylogger: 'eye', startup: 'rocket', browser: 'puzzle', network: 'globe', protection: 'shieldOk', accounts: 'lock', sharing: 'folder' };
const ORDER = { danger: 0, warning: 1, notice: 2, ok: 3 };

/** Hack Check: is anyone accessing, spying on or controlling this PC? */
export class HackCheckView {
  constructor() {
    this.filter = 'problems';
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Is anyone spying on or accessing your PC?',
        info: 'Looks for remote access, keyloggers, hijacked browsers, hidden startup programs, risky settings and suspicious sign-ins. Read-only until you press Fix.',
        actions: '<div class="seg" data-filter><button data-v="problems" class="on">Problems</button><button data-v="all">All results</button></div><button class="btn btn-big btn-primary" data-run>Run Hack Check</button>',
      })}
      <div class="hc-body"></div>
    </div>`);
    this.body = this.el.querySelector('.hc-body');
    this.el.querySelector('[data-run]').addEventListener('click', () => securityStore.runAudit());
    this.el.querySelector('[data-filter]').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.filter = b.dataset.v;
      for (const x of this.el.querySelectorAll('[data-filter] button')) x.classList.toggle('on', x === b);
      this.render();
    });
    this.body.addEventListener('click', (e) => this.onClick(e));
    securityStore.on('audit', () => this.visible && this.render());
    securityStore.on('status', () => this.visible && !securityStore.audit.result && this.render());
    return this.el;
  }

  onShow() {
    this.visible = true;
    if (!securityStore.status) securityStore.loadStatus();
    this.render();
  }

  onHide() {
    this.visible = false;
  }

  refresh() {
    securityStore.runAudit();
  }

  primaryAction() {
    securityStore.runAudit();
  }

  findingById(id) {
    return securityStore.audit.result?.findings.find((f) => f.id === id);
  }

  async onClick(e) {
    const row = e.target.closest('[data-id]');
    if (e.target.closest('[data-run-first]')) {
      securityStore.runAudit();
      return;
    }
    if (!row) return;
    const f = this.findingById(row.dataset.id);
    if (!f) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fix') this.fix(f);
    else if (act === 'ignore') securityStore.ignore(f.id, !f.ignored);
    else if (act === 'link') openLink(f.link, go);
    else showFinding({ ...f, categoryLabel: securityStore.audit.result.summary.categories[f.category] }, {
      onFix: (x) => this.fix(x),
      onIgnore: (x) => securityStore.ignore(x.id, !x.ignored),
      onLink: (l) => openLink(l, go),
    });
  }

  async fix(f) {
    const { ok } = await confirmDialog({ title: f.fix.label, message: `<p>${esc(f.fix.confirm || `${f.fix.label}?`)}</p>`, confirmLabel: f.fix.label, kind: f.severity === 'danger' ? 'danger' : 'primary' });
    if (!ok) return;
    try {
      const res = await securityStore.fix(f.id);
      toast(esc(res.message || (res.ok ? 'Done.' : 'It didn\'t work.')), res.ok ? 'success' : 'error', res.ok ? 4000 : 8000);
    } catch (err) {
      toast(esc(err.message), 'error', 8000);
    }
  }

  render() {
    const st = securityStore.status;
    const a = securityStore.audit;
    const btn = this.el.querySelector('[data-run]');
    btn.disabled = a.running;
    btn.textContent = a.running ? 'Checking…' : a.result ? 'Check again' : 'Run Hack Check';
    this.el.querySelector('[data-filter]').hidden = a.running || !a.result;
    if (st && !st.supported) {
      this.body.innerHTML = notSupportedHtml();
      return;
    }
    if (a.running) {
      const step = a.progress?.step || 0;
      this.body.innerHTML = `<div class="scan-live">
        <div class="scan-ring spinning">${icon('radar', { size: 44 })}</div>
        <div><div class="scan-title">Checking your PC for signs of hacking…</div>
        <div class="muted">${esc(a.progress?.text || 'Starting…')}</div>
        <div class="steps">${['Windows data', 'Browsers & hosts file', 'Digital signatures', 'Analysis'].map((t, i) => `<span class="${i + 1 < step ? 'done' : i + 1 === step ? 'now' : ''}">${esc(t)}</span>`).join('')}</div></div>
      </div>`;
      return;
    }
    if (a.error) {
      this.body.innerHTML = `<div class="empty-state">${icon('alert', { size: 40 })}<div>The check could not finish.</div><div class="empty-sub">${esc(a.error)}</div><button class="btn" data-run-first>Try again</button></div>`;
      return;
    }
    if (!a.result) {
      this.body.innerHTML = `<div class="hc-intro">
        <div class="hc-intro-ico">${icon('hacker', { size: 48 })}</div>
        <div><div class="scan-title">Find out if someone can get into your PC</div>
        <ul class="hc-list">
          <li>${icon('hacker', { size: 16 })} Remote-control apps, Remote Desktop and sign-ins from other computers</li>
          <li>${icon('eye', { size: 16 })} Keylogger drivers, password stealers, spyware and camera or microphone use</li>
          <li>${icon('rocket', { size: 16 })} Hidden startup programs, scheduled tasks and WMI tricks</li>
          <li>${icon('puzzle', { size: 16 })} Hijacked browsers, forced extensions, proxies and fake certificates</li>
          <li>${icon('globe', { size: 16 })} Open ports, router port-forwards, shared folders and the hosts file</li>
        </ul>
        <button class="btn btn-primary" data-run-first>Run Hack Check</button>
        <p class="muted small">Takes about a minute. Nothing is changed unless you press Fix.</p></div>
      </div>`;
      return;
    }

    const r = a.result;
    const c = r.summary.counts;
    const visible = r.findings.filter((f) => (this.filter === 'all' ? true : f.severity !== 'ok' && !f.ignored));
    const groups = CATEGORY_ORDER.map((cat, i) => ({ cat, i, items: visible.filter((f) => f.category === cat).sort((x, y) => ORDER[x.severity] - ORDER[y.severity]) }))
      .filter((g) => g.items.length)
      .sort((x, y) => ORDER[x.items[0].severity] - ORDER[y.items[0].severity] || x.i - y.i);
    const verdict = c.danger ? ['danger', 'Serious problems found'] : c.warning ? ['warning', 'Some things need your attention'] : ['ok', 'No signs of hacking found'];
    const ignoredCount = r.findings.filter((f) => f.ignored).length;

    this.body.innerHTML = `
      <div class="hc-summary sec-${verdict[0]}">
        ${sevIcon(verdict[0], 30)}
        <div class="hc-verdict"><div>${esc(verdict[1])}</div><div class="muted small">Checked ${relativeTime(r.time).toLowerCase()} · ${r.findings.length} checks${ignoredCount ? ` · ${ignoredCount} ignored` : ''}</div></div>
        <div class="hc-counts">
          <span class="cnt cnt-danger"><b>${c.danger}</b> danger</span>
          <span class="cnt cnt-warning"><b>${c.warning}</b> warnings</span>
          <span class="cnt cnt-notice"><b>${c.notice}</b> info</span>
          <span class="cnt cnt-ok"><b>${c.ok}</b> passed</span>
        </div>
      </div>
      <div class="hc-groups">
        ${groups.length ? groups.map((g) => `
          <div class="hc-group">
            <div class="hc-group-head">${icon(CATEGORY_ICON[g.cat], { size: 18 })}<span>${esc(r.summary.categories[g.cat])}</span></div>
            ${g.items.map((f) => this.rowHtml(f)).join('')}
          </div>`).join('') : `<div class="empty-state">${icon('checkCircle', { size: 40, className: 'empty-icon' })}<div>Nothing to fix.</div><div class="empty-sub">Switch to "All results" to see everything that was checked.</div></div>`}
      </div>`;
  }

  rowHtml(f) {
    return `<div class="hc-row${f.ignored ? ' ignored' : ''}${f.fixed ? ' fixed' : ''}" data-id="${esc(f.id)}">
      ${sevIcon(f.fixed ? 'ok' : f.severity)}
      <div class="hc-text"><div class="hc-title">${esc(f.title)}${f.fixed ? ' <span class="sev sev-ok">Fixed</span>' : f.ignored ? ' <span class="sev sev-notice">Ignored</span>' : ''}</div><div class="hc-sub">${esc(f.summary || '')}</div></div>
      <div class="hc-actions">
        ${f.fix && !f.fixed ? `<button class="btn btn-sm ${f.severity === 'danger' ? 'btn-danger' : 'btn-accent'}" data-act="fix">${esc(f.fix.label)}</button>` : ''}
        ${!f.fix && f.link ? `<button class="btn btn-sm" data-act="link">${esc(f.link.label)}</button>` : ''}
        ${f.severity !== 'ok' ? sevPill(f.severity) : ''}
        <span class="chev">${icon('chevronRight', { size: 16 })}</span>
      </div>
    </div>`;
  }
}
