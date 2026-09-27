'use strict';

// Hash-only VirusTotal lookups: files are never uploaded, only their SHA-256.

const API = 'https://www.virustotal.com/api/v3/files/';
let queue = Promise.resolve();
let lastCall = 0;
const MIN_GAP_MS = 15_500; // free API keys allow 4 lookups per minute

function parseReport(json) {
  const a = json?.data?.attributes || {};
  const stats = a.last_analysis_stats || {};
  return {
    found: true,
    malicious: stats.malicious || 0,
    suspicious: stats.suspicious || 0,
    harmless: (stats.harmless || 0) + (stats.undetected || 0),
    total: Object.values(stats).reduce((s, n) => s + (Number(n) || 0), 0),
    label: a.popular_threat_classification?.suggested_threat_label || '',
    name: a.meaningful_name || '',
    lastAnalysis: a.last_analysis_date ? a.last_analysis_date * 1000 : null,
  };
}

async function request(sha256, apiKey, fetchImpl) {
  const res = await fetchImpl(`${API}${sha256}`, { headers: { 'x-apikey': apiKey, accept: 'application/json' } });
  if (res.status === 404) return { found: false };
  if (res.status === 401 || res.status === 403) throw new Error('VirusTotal rejected the API key. Check it in Settings.');
  if (res.status === 429) throw new Error('VirusTotal limit reached (4 lookups a minute, 500 a day on free keys). Try again later.');
  if (!res.ok) throw new Error(`VirusTotal error ${res.status}`);
  return parseReport(await res.json());
}

/** Look up a file hash, respecting the free-tier rate limit. */
function lookup(sha256, apiKey, fetchImpl = globalThis.fetch) {
  if (!/^[a-f0-9]{64}$/i.test(String(sha256))) return Promise.reject(new Error('Invalid file hash.'));
  if (!apiKey) return Promise.reject(new Error('Add your free VirusTotal API key in Settings first.'));
  const run = async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return request(sha256, apiKey, fetchImpl);
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

module.exports = { lookup, parseReport };
