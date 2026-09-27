'use strict';

// Pure functions behind the Ping & Speed checker: statistics, Wi-Fi parsing,
// connection details and the plain-language diagnosis.

const { asObjects, str } = require('../security/analyze/common');
const { BANDWIDTH_HOGS, VPN_ADAPTER } = require('./knowledge');

const round = (n, d = 0) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

/** avg / min / max / jitter / loss for a list of round-trip times (-1 = lost). */
function pingStats(samples) {
  const all = (Array.isArray(samples) ? samples : []).map(Number).filter((n) => Number.isFinite(n));
  const ok = all.filter((n) => n >= 0);
  const lost = all.length - ok.length;
  const loss = all.length ? (lost / all.length) * 100 : 100;
  if (!ok.length) return { count: all.length, lost, loss: round(loss, 1), avg: null, min: null, max: null, median: null, p95: null, jitter: null, spikes: 0 };
  const sorted = [...ok].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  let diff = 0;
  for (let i = 1; i < ok.length; i++) diff += Math.abs(ok[i] - ok[i - 1]);
  const median = pick(0.5);
  return {
    count: all.length,
    lost,
    loss: round(loss, 1),
    avg: round(ok.reduce((s, n) => s + n, 0) / ok.length, 1),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
    p95: pick(0.95),
    jitter: ok.length > 1 ? round(diff / (ok.length - 1), 1) : 0,
    spikes: ok.filter((n) => n > median + Math.max(30, median)).length,
  };
}

/** How much the ping rises while the connection is busy, graded like common bufferbloat tests. */
function bufferbloat(idleMs, loadedMs) {
  if (idleMs == null || loadedMs == null) return null;
  const increase = Math.max(0, Math.round(loadedMs - idleMs));
  const grade = increase <= 5 ? 'A+' : increase < 30 ? 'A' : increase < 60 ? 'B' : increase < 200 ? 'C' : increase < 400 ? 'D' : 'F';
  return { increase, grade };
}

/** netsh wlan show interfaces → signal, band, channel, radio type. Works in any Windows language. */
function parseWifi(lines) {
  const text = Array.isArray(lines) ? lines.map(str) : String(lines || '').split(/\r?\n/);
  const pairs = [];
  for (const line of text) {
    const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
    if (m) pairs.push([m[1].trim(), m[2].trim()]);
  }
  if (!pairs.length) return null;
  const find = (re) => pairs.find(([k]) => re.test(k))?.[1] || '';
  const signal = Number((text.join('\n').match(/(\d{1,3})\s*%/) || [])[1]);
  const ssid = find(/^SSID$/i);
  const state = find(/^(State|Status|Zustand|État|Estado|Stato|Durum|Состояние)$/i);
  if (!ssid && !Number.isFinite(signal)) return null;
  const all = pairs.map(([, v]) => v).join('\n');
  const band = (all.match(/\b(2[.,]4|5|6)\s*GHz/i) || [])[1];
  const channel = Number(find(/^(Channel|Kanal|Canal|Canale|Kanaal|Канал)$/i)) || null;
  return {
    ssid,
    connected: !state || /connect|verbunden|connecté|conectado|connesso|bağlı|подключ/i.test(state),
    signal: Number.isFinite(signal) ? signal : null,
    radio: (all.match(/802\.11\s?[a-z]{1,2}/i) || [''])[0].replace(/\s/, ''),
    band: band ? band.replace(',', '.') : channel ? (channel <= 14 ? '2.4' : '5') : null,
    channel,
  };
}

function parseLinkMbps(adapter) {
  const bps = Number(adapter?.receiveBps);
  if (Number.isFinite(bps) && bps > 0) return Math.round(bps / 1e6);
  const m = /([\d.]+)\s*(G|M)bps/i.exec(str(adapter?.linkSpeed));
  return m ? Math.round(Number(m[1]) * (m[2].toUpperCase() === 'G' ? 1000 : 1)) : null;
}

