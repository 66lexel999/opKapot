'use strict';

// Network probes that run in Node: TCP connect time (a stand-in for ping to
// servers that ignore ICMP) and a download/upload speed test.

const net = require('node:net');
const dns = require('node:dns').promises;
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

/** Time to open a TCP connection, in ms (-1 if it failed). */
function connectOnce(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const socket = net.connect({ host: ip, port });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(-1));
    socket.once('connect', () => finish(Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10));
    socket.once('error', () => finish(-1));
  });
}

/** Several TCP connect timings to one host. DNS lookup time is left out. */
async function tcpPing(host, port = 443, { count = 4, timeoutMs = 2500, gapMs = 120 } = {}) {
  let ip = host;
  if (!net.isIP(host)) {
    try {
      ip = (await dns.lookup(host, { family: 4 })).address;
    } catch {
      return { host, ip: '', samples: new Array(count).fill(-1) };
    }
  }
  const samples = [];
  for (let i = 0; i < count; i++) {
    samples.push(await connectOnce(ip, port, timeoutMs));
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  return { host, ip, samples };
}

/** Lowest successful sample: the fairest single "ping" for a TCP probe. */
function bestOf(samples) {
  const ok = (samples || []).filter((n) => n >= 0);
  return ok.length ? Math.round(Math.min(...ok)) : null;
}

/**
 * Download or upload for a fixed time over parallel connections and report
 * Mbps, ignoring the first second while TCP ramps up.
 */
function transfer({ base, direction, seconds = 8, streams = 4, onProgress = () => {}, signal }) {
  const url = new URL(direction === 'down' ? '/__down?bytes=25000000' : '/__up', base);
  const lib = url.protocol === 'http:' ? http : https;
  const start = Date.now();
  const deadline = start + seconds * 1000;
  const warmupAt = start + 1000;
  let bytes = 0;
  let warmBytes = null;
  const requests = new Set();
  const chunk = direction === 'up' ? crypto.randomBytes(256 * 1024) : null;

  const tick = setInterval(() => {
    if (warmBytes == null && Date.now() >= warmupAt) warmBytes = bytes;
    onProgress({ direction, mbps: rate(), elapsed: Date.now() - start });
  }, 250);

  function rate() {
    const t = Date.now();
    if (warmBytes == null || t <= warmupAt) return ((bytes * 8) / Math.max(1, t - start)) / 1000;
    return (((bytes - warmBytes) * 8) / Math.max(1, t - warmupAt)) / 1000;
  }

  const stream = () => new Promise((resolve) => {
    if (Date.now() >= deadline || signal?.aborted) {
      resolve();
      return;
    }
    const req = lib.request(url, {
      method: direction === 'down' ? 'GET' : 'POST',
      headers: { 'user-agent': 'opKapot', ...(direction === 'up' ? { 'content-type': 'application/octet-stream' } : {}) },
      timeout: 15_000,
    }, (res) => {
      res.on('data', (d) => {
        if (direction === 'down') bytes += d.length;
        if (Date.now() >= deadline) req.destroy();
      });
      res.on('end', () => resolve(stream()));
      res.on('error', () => resolve());
      res.on('close', () => resolve());
    });
    requests.add(req);
    req.on('close', () => requests.delete(req));
    req.on('error', () => resolve(Date.now() < deadline ? stream() : undefined));
    req.on('timeout', () => req.destroy());
    if (direction === 'up') {
      const pump = () => {
        while (Date.now() < deadline && !signal?.aborted) {
          const okToWrite = req.write(chunk, () => { bytes += chunk.length; });
          if (!okToWrite) {
            req.once('drain', pump);
            return;
          }
        }
        req.end();
      };
      pump();
    } else {
      req.end();
    }
  });

  const abort = () => {
    for (const r of requests) r.destroy();
  };
  signal?.addEventListener('abort', abort, { once: true });
  const killer = setTimeout(abort, seconds * 1000 + 3000);
  return Promise.all(Array.from({ length: streams }, stream)).then(() => {
    clearInterval(tick);
    clearTimeout(killer);
    abort();
    const mbps = Math.round(rate() * 10) / 10;
    return { mbps, bytes };
  });
}

module.exports = { tcpPing, bestOf, transfer, connectOnce };
