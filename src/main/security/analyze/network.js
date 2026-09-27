'use strict';

const { REMOTE_TOOLS, REMOTE_PORTS, P2P_AND_GAMES } = require('./knowledge');
const { asArray, asObjects, str, classifyIp, IP_LABEL, sigState, signerName, pathKind, USER_WRITABLE, finding } = require('./common');

/** Which remote-control product (if any) a process belongs to. */
function matchRemoteTool(proc) {
  const name = str(proc?.name);
  if (!name) return null;
  for (const tool of REMOTE_TOOLS) {
    if (!tool.process.test(name)) continue;
    if (tool.company && !tool.company.test(`${proc.company || ''} ${proc.description || ''} ${proc.path || ''}`)) continue;
    return tool;
  }
  return null;
}

const SYSTEM_NAMES = { 0: 'System Idle Process', 4: 'System' };

/**
 * Turn raw sockets into rows for the Network Monitor, with direction
 * (in / out / listening), where the other side is, and risk flags.
 */
function analyzeConnections(raw, { sigs = {}, env = {} } = {}) {
  const tcp = asObjects(raw?.tcp);
  const udp = asObjects(raw?.udp);
  const procs = raw?.processes && typeof raw.processes === 'object' ? raw.processes : {};
  const listening = new Set(tcp.filter((c) => c.state === 'Listen').map((c) => c.localPort));

  const rows = [];
  for (const c of [...tcp, ...udp]) try {
    const found = procs[String(c.pid)];
    const p = found && typeof found === 'object' ? { ...found, name: str(found.name), path: str(found.path), company: str(found.company) } : {};
    const name = p.name || SYSTEM_NAMES[c.pid] || `Process ${c.pid}`;
    const remoteKind = classifyIp(c.remoteAddress);
    const localKind = classifyIp(c.localAddress);
    let direction = 'out';
    if (c.state === 'Listen') direction = 'listen';
    else if (listening.has(c.localPort) && remoteKind !== 'loopback') direction = 'in';

    const tool = matchRemoteTool(p);
    const sig = p.path ? sigs[p.path] : null;
    const kind = pathKind(p.path, env);
    const flags = [];
    if (tool) flags.push({ kind: 'remote-tool', label: tool.name });
    if (direction === 'in' && remoteKind === 'public') flags.push({ kind: 'inbound-internet', label: 'Connected from the internet' });
    if (c.state === 'Listen' && REMOTE_PORTS.has(c.localPort) && localKind !== 'loopback') flags.push({ kind: 'remote-port', label: `${REMOTE_PORTS.get(c.localPort)} port open` });
    if (c.state === 'Listen' && (localKind === 'any' || localKind === 'public' || localKind === 'private') && c.proto === 'TCP') flags.push({ kind: 'exposed', label: 'Accepts connections from other devices' });
    if (p.path && sigState(sig) === 'unsigned' && USER_WRITABLE.has(kind)) flags.push({ kind: 'unsigned', label: 'Unsigned program' });
    if (kind === 'temp') flags.push({ kind: 'temp', label: 'Runs from a temporary folder' });

    const p2p = P2P_AND_GAMES.test(name);
    let risk = 'ok';
    const has = (k) => flags.some((f) => f.kind === k);
    if (has('inbound-internet') && (tool || REMOTE_PORTS.has(c.localPort) || has('unsigned') || has('temp'))) risk = 'danger';
    else if (has('inbound-internet') && !p2p) risk = 'warning';
    else if ((has('unsigned') || has('temp')) && remoteKind === 'public') risk = 'warning';
    else if (tool && c.state === 'Established') risk = 'warning';
    else if (has('remote-port') || has('inbound-internet') || (tool && direction === 'listen')) risk = 'notice';

    rows.push({
      id: `${c.proto}|${c.localAddress}|${c.localPort}|${c.remoteAddress}|${c.remotePort}|${c.pid}`,
      proto: c.proto,
      state: c.state,
      direction,
      localAddress: c.localAddress,
      localPort: c.localPort,
      remoteAddress: c.remoteAddress,
      remotePort: c.remotePort,
      remoteKind,
      where: direction === 'listen' ? IP_LABEL[localKind === 'any' ? 'any' : localKind] : IP_LABEL[remoteKind],
      pid: c.pid,
      process: name,
      path: p.path || '',
      publisher: signerName(sig) || p.company || '',
      signature: sigState(sig),
      created: c.created || null,
      flags,
      risk,
    });
  } catch { /* skip a malformed connection */ }
  return rows;
}

/** Hack Check findings about who is connected to this PC. */
function networkFindings(rows) {
  const out = [];
  const inbound = rows.filter((r) => r.direction === 'in' && r.remoteKind === 'public');
  const byProcess = new Map();
  for (const r of inbound) {
    if (!byProcess.has(r.process)) byProcess.set(r.process, []);
    byProcess.get(r.process).push(r);
  }
  for (const [proc, list] of byProcess) {
    const worst = list.some((r) => r.risk === 'danger') ? 'danger' : list.some((r) => r.risk === 'warning') ? 'warning' : 'notice';
    const ips = [...new Set(list.map((r) => r.remoteAddress))];
    out.push(finding({
      id: `net-inbound:${String(proc).toLowerCase()}`,
      category: 'remote',
      severity: worst,
      title: `Devices on the internet are connected to ${proc}`,
      summary: worst === 'notice'
        ? `${proc} accepts connections from the internet. That's normal for games, torrents and file sync.`
        : `${proc} has ${list.length === 1 ? 'a connection' : `${list.length} connections`} that came in from the internet, not ones your PC started.`,
      evidence: [
        ...ips.slice(0, 8).map((ip) => `From ${ip} to port ${list.find((r) => r.remoteAddress === ip).localPort}`),
        list[0].path ? `Program: ${list[0].path}` : '',
      ].filter(Boolean),
      advice: 'If you don\'t know why this program should accept connections, close it and block it in the firewall.',
      fix: list[0].path ? { label: 'Block program', action: { type: 'block-program', path: list[0].path }, confirm: `Block ${proc} from using the internet?` } : null,
    }));
  }

  const ports = rows.filter((r) => r.flags.some((f) => f.kind === 'remote-port'));
  const seen = new Set();
  for (const r of ports) {
    const key = `${r.localPort}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = r.flags.find((f) => f.kind === 'remote-port').label.replace(' port open', '');
    out.push(finding({
      id: `net-port:${r.localPort}`,
      category: 'network',
      severity: r.localPort === 23 ? 'danger' : 'warning',
      title: `${label} is listening for connections (port ${r.localPort})`,
      summary: `${r.process} is waiting for remote-control connections from other devices.`,
      evidence: [`Listening on ${r.localAddress}:${r.localPort}`, r.path ? `Program: ${r.path}` : ''].filter(Boolean),
      advice: 'Turn this off unless you use it to reach this PC from elsewhere.',
    }));
  }
  return out;
}

module.exports = { analyzeConnections, networkFindings, matchRemoteTool };