/** Which adapter carries internet traffic, and what it is. */
function connectionInfo(raw) {
  const adapters = asObjects(raw?.adapters);
  const routes = asObjects(raw?.defaultRoutes).filter((r) => str(r.nextHop) && str(r.nextHop) !== '0.0.0.0').sort((a, b) => (Number(a.metric) || 0) - (Number(b.metric) || 0));
  const route = routes.find((r) => adapters.some((a) => a.index === r.index)) || routes[0] || null;
  const adapter = adapters.find((a) => route && a.index === route.index) || adapters.find((a) => a.hardware) || adapters[0] || null;
  const desc = `${str(adapter?.name)} ${str(adapter?.description)} ${str(adapter?.media)} ${str(adapter?.medium)}`;
  const type = !adapter ? 'none'
    : /802\.11|wireless|wi-?fi|wlan/i.test(desc) ? 'wifi'
      : /802\.3|ethernet|gbe|gigabit|realtek pcie|intel\(r\) ethernet|killer e/i.test(desc) ? 'ethernet'
        : VPN_ADAPTER.test(desc) ? 'vpn' : 'other';
  const vpn = adapters.filter((a) => VPN_ADAPTER.test(`${str(a.name)} ${str(a.description)}`)).map((a) => str(a.description) || str(a.name));
  const dnsRow = asObjects(raw?.dns).find((d) => adapter && d.index === adapter.index) || asObjects(raw?.dns)[0];
  const traffic = asObjects(raw?.traffic);
  const rx = traffic.reduce((s, t) => s + (Number(t.rxBps) || 0), 0);
  const tx = traffic.reduce((s, t) => s + (Number(t.txBps) || 0), 0);
  const procs = asObjects(raw?.processes);
  const hogs = [...new Set(procs.map((p) => str(p.name)).filter((n) => BANDWIDTH_HOGS.test(n)))];
  const updating = asObjects(raw?.downloads).length > 0;
  return {
    adapter: adapter ? { name: str(adapter.name), description: str(adapter.description), linkMbps: parseLinkMbps(adapter) } : null,
    type,
    wifi: type === 'wifi' ? parseWifi(raw?.wifi) : null,
    gateway: route ? str(route.nextHop) : '',
    dns: dnsRow ? (Array.isArray(dnsRow.servers) ? dnsRow.servers : [dnsRow.servers]).map(str).filter(Boolean) : [],
    vpn,
    background: { rxMbps: round(rx / 1e6, 1), txMbps: round(tx / 1e6, 1) },
    hogs,
    updating,
  };
}

/** Public servers a running game is talking to (for "EA servers your game uses"). */
function gameServers(raw, isGame) {
  const procs = asObjects(raw?.processes);
  const pids = new Set(procs.filter((p) => isGame(str(p.name))).map((p) => p.pid));
  if (!pids.size) return { running: false, servers: [] };
  const seen = new Map();
  for (const c of asObjects(raw?.connections)) {
    if (!pids.has(c.pid)) continue;
    const ip = str(c.remoteAddress);
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip)) continue;
    if (!seen.has(ip)) seen.set(ip, { ip, port: Number(c.remotePort) || 443 });
  }
  return { running: true, servers: [...seen.values()].slice(0, 6) };
}

// ------------------------------------------------------------- diagnosis ---

const f = (fields) => ({ fix: null, link: null, evidence: [], ...fields });

/**
 * Explain what is behind high or unstable ping, most important first.
 * `ping` holds pingStats for router, internet (best public DNS) and loaded.
 */
