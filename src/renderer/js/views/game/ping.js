import { api, esc, h, uid, relativeTime, errorMessage } from '../../util.js';
import { icon } from '../../icons.js';
import { toast } from '../../components/overlay.js';
import { latencyChart, barList } from '../../components/charts.js';
import { go } from '../../router.js';
import { viewHeader } from '../common.js';
import { sevIcon, confirmRun, notSupportedHtml } from '../security/shared.js';

const STEPS = ['Your connection', 'Ping: router, internet, servers', 'Download speed', 'Upload speed', 'Diagnosis'];
const SERIES = [
  { id: 'router', label: 'To your router', color: 'var(--series-1)' },
  { id: 'internet', label: 'To the internet', color: 'var(--series-2)' },
  { id: 'loaded', label: 'Internet while downloading', color: 'var(--series-3)' },
];

// Quality bands used for the tiles: [great, good, ok] thresholds; anything past is poor.
const QUALITY = {
  ping: (v) => (v == null ? null : v < 30 ? 'great' : v < 60 ? 'good' : v < 100 ? 'ok' : 'poor'),
  jitter: (v) => (v == null ? null : v < 5 ? 'great' : v < 10 ? 'good' : v < 20 ? 'ok' : 'poor'),
  loss: (v) => (v == null ? null : v === 0 ? 'great' : v < 1 ? 'good' : v < 2.5 ? 'ok' : 'poor'),
  down: (v) => (v == null ? null : v >= 50 ? 'great' : v >= 20 ? 'good' : v >= 10 ? 'ok' : 'poor'),
  up: (v) => (v == null ? null : v >= 10 ? 'great' : v >= 5 ? 'good' : v >= 2 ? 'ok' : 'poor'),
  grade: (g) => (!g ? null : /^A/.test(g) ? 'great' : g === 'B' ? 'good' : g === 'C' ? 'ok' : 'poor'),
};
const QUALITY_LABEL = { great: 'Great', good: 'Good', ok: 'OK', poor: 'Poor' };

function tile(label, value, unit, quality, hint) {
  return `<div class="kpi">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value">${value == null ? '—' : esc(String(value))}${value != null && unit ? `<span class="kpi-unit">${esc(unit)}</span>` : ''}</div>
    <div class="kpi-q">${quality ? `<span class="q-dot q-${quality}"></span>${QUALITY_LABEL[quality]}` : '<span class="muted">Not measured</span>'}${hint ? `<span class="muted"> · ${esc(hint)}</span>` : ''}</div>
  </div>`;
}

function hop(iconName, title, stats, sub) {
  const q = !stats || stats.avg == null ? 'none' : stats.loss >= 2 || stats.jitter > 12 || stats.p95 > 120 ? 'poor' : stats.jitter > 5 || stats.loss > 0 || stats.avg > 80 ? 'ok' : 'great';
  const label = { none: 'No answer', poor: 'Unstable', ok: 'Some spikes', great: 'Steady' }[q];
  return `<div class="hop hop-${q}">
    <div class="hop-ico">${icon(iconName, { size: 24 })}</div>
    <div class="hop-title">${esc(title)}</div>
    <div class="hop-ms">${stats?.avg == null ? '—' : `${Math.round(stats.avg)} ms`}</div>
    <div class="hop-q"><span class="q-dot q-${q === 'none' ? 'none' : q}"></span>${label}</div>
    ${sub ? `<div class="hop-sub muted">${esc(sub)}</div>` : ''}
  </div>`;
}

/** First box of the chain: how the PC connects, rated by cable / Wi-Fi quality. */
function pcHop(info) {
  const w = info.wifi;
  let q = 'great';
  let label = 'Cable: best for games';
  let big = 'Cable';
  if (info.type === 'wifi') {
    big = 'Wi-Fi';
    const weak = w?.signal != null && w.signal < 60;
    q = w?.signal != null && w.signal < 40 ? 'poor' : weak || w?.band === '2.4' ? 'ok' : 'good';
    label = weak ? 'Weak signal' : w?.band === '2.4' ? 'Crowded 2.4 GHz' : 'Good signal';
  } else if (info.type !== 'ethernet') {
    big = info.type === 'vpn' ? 'VPN' : '—';
    q = info.type === 'vpn' ? 'ok' : 'none';
    label = info.type === 'vpn' ? 'Through a VPN' : 'Unknown';
  }
  const sub = info.type === 'wifi' ? `${w?.band ? `${w.band} GHz` : ''}${w?.signal != null ? ` · ${w.signal}% signal` : ''}` : info.adapter?.linkMbps ? `${info.adapter.linkMbps} Mbps link` : '';
  return `<div class="hop hop-${q === 'good' ? 'great' : q}">
    <div class="hop-ico">${icon(info.type === 'wifi' ? 'wifi' : info.type === 'ethernet' ? 'cable' : 'monitor', { size: 24 })}</div>
    <div class="hop-title">Your PC</div>
    <div class="hop-ms">${esc(big)}</div>
    <div class="hop-q"><span class="q-dot q-${q}"></span>${esc(label)}</div>
    ${sub ? `<div class="hop-sub muted">${esc(sub)}</div>` : ''}
  </div>`;
}

