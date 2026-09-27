'use strict';

const { SECURITY_DOMAINS, POPULAR_DOMAINS } = require('./knowledge');
const { classifyIp, finding } = require('./common');

/** Parse a hosts file into { line, ip, hosts } entries (comments dropped). */
function parseHosts(text) {
  const entries = [];
  String(text || '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const [ip, ...hosts] = line.split(/\s+/);
    if (!ip || !hosts.length) return;
    entries.push({ line: index + 1, raw, ip, hosts: hosts.map((h) => h.toLowerCase()) });
  });
  return entries;
}

/** Findings about entries that block security sites or redirect popular sites. */
function hostsFindings(text, hostsPath) {
  const out = [];
  const entries = parseHosts(text);
  const blocked = [];
  const redirected = [];
  let adBlocks = 0;
  for (const e of entries) {
    const kind = classifyIp(e.ip);
    const isBlock = kind === 'loopback' || kind === 'any' || e.ip === '0.0.0.0';
    for (const host of e.hosts) {
      if (host === 'localhost' || host === 'localhost.localdomain' || host.endsWith('.local')) continue;
      if (isBlock) {
        if (SECURITY_DOMAINS.test(host)) blocked.push({ ...e, host });
        else adBlocks++;
      } else if (kind !== 'private' && POPULAR_DOMAINS.test(host)) {
        redirected.push({ ...e, host });
      } else if (kind !== 'private') {
        redirected.push({ ...e, host, minor: true });
      }
    }
  }

  if (blocked.length) {
    out.push(finding({
      id: 'hosts:blocked-security',
      category: 'network',
      severity: 'danger',
      title: 'Your hosts file blocks security websites',
      summary: 'Malware does this to stop Windows Update and antivirus programs from updating.',
      evidence: blocked.slice(0, 12).map((b) => `Line ${b.line}: ${b.host} → ${b.ip}`),
      advice: 'Remove these lines so security updates can reach your PC.',
      fix: { label: 'Remove lines', action: { type: 'hosts-remove', path: hostsPath, lines: [...new Set(blocked.map((b) => b.line))] }, confirm: 'Remove these lines from the hosts file? A backup copy is saved first.' },
    }));
  }
  const serious = redirected.filter((r) => !r.minor);
  if (serious.length) {
    out.push(finding({
      id: 'hosts:redirect',
      category: 'network',
      severity: 'danger',
      title: 'Your hosts file sends popular websites to other servers',
      summary: 'This is how some malware shows fake login pages for sites like Google, banks or Steam.',
      evidence: serious.slice(0, 12).map((r) => `Line ${r.line}: ${r.host} → ${r.ip}`),
      advice: 'Remove these lines unless you added them yourself.',
      fix: { label: 'Remove lines', action: { type: 'hosts-remove', path: hostsPath, lines: [...new Set(serious.map((r) => r.line))] }, confirm: 'Remove these lines from the hosts file? A backup copy is saved first.' },
    }));
  }
  const minor = redirected.filter((r) => r.minor);
  if (minor.length) {
    out.push(finding({
      id: 'hosts:custom',
      category: 'network',
      severity: 'notice',
      title: `Your hosts file redirects ${minor.length} website${minor.length > 1 ? 's' : ''}`,
      summary: 'Usually added by developers, game servers or tools. Check that you recognise them.',
      evidence: minor.slice(0, 12).map((r) => `Line ${r.line}: ${r.host} → ${r.ip}`),
    }));
  }
  if (!out.length) {
    out.push(finding({
      id: 'hosts:ok', category: 'network', severity: 'ok',
      title: 'Hosts file is clean',
      summary: adBlocks ? `It only blocks ${adBlocks} ad or tracking address${adBlocks > 1 ? 'es' : ''}.` : 'No website is blocked or redirected.',
    }));
  }
  return out;
}

/** Remove specific line numbers from hosts text. */
function removeHostsLines(text, lines) {
  const drop = new Set(lines.map(Number));
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  return String(text).split(/\r?\n/).filter((_, i) => !drop.has(i + 1)).join(eol);
}

module.exports = { parseHosts, hostsFindings, removeHostsLines };