function diagnose({ info, router, internet, loaded, regions = [], speed = null, game = null }) {
  const out = [];
  const bloat = bufferbloat(internet?.avg, loaded?.avg);

  // 1. Where the problem starts: PC→router, or router→internet.
  const routerAnswers = router && router.avg != null;
  const routerBad = routerAnswers && (router.loss >= 2 || router.jitter > 5 || router.p95 > 25 || router.avg > 10);
  const netBad = internet && internet.avg != null && (internet.loss >= 1 || internet.jitter > 12 || internet.spikes > 1);
  if (routerBad) {
    out.push(f({
      id: 'local', severity: router.loss >= 5 || router.p95 > 60 ? 'danger' : 'warning',
      title: 'The lag starts between your PC and your router',
      summary: `Pings to your router should be about 1 ms and steady. Yours average ${router.avg} ms, jump by ${router.jitter} ms${router.loss ? ` and ${router.loss}% are lost` : ''}.`,
      advice: info?.type === 'wifi'
        ? 'This is almost always Wi-Fi: distance, walls, microwaves or neighbours on the same channel. A cable fixes it; if you can\'t, move closer or use the 5 GHz network.'
        : 'On a cable this points to a faulty cable, port or network adapter. Try another cable and router port.',
      evidence: [`Router ${info?.gateway || ''}: avg ${router.avg} ms, max ${router.max} ms, jitter ${router.jitter} ms, loss ${router.loss}%`],
    }));
  }
  if (netBad && !routerBad) {
    out.push(f({
      id: 'isp', severity: internet.loss >= 3 || internet.jitter > 30 ? 'danger' : 'warning',
      title: 'The lag starts after your router: your internet line',
      summary: `Your PC-to-router link is fine, but the internet side ${internet.loss >= 1 ? `loses ${internet.loss}% of packets` : `jumps by ${internet.jitter} ms`}.`,
      advice: 'Restart the router (unplug it for 30 seconds). Check the cable from the wall to the router. If it keeps happening, contact your internet provider and tell them about packet loss or jitter at peak times.',
      evidence: [`Internet: avg ${internet.avg} ms, max ${internet.max} ms, jitter ${internet.jitter} ms, loss ${internet.loss}%`],
    }));
  }

  // 2. Bufferbloat: ping rises when something downloads.
  if (bloat && bloat.increase >= 30) {
    out.push(f({
      id: 'bufferbloat', severity: bloat.increase >= 150 ? 'danger' : 'warning',
      title: `Your ping jumps by ${bloat.increase} ms when the connection is busy (grade ${bloat.grade})`,
      summary: 'This is called bufferbloat: when anything downloads or uploads (game updates, streams, cloud backups), your game packets wait in a queue.',
      advice: 'Turn on SQM, "Smart Queue", QoS or "Gaming mode" in your router settings, and limit download speed in Steam and the EA app. Game Mode pauses Windows downloads while you play.',
      link: { label: 'Open Game Mode', view: 'game/mode' },
      evidence: [`Idle ${internet.avg} ms → busy ${loaded.avg} ms`],
    }));
  }

  // 3. Wi-Fi and cable.
  if (info?.type === 'wifi') {
    const w = info.wifi || {};
    if (w.signal != null && w.signal < 60) {
      out.push(f({ id: 'wifi-signal', severity: w.signal < 40 ? 'danger' : 'warning', title: `Weak Wi-Fi signal (${w.signal}%)`, summary: 'A weak signal means resent packets, which shows up as lag spikes.', advice: 'Move closer to the router, remove obstacles, or use a cable or powerline adapter.', link: { label: 'Wi-Fi settings', uri: 'ms-settings:network-wifi' } }));
    }
    if (w.band === '2.4') {
      out.push(f({ id: 'wifi-band', severity: 'warning', title: 'You\'re on the crowded 2.4 GHz band', summary: `Channel ${w.channel || '?'} on 2.4 GHz is shared with neighbours, Bluetooth and microwaves.`, advice: 'Connect to your router\'s 5 GHz network (often named with "5G").', link: { label: 'Wi-Fi settings', uri: 'ms-settings:network-wifi' } }));
    }
    out.push(f({ id: 'wifi', severity: 'notice', title: 'You\'re playing on Wi-Fi', summary: 'Even good Wi-Fi adds small random delays. For ranked FC matches, a network cable gives the steadiest ping.', evidence: [w.ssid ? `${w.ssid}: signal ${w.signal ?? '?'}%, ${w.band ? `${w.band} GHz` : ''} ${w.radio || ''}`.trim() : ''].filter(Boolean) }));
  } else if (info?.type === 'ethernet') {
    const link = info.adapter?.linkMbps;
    if (link && link <= 100 && speed?.download > 80) {
      out.push(f({ id: 'cable-100', severity: 'warning', title: 'Your cable connection runs at only 100 Mbps', summary: 'Your internet is faster than the cable link, which usually means an old cable (Cat5) or a damaged plug.', advice: 'Use a Cat5e or Cat6 cable and another router port.' }));
    }
  }

  // 4. Something else is using the internet.
  const bg = info?.background || {};
  if ((bg.rxMbps || 0) >= 3 || (bg.txMbps || 0) >= 1 || info?.updating) {
    out.push(f({
      id: 'background', severity: (bg.rxMbps || 0) >= 15 || (bg.txMbps || 0) >= 5 ? 'danger' : 'warning',
      title: 'Something is using your internet right now',
      summary: `Before the test, your PC was already ${bg.rxMbps >= 0.1 ? `downloading ${bg.rxMbps} Mbps` : ''}${bg.rxMbps >= 0.1 && bg.txMbps >= 0.1 ? ' and ' : ''}${bg.txMbps >= 0.1 ? `uploading ${bg.txMbps} Mbps` : ''}${info?.updating ? ' (Windows is downloading updates)' : ''}.`,
      advice: `Pause downloads before playing${info?.hogs?.length ? `: ${info.hogs.join(', ')} can download in the background` : ''}. Game Mode closes these and pauses Windows Update with one button.`,
      link: { label: 'Open Game Mode', view: 'game/mode' },
    }));
  } else if (info?.hogs?.length) {
    out.push(f({ id: 'hogs', severity: 'notice', title: 'Apps that can start downloading mid-match are open', summary: `${info.hogs.join(', ')} can start updates or sync at any time.`, advice: 'Game Mode closes them while you play.', link: { label: 'Open Game Mode', view: 'game/mode' } }));
  }

  // 5. VPN.
  if (info?.vpn?.length) {
    out.push(f({ id: 'vpn', severity: 'warning', title: 'A VPN is connected', summary: `${info.vpn.join(', ')} sends your game traffic on a detour, which adds ping.`, advice: 'Disconnect the VPN while playing unless you need it.' }));
  }

  // 6. Speed.
  if (speed?.download != null && speed.download < 10) {
    out.push(f({ id: 'slow-down', severity: 'warning', title: `Download speed is low (${speed.download} Mbps)`, summary: 'Online matches need little speed, but anything else using the connection will hurt your ping quickly.', advice: 'Check your plan and the Wi-Fi signal.' }));
  }
  if (speed?.upload != null && speed.upload < 2) {
    out.push(f({ id: 'slow-up', severity: 'warning', title: `Upload speed is low (${speed.upload} Mbps)`, summary: 'Low upload makes voice chat and cloud backups fight with your game.', advice: 'Pause backups (OneDrive, Google Drive) while playing.' }));
  }

  // 7. Distance to servers.
  const best = regions.filter((r) => r.ms != null).sort((a, b) => a.ms - b.ms)[0];
  if (best && best.ms > 90) {
    out.push(f({ id: 'far', severity: 'notice', title: `The nearest game-server region is ${best.ms} ms away (${best.name})`, summary: 'Distance sets a minimum ping that no setting can remove.', advice: 'Choose the closest server region in the game when it lets you.' }));
  }
  if (game?.running && game.servers?.length) {
    const worst = game.servers.filter((s) => s.ms != null).sort((a, b) => b.ms - a.ms)[0];
    if (worst && worst.ms > 120) out.push(f({ id: 'game-far', severity: 'warning', title: `Your game is talking to a server ${worst.ms} ms away`, summary: `${worst.ip} is far from you. Matches hosted there will feel laggy.`, advice: 'Restart the game to be matched to a closer server.' }));
  }

  if (!out.some((x) => x.severity === 'danger' || x.severity === 'warning')) {
    out.unshift(f({ id: 'ok', severity: 'ok', title: 'Your connection looks good for online games', summary: internet?.avg != null ? `Steady ${internet.avg} ms to the internet with ${internet.loss}% packet loss${bloat ? ` and bufferbloat grade ${bloat.grade}` : ''}.` : 'No problems found.' }));
  }
  const order = { danger: 0, warning: 1, notice: 2, ok: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** One-line quality label for a ping value. */
function pingQuality(ms) {
  if (ms == null) return 'none';
  return ms < 30 ? 'great' : ms < 60 ? 'good' : ms < 100 ? 'ok' : 'bad';
}

module.exports = { pingStats, bufferbloat, parseWifi, parseLinkMbps, connectionInfo, gameServers, diagnose, pingQuality };