/** Ping & Speed: find out what makes ping high or unstable. */
export class PingView {
  constructor() {
    this.state = 'idle';
    this.result = null;
    this.progress = null;
    this.withSpeed = true;
  }

  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Why is my ping high or unstable?',
        info: 'Pings your router, the internet and game-server regions, measures speed and how much your ping rises when the line is busy, then explains what is causing lag.',
        actions: '<label class="check-row"><input type="checkbox" data-speed checked><span>Include speed test</span></label><button class="btn btn-big btn-violet" data-run>Test my connection</button>',
      })}
      <div class="ping-body"></div>
    </div>`);
    this.body = this.el.querySelector('.ping-body');
    this.runBtn = this.el.querySelector('[data-run]');
    this.runBtn.addEventListener('click', () => (this.state === 'running' ? this.cancel() : this.run()));
    this.el.querySelector('[data-speed]').addEventListener('change', (e) => {
      this.withSpeed = e.target.checked;
    });
    this.body.addEventListener('click', (e) => this.onClick(e));
    return this.el;
  }

  async onShow() {
    if (this.status === undefined) {
      try {
        this.status = await api.game.status();
      } catch {
        this.status = null;
      }
    }
    this.render();
  }

  onHide() {
    this.disposeChart?.();
    this.disposeChart = null;
  }

  refresh() {
    if (this.state !== 'running') this.run();
  }

  primaryAction() {
    this.refresh();
  }

  async run() {
    if (this.state === 'running') return;
    this.state = 'running';
    this.jobId = uid('net');
    this.progress = { step: 1, text: 'Starting…' };
    this.render();
    const off = api.jobs.onProgress(({ jobId, data }) => {
      if (jobId !== this.jobId) return;
      this.progress = { ...this.progress, ...data };
      this.renderProgress();
    });
    try {
      this.result = await api.net.test(this.jobId, { speed: this.withSpeed });
      this.state = 'done';
      document.dispatchEvent(new CustomEvent('opk:net-test', { detail: { time: this.result.time, ping: this.result.internet?.avg, jitter: this.result.internet?.jitter, download: this.result.speed?.download ?? null } }));
    } catch (err) {
      this.state = this.result ? 'done' : 'idle';
      toast(esc(errorMessage(err)), 'error', 8000);
    } finally {
      off();
      this.render();
    }
  }

  cancel() {
    if (this.jobId) api.net.cancel(this.jobId);
  }

  async onClick(e) {
    const link = e.target.closest('[data-view]');
    if (link) {
      go(link.dataset.view);
      return;
    }
    const uri = e.target.closest('[data-uri]');
    if (uri) {
      api.security.openUri(uri.dataset.uri);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'dns-flush') {
      await confirmRun({ run: () => api.net.action('dns-flush') });
    } else if (act === 'net-reset') {
      await confirmRun({
        title: 'Reset network settings?',
        message: 'Resets Winsock and TCP/IP to Windows defaults. It fixes broken network settings left by old VPNs or "speed booster" apps. You need to restart your PC afterwards, and you may need to re-enter a Wi-Fi password.',
        confirmLabel: 'Reset',
        kind: 'danger',
        run: () => api.net.action('net-reset'),
      });
    } else if (act === 'run') {
      this.run();
    } else if (act === 'regions') {
      this.allRegions = !this.allRegions;
      this.render();
    }
  }

  render() {
    this.disposeChart?.();
    this.disposeChart = null;
    const running = this.state === 'running';
    this.runBtn.textContent = running ? 'Stop' : this.result ? 'Test again' : 'Test my connection';
    this.runBtn.classList.toggle('btn-stop-big', running);
    if (this.status && !this.status.supported) {
      this.body.innerHTML = notSupportedHtml();
      return;
    }
    if (running) {
      this.body.innerHTML = '<div class="ping-progress"></div>';
      this.renderProgress();
      return;
    }
    if (!this.result) {
      this.body.innerHTML = this.introHtml();
      return;
    }
    this.body.innerHTML = this.resultHtml(this.result);
    const chartHost = this.body.querySelector('.latency-chart');
    if (chartHost) {
      const r = this.result;
      const series = SERIES.map((s) => ({
        ...s,
        samples: s.id === 'router' ? r.router?.samples : s.id === 'internet' ? r.internet?.samples : r.loaded?.samples,
        stepSec: s.id === 'loaded' ? 0.3 : 0.25,
      })).filter((s) => s.samples?.length);
      this.disposeChart = latencyChart(chartHost, series);
    }
  }

  renderProgress() {
    const box = this.body.querySelector('.ping-progress');
    if (!box) return;
    const p = this.progress || {};
    const sp = p.speed && (p.step === 3 || p.step === 4) ? p.speed : null;
    box.innerHTML = `<div class="scan-live">
      <div class="scan-ring spinning violet">${icon(sp ? 'gauge' : 'pulse', { size: 44 })}</div>
      <div class="scan-live-text">
        <div class="scan-title">${esc(p.text || 'Testing…')}</div>
        ${sp ? `<div class="live-speed"><b>${sp.mbps}</b> Mbps ${sp.direction === 'down' ? 'download' : 'upload'}</div>` : '<div class="muted">This takes about 30 seconds. Try not to download anything meanwhile.</div>'}
        <div class="steps">${STEPS.map((t, i) => `<span class="${i + 1 < p.step ? 'done' : i + 1 === p.step ? 'now' : ''}">${esc(t)}</span>`).join('')}</div>
      </div>
    </div>`;
  }

  introHtml() {
    return `<div class="hc-intro violet">
      <div class="hc-intro-ico">${icon('gauge', { size: 48 })}</div>
      <div><div class="scan-title">Find out where your lag comes from</div>
      <ul class="hc-list">
        <li>${icon('router', { size: 16 })} Pings your router to check Wi-Fi or cable problems in your home</li>
        <li>${icon('globe', { size: 16 })} Pings the internet to check your line and your provider</li>
        <li>${icon('server', { size: 16 })} Measures ping to game-server regions (and EA's servers while FC is running)</li>
        <li>${icon('arrowDown', { size: 16 })} Tests download and upload speed, and how much ping rises while downloading</li>
        <li>${icon('wand', { size: 16 })} Explains the cause in plain words and what to do about it</li>
      </ul>
      <button class="btn btn-violet" data-act="run">Test my connection</button>
      <p class="muted small">Takes about 30 seconds. Close downloads first for a fair result.</p></div>
    </div>`;
  }

  resultHtml(r) {
    const internet = r.internet || {};
    const speed = r.speed || {};
    const bloat = r.bufferbloat;
    const regions = (r.regions || []).filter((x) => x.ms != null);
    const best = regions[0];
    const info = r.info || {};
    const w = info.wifi;
    const findings = r.findings || [];
    const regionRows = (this.allRegions ? regions : regions.slice(0, 8)).map((x, i) => ({ label: x.name, value: x.ms, highlight: i === 0 }));
    const legend = SERIES.map((s) => {
      const st = s.id === 'router' ? r.router : s.id === 'internet' ? r.internet : r.loaded;
      if (!st?.samples?.length) return '';
      return `<span class="legend-item"><i style="background:${s.color}"></i>${esc(s.label)}<span class="muted"> · avg ${st.avg ?? '—'} ms</span></span>`;
    }).join('');

    return `
      <div class="kpis">
        ${tile('Ping', internet.avg == null ? null : Math.round(internet.avg), 'ms', QUALITY.ping(internet.avg))}
        ${tile('Jitter', internet.jitter, 'ms', QUALITY.jitter(internet.jitter))}
        ${tile('Packet loss', internet.loss, '%', QUALITY.loss(internet.loss))}
        ${tile('Download', speed.download ?? null, 'Mbps', QUALITY.down(speed.download))}
        ${tile('Upload', speed.upload ?? null, 'Mbps', QUALITY.up(speed.upload))}
        ${tile('Lag when busy', bloat ? bloat.grade : null, '', QUALITY.grade(bloat?.grade), bloat ? `+${bloat.increase} ms` : '')}
      </div>

      <div class="card">
        <div class="card-head"><span>Where the delay happens</span><span class="muted small">Tested ${esc(relativeTime(r.time).toLowerCase())}${r.demo ? ' · demo data' : ''}</span></div>
        <div class="hops">
          ${pcHop(info)}
          <span class="hop-link">${icon('chevronRight', { size: 18 })}</span>
          ${hop('router', 'Router', r.router, info.gateway)}
          <span class="hop-link">${icon('chevronRight', { size: 18 })}</span>
          ${hop('globe', 'Internet', internet, internet.host)}
          <span class="hop-link">${icon('chevronRight', { size: 18 })}</span>
          ${hop('server', r.game?.running && r.game.servers?.length ? 'EA servers (live)' : 'Nearest servers', r.game?.running && r.game.servers?.length ? { avg: Math.min(...r.game.servers.filter((s) => s.ms != null).map((s) => s.ms)), loss: 0, jitter: 0, p95: 0 } : best ? { avg: best.ms, loss: 0, jitter: 0, p95: best.ms } : null, best ? best.name : '')}
        </div>
      </div>

      <div class="card-grid">
        <div class="card">
          <div class="card-head"><span>Ping over time <span class="muted small">(ms)</span></span><span class="legend">${legend}</span></div>
          <div class="latency-chart"></div>
          <div class="muted small chart-note">Gaps and red ticks on the baseline are lost packets. Hover for exact values.</div>
        </div>
        <div class="card">
          <div class="card-head"><span>Game-server regions</span>${regions.length > 8 ? `<button class="link-btn" data-act="regions">${this.allRegions ? 'Show fewer' : `Show all ${regions.length}`}</button>` : ''}</div>
          ${regions.length ? barList(regionRows) : '<div class="muted small">No region answered. A firewall may block the test.</div>'}
          <div class="muted small chart-note">Online matches (including EA SPORTS FC) are hosted in data centres like these. The closest one is highlighted.</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><span>What could cause lag</span></div>
        <div class="findings">${findings.map((f) => `
          <div class="finding-row">
            ${sevIcon(f.severity)}
            <div class="hc-text">
              <div class="hc-title">${esc(f.title)}</div>
              <div class="hc-sub full">${esc(f.summary || '')}</div>
              ${f.advice ? `<div class="advice slim">${icon('info', { size: 15 })}<span>${esc(f.advice)}</span></div>` : ''}
              ${f.evidence?.length ? `<div class="muted small">${f.evidence.map(esc).join(' · ')}</div>` : ''}
            </div>
            <div class="hc-actions">${f.link ? (f.link.view ? `<button class="btn btn-sm btn-violet-ghost" data-view="${esc(f.link.view)}">${esc(f.link.label)}</button>` : `<button class="btn btn-sm" data-uri="${esc(f.link.uri)}">${esc(f.link.label)}</button>`) : ''}</div>
          </div>`).join('')}
        </div>
      </div>

      <div class="card-grid">
        <div class="card">
          <div class="card-head"><span>Your connection</span></div>
          <dl class="kv">
            <dt>Type</dt><dd class="norm">${esc({ wifi: 'Wi-Fi', ethernet: 'Cable (Ethernet)', vpn: 'VPN', other: 'Other', none: 'Not connected' }[info.type] || '—')}</dd>
            <dt>Adapter</dt><dd>${esc(info.adapter?.description || '—')}${info.adapter?.linkMbps ? ` <span class="muted">(${info.adapter.linkMbps} Mbps link)</span>` : ''}</dd>
            ${w ? `<dt>Wi-Fi</dt><dd>${esc(w.ssid || '')} · signal ${w.signal ?? '?'}%${w.band ? ` · ${w.band} GHz` : ''}${w.channel ? ` · channel ${w.channel}` : ''}${w.radio ? ` · ${esc(w.radio)}` : ''}</dd>` : ''}
            <dt>Router</dt><dd class="selectable">${esc(info.gateway || '—')}</dd>
            <dt>DNS</dt><dd class="selectable">${esc((info.dns || []).join(', ') || '—')}</dd>
            <dt>Before the test</dt><dd class="norm">${info.background ? `${info.background.rxMbps ?? 0} Mbps down, ${info.background.txMbps ?? 0} Mbps up already in use` : '—'}</dd>
            ${info.vpn?.length ? `<dt>VPN</dt><dd>${esc(info.vpn.join(', '))}</dd>` : ''}
          </dl>
        </div>
        <div class="card">
          <div class="card-head"><span>Fix tools</span></div>
          <div class="tools">
            <div class="tool"><div><div>Turn on Game Mode</div><div class="muted small">Closes downloaders and pauses Windows Update while you play.</div></div><button class="btn btn-sm btn-violet" data-view="game/mode">Open</button></div>
            <div class="tool"><div><div>Clear DNS cache</div><div class="muted small">Fixes sites or game services that won't connect after a change.</div></div><button class="btn btn-sm" data-act="dns-flush">Clear</button></div>
            <div class="tool"><div><div>Reset network settings</div><div class="muted small">For broken settings left by VPNs or "booster" apps. Needs a restart.</div></div><button class="btn btn-sm" data-act="net-reset">Reset…</button></div>
            <div class="tool"><div><div>Wi-Fi settings</div><div class="muted small">Switch to your 5 GHz network or forget a weak one.</div></div><button class="btn btn-sm" data-uri="ms-settings:network-wifi">Open</button></div>
          </div>
        </div>
      </div>`;
  }
}
