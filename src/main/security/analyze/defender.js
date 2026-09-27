'use strict';

const { THREAT_TYPES } = require('./knowledge');
const { asArray } = require('./common');

const STATUS = {
  0: 'Unknown', 1: 'Active', 2: 'Cleaned', 3: 'Quarantined', 4: 'Removed', 5: 'Allowed', 6: 'Blocked',
  102: 'Quarantine failed', 103: 'Removal failed', 104: 'Allow failed', 105: 'Abandoned', 107: 'Block failed',
};
const ACTIVE = new Set([1, 102, 103, 105, 107]);
const SEVERITY = { 0: 'notice', 1: 'notice', 2: 'warning', 4: 'danger', 5: 'danger' };

/** Plain-English type of a Defender threat name like "Trojan:Win32/Wacatac.B!ml". */
function threatInfo(name) {
  const prefix = String(name || '').split(':')[0];
  for (const [re, type, meaning] of THREAT_TYPES) if (re.test(prefix)) return { type, meaning };
  return { type: 'Malware', meaning: 'Software that can harm your PC or steal data.' };
}

/** "file:_C:\x\y.exe" / "process:_pid:12,ProcessStart:..." → a readable location. */
function resourcePath(resource) {
  const r = String(resource || '');
  const m = /^(file|containerfile|webfile|amsi_script|behavior|regkey|regkeyvalue|process|startup|service|driver)s?:_(.*)$/i.exec(r);
  if (!m) return r;
  let value = m[2];
  if (/^webfile$/i.test(m[1])) value = value.split('|')[0];
  return value;
}

/** Merge Get-MpThreat and Get-MpThreatDetection into readable rows. */
function mapDefender(raw) {
  const threats = new Map(asArray(raw?.threats).map((t) => [String(t.id), t]));
  const rows = asArray(raw?.detections).map((d) => {
    const t = threats.get(String(d.id)) || {};
    const info = threatInfo(t.name);
    const resources = asArray(d.resources).map(resourcePath);
    return {
      id: `defender:${d.detectionId || d.id}`,
      engine: 'Microsoft Defender',
      threatId: String(d.id),
      name: t.name || `Threat ${d.id}`,
      type: info.type,
      meaning: info.meaning,
      severity: SEVERITY[t.severity] || 'warning',
      status: STATUS[d.status] || 'Unknown',
      active: ACTIVE.has(Number(d.status)),
      time: d.time || null,
      path: resources[0] || '',
      resources,
      process: d.process || '',
      executed: !!t.executed,
    };
  });
  rows.sort((a, b) => (b.time || 0) - (a.time || 0));
  return rows;
}

module.exports = { mapDefender, threatInfo, resourcePath, STATUS };
