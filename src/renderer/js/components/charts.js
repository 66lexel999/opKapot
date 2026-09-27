// Small SVG charts for the Ping & Speed page: a latency line chart with a
// crosshair tooltip, and a horizontal bar list. Colours come from CSS tokens.

import { esc } from '../util.js';

const NS = 'http://www.w3.org/2000/svg';

function niceMax(v) {
  if (!Number.isFinite(v) || v <= 0) return 10;
  const steps = [10, 20, 25, 50, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000];
  return steps.find((s) => s >= v * 1.1) || Math.ceil(v / 500) * 500;
}

function tooltipEl(host) {
  let tip = host.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    host.append(tip);
  }
  return tip;
}

/**
 * Latency lines. series: [{ id, label, color (CSS var), samples: [ms|-1], stepSec }].
 * Lost packets leave a gap in the line and a small mark on the baseline.
 */
export function latencyChart(host, series, { height = 220 } = {}) {
  const draw = () => {
    const width = Math.max(320, host.clientWidth);
    const pad = { l: 44, r: 16, t: 12, b: 28 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;
    const maxX = Math.max(1, ...series.map((s) => (s.samples.length - 1) * s.stepSec));
    const maxY = niceMax(Math.max(...series.flatMap((s) => s.samples.filter((v) => v >= 0))));
    const x = (t) => pad.l + (t / maxX) * w;
    const y = (v) => pad.t + h - (v / maxY) * h;
    const ticks = [0, maxY / 4, maxY / 2, (maxY * 3) / 4, maxY];

    const grid = ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${pad.l + w}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`).join('');
    const xTicks = [];
    for (let t = 0; t <= maxX + 0.001; t += maxX > 8 ? 2 : 1) xTicks.push(`<text class="tick" x="${x(t)}" y="${height - 8}" text-anchor="middle">${t}s</text>`);

    const lines = series.map((s) => {
      let d = '';
      let pen = false;
      const lost = [];
      s.samples.forEach((v, i) => {
        const px = x(i * s.stepSec);
        if (v < 0) {
          pen = false;
          lost.push(px);
          return;
        }
        d += `${pen ? 'L' : 'M'}${px.toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      const marks = lost.map((px) => `<line class="lost" x1="${px}" x2="${px}" y1="${pad.t + h - 7}" y2="${pad.t + h}" style="stroke:var(--status-critical)"/>`).join('');
      return `<path class="series" d="${d}" style="stroke:${s.color}"/>${marks}`;
    }).join('');

    host.innerHTML = `<svg class="chart-svg" width="${width}" height="${height}" role="img" aria-label="Ping over time">
      ${grid}<line class="axis" x1="${pad.l}" x2="${pad.l + w}" y1="${pad.t + h}" y2="${pad.t + h}"/>${xTicks.join('')}
      ${lines}
      <line class="crosshair" y1="${pad.t}" y2="${pad.t + h}" hidden/>
      <g class="dots"></g>
      <rect class="hit" x="${pad.l}" y="${pad.t}" width="${w}" height="${h}" fill="transparent"/>
    </svg>`;
    const svg = host.querySelector('svg');
    const hit = svg.querySelector('.hit');
    const cross = svg.querySelector('.crosshair');
    const dots = svg.querySelector('.dots');
    const tip = tooltipEl(host);

    const show = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const t = Math.max(0, Math.min(maxX, ((clientX - rect.left - pad.l) / w) * maxX));
      cross.removeAttribute('hidden');
      cross.setAttribute('x1', x(t));
      cross.setAttribute('x2', x(t));
      dots.innerHTML = '';
      tip.textContent = '';
      const head = document.createElement('div');
      head.className = 'tip-head';
      head.textContent = `${t.toFixed(1)} s`;
      tip.append(head);
      for (const s of series) {
        const i = Math.round(t / s.stepSec);
        if (i < 0 || i >= s.samples.length) continue;
        const v = s.samples[i];
        if (v >= 0) {
          const dot = document.createElementNS(NS, 'circle');
          dot.setAttribute('cx', x(i * s.stepSec));
          dot.setAttribute('cy', y(v));
          dot.setAttribute('r', 4);
          dot.setAttribute('class', 'dot');
          dot.style.fill = s.color;
          dots.append(dot);
        }
        const row = document.createElement('div');
        row.className = 'tip-row';
        const key = document.createElement('i');
        key.style.background = s.color;
        const val = document.createElement('b');
        val.textContent = v >= 0 ? `${v} ms` : 'lost';
        const lab = document.createElement('span');
        lab.textContent = s.label;
        row.append(key, val, lab);
        tip.append(row);
      }
      tip.hidden = false;
      const hostRect = host.getBoundingClientRect();
      const left = clientX - hostRect.left + 14;
      tip.style.left = `${Math.min(left, hostRect.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${pad.t + 6}px`;
    };
    hit.addEventListener('pointermove', (e) => show(e.clientX));
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('hidden', '');
      dots.innerHTML = '';
      tip.hidden = true;
    });
  };
  draw();
  const ro = new ResizeObserver(() => {
    if (Math.abs(host.clientWidth - (host.querySelector('svg')?.getAttribute('width') || 0)) > 4) draw();
  });
  ro.observe(host);
  return () => ro.disconnect();
}

/** Horizontal bars, sorted by the caller. rows: [{ label, value, highlight }]. */
export function barList(rows, { unit = 'ms', max } = {}) {
  const top = max || Math.max(1, ...rows.map((r) => r.value || 0));
  return `<div class="bars" role="list">${rows.map((r) => {
    const pct = r.value == null ? 0 : Math.max(2, (r.value / top) * 100);
    return `<div class="bar-row${r.highlight ? ' hl' : ''}" role="listitem" title="${esc(r.label)}: ${r.value == null ? 'no answer' : `${r.value} ${unit}`}">
      <span class="bar-label trunc">${esc(r.label)}</span>
      <span class="bar-track"><i style="width:${pct}%"></i></span>
      <span class="bar-value">${r.value == null ? '—' : `${r.value} ${unit}`}</span>
    </div>`;
  }).join('')}</div>`;
}
