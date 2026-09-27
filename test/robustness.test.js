'use strict';

// Real Windows PCs return data in shapes the sample data never shows: missing
// fields, nulls, one item instead of a list, failed sections, and Windows
// PowerShell 5.1's {"value": [...], "Count": n} arrays. Every analyzer must
// survive all of them (this is what broke Hack Check in 1.1.0).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const demo = require('../src/main/security/demo');
const { analyzeAudit, auditFiles } = require('../src/main/security/analyze/audit');
const { analyzeConnections } = require('../src/main/security/analyze/network');
const { analyzeAutoruns, autorunFiles } = require('../src/main/security/analyze/autoruns');
const { analyzePrivacy } = require('../src/main/security/analyze/privacy');
const { mapDefender } = require('../src/main/security/analyze/defender');
const { asArray, normalizePs } = require('../src/main/security/analyze/common');
const { snapshot, diffSnapshots } = require('../src/main/security/guard');
const { SecurityService } = require('../src/main/security/service');

const clone = (x) => JSON.parse(JSON.stringify(x));
const env = demo.ENV;

function analyzeAll(src) {
  const { audit, autoruns, network, status, extensions } = src;
  const sigs = {};
  for (const f of [...auditFiles(audit, env), ...autorunFiles(autoruns, env)]) if (demo.SIGNATURES[f]) sigs[f] = demo.SIGNATURES[f];
  const findings = analyzeAudit({
    audit,
    connections: analyzeConnections(network, { sigs, env }),
    autoruns: analyzeAutoruns(autoruns, { sigs, env }),
    extensions,
    privacy: analyzePrivacy(status?.consent),
    sigs,
    env,
    hostsText: demo.HOSTS,
    hostsPath: 'hosts',
    upnp: demo.UPNP,
    localIps: asArray(network?.localIps),
  });
  mapDefender(src.defender);
  diffSnapshots(snapshot({}), snapshot({ consent: status?.consent, connections: network?.tcp, processes: audit?.processes, run: autoruns?.run?.entries }));
  return findings;
}

function* paths(obj, pre = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  for (const k of Object.keys(obj)) {
    if (Array.isArray(obj) && Number(k) > 1) continue;
    yield [...pre, k];
    yield* paths(obj[k], [...pre, k], depth + 1);
  }
}

const MUTATIONS = {
  delete: (parent, k) => { if (Array.isArray(parent)) parent.splice(k, 1); else delete parent[k]; },
  null: (parent, k) => { parent[k] = null; },
  zero: (parent, k) => { parent[k] = 0; },
  object: (parent, k) => { if (typeof parent[k] === 'string') parent[k] = { a: 1 }; else throw new Error('skip'); },
  single: (parent, k) => { if (Array.isArray(parent[k]) && parent[k].length) [parent[k]] = parent[k]; else throw new Error('skip'); },
  ps51: (parent, k) => { if (Array.isArray(parent[k])) parent[k] = { value: parent[k], Count: parent[k].length }; else throw new Error('skip'); },
  failed: (parent, k) => { if (parent[k] && typeof parent[k] === 'object' && !Array.isArray(parent[k])) parent[k] = { error: 'Access denied' }; else throw new Error('skip'); },
};

test('Hack Check analyzers survive malformed Windows data', () => {
  const base = { audit: demo.audit(), autoruns: demo.autoruns(), network: demo.network(), status: demo.status(), extensions: clone(demo.EXTENSIONS), defender: demo.defender() };
  const failures = [];
  let runs = 0;
  for (const p of paths(base)) {
    for (const [name, mutate] of Object.entries(MUTATIONS)) {
      const src = clone(base);
      const parent = p.slice(0, -1).reduce((o, k) => o[k], src);
      try {
        mutate(parent, p[p.length - 1]);
      } catch {
        continue;
      }
      runs++;
      try {
        const findings = analyzeAll(src);
        const isolated = findings.filter((f) => f.id.startsWith('audit:error:'));
        if (isolated.length) failures.push(`${name}:${p.join('.')} → isolated ${isolated[0].evidence.join(' ')}`);
      } catch (err) {
        failures.push(`${name}:${p.join('.')} → ${err.message}`);
      }
    }
  }
  assert.ok(runs > 1000, `only ${runs} variations ran`);
  assert.deepEqual(failures.slice(0, 10), []);
});

test('one failing Hack Check area is reported and the rest still run', () => {
  const audit = demo.audit();
  audit.sharing = {};
  Object.defineProperty(audit.sharing, 'shares', { get() { throw new Error('boom'); } });
  const findings = analyzeAudit({ audit, env, connections: [], autoruns: [], extensions: [], privacy: [] });
  const crash = findings.find((f) => f.id === 'audit:error:sharing');
  assert.ok(crash, 'the failing area becomes a finding');
  assert.equal(crash.severity, 'notice');
  assert.ok(findings.some((f) => f.category === 'protection' && f.id !== 'audit:error:protection'), 'other areas still produce results');
});

test('PowerShell 5.1 wrapped arrays are unwrapped everywhere', () => {
  const raw = { a: { value: [1, 2], Count: 2 }, b: [{ value: [{ key: 'x' }], Count: 1 }], c: { value: 'not an array', Count: 1 }, d: { value: [], Count: 0 } };
  assert.deepEqual(normalizePs(clone(raw)), { a: [1, 2], b: [[{ key: 'x' }]], c: { value: 'not an array', Count: 1 }, d: [] });
  assert.deepEqual(asArray({ value: [3], Count: 1 }), [3]);
});

test('status and the Guard survive malformed data too', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opk-rob-'));
  const svc = new SecurityService({ demo: true, userDataDir: dir, backupDir: dir, trash: async () => {}, getSettings: () => ({}), addHistory: () => {} });
  const base = demo.status();
  for (const p of paths(base)) {
    for (const mutate of Object.values(MUTATIONS)) {
      const src = clone(base);
      const parent = p.slice(0, -1).reduce((o, k) => o[k], src);
      try {
        mutate(parent, p[p.length - 1]);
      } catch {
        continue;
      }
      svc.collect = async () => src;
      const st = await svc.status();
      assert.equal(st.supported, true);
      snapshot(src);
    }
  }
});
