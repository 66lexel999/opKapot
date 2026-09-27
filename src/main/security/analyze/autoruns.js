'use strict';

const {
  P, asArray, commandTarget, commandRedFlags, normalizeWinPath, pathKind, USER_WRITABLE, KIND_LABEL,
  sigState, signerName, describeSig, finding,
} = require('./common');

const SA = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved';

function approvedState(approved, bucket, name) {
  const value = approved?.[bucket]?.[name];
  if (!value) return true;
  try {
    return (Buffer.from(String(value), 'base64')[0] & 1) === 0;
  } catch {
    return true;
  }
}

/** A StartupApproved value marking an entry enabled (2) or disabled (3), like Task Manager does. */
function approvedAction(hive, bucket, name, enable) {
  return {
    type: 'reg-set',
    regKey: `${hive}\\${SA}\\${bucket}`,
    name,
    valueType: 'Binary',
    value: [enable ? 2 : 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

const SOURCE_NOUN = { run: 'startup entry', startup: 'startup shortcut', task: 'scheduled task', service: 'service', driver: 'driver', wmi: 'hidden WMI task' };

const WMI_OK = [{ name: /^BVTConsumer$/i, command: /kerncap\.vbs/i }];

/** Rate an entry: what it runs, where the file lives, whether it's signed. */
function rate(entry, sig, env) {
  const flags = [];
  let risk = 'ok';
  const bump = (level) => {
    const order = { ok: 0, notice: 1, warning: 2, danger: 3 };
    if (order[level] > order[risk]) risk = level;
  };
  const state = sigState(sig);
  const kind = pathKind(entry.file, env);
  entry.signature = state;
  entry.publisher = signerName(sig);
  entry.location = kind;

  for (const f of commandRedFlags(entry.command)) {
    flags.push(`It ${f}.`);
    bump('danger');
  }
  if (entry.remote) {
    flags.push('It runs a script straight from the internet.');
    bump('danger');
  }
  if (state === 'missing' && !entry.remote) {
    flags.push('The file it points to no longer exists.');
    bump('notice');
  }
  if (state === 'bad') {
    flags.push('Its digital signature is invalid (the file may have been modified).');
    bump('danger');
  }
  if (kind === 'temp' || kind === 'recycle') {
    flags.push(`It runs from ${KIND_LABEL[kind]}, where legitimate programs almost never live.`);
    bump(state === 'signed' ? 'warning' : 'danger');
  } else if (state === 'unsigned' && USER_WRITABLE.has(kind)) {
    flags.push(`It's an unsigned program in ${KIND_LABEL[kind]}.`);
    bump('warning');
  } else if (state === 'unsigned' && entry.source === 'driver') {
    flags.push('It is an unsigned driver that runs inside Windows itself.');
    bump('danger');
  } else if (state === 'unsigned') {
    flags.push('It is not digitally signed.');
    bump('notice');
  }
  if (entry.host && entry.payload && USER_WRITABLE.has(kind) && ['wscript.exe', 'cscript.exe', 'rundll32.exe', 'regsvr32.exe', 'mshta.exe'].includes(entry.host)) {
    flags.push(`It uses ${entry.host} to run ${P.basename(entry.payload)}, a trick malware uses to look like a Windows program.`);
    bump('warning');
  }
  if (entry.source === 'task' && entry.elevated && USER_WRITABLE.has(kind)) {
    flags.push('It runs with full administrator/SYSTEM rights from a folder any program can write to.');
    bump('danger');
  }
  if (entry.source === 'task' && entry.hidden && state !== 'signed') {
    flags.push('The task is marked hidden.');
    bump('warning');
  }
  if (entry.source === 'wmi') {
    flags.push('It is a hidden WMI event task: a favourite hiding place for fileless malware.');
    bump('danger');
  }
  entry.flags = flags;
  entry.risk = risk;
  entry.signatureText = describeSig(sig);
  return entry;
}

/** Collect every file whose signature we need, before rating. */
function autorunFiles(raw, env) {
  return buildEntries(raw, env).map((e) => e.file).filter((f) => f && /^[a-z]:\\/i.test(f));
}

function buildEntries(raw, env) {
  const entries = [];
  const run = raw?.run || {};
  for (const e of asArray(run.entries)) {
    const t = commandTarget(e.command, env);
    const bucket = e.kind === 'Run32' ? 'Run32' : 'Run';
    const approvable = e.kind === 'Run' || e.kind === 'Run32';
    entries.push({
      id: `run|${e.key}|${e.name}`,
      source: 'run',
      sourceLabel: e.kind.startsWith('Policy') ? 'Registry (policy Run)' : `Registry (${e.kind.replace('32', '')})`,
      where: e.key.replace(/^HK(LM|CU):\\/, 'HK$1\\'),
      name: e.name,
      command: e.command,
      file: t.file,
      host: t.host,
      payload: t.payload,
      remote: t.remote,
      enabled: approvable ? approvedState(run.approved, `${e.hive}\\${bucket}`, e.name) : true,
      actions: {
        disable: approvable ? approvedAction(e.hive, bucket, e.name, false) : null,
        enable: approvable ? approvedAction(e.hive, bucket, e.name, true) : null,
        remove: { type: 'reg-delete-value', regKey: e.key.replace(/^(HKLM|HKCU):\\/, '$1\\'), name: e.name },
      },
    });
  }

  for (const f of asArray(raw?.startupFolder)) {
    const target = f.target?.target ? normalizeWinPath(f.target.target, env) : f.path;
    const command = f.target?.target ? `"${f.target.target}" ${f.target.args || ''}`.trim() : f.path;
    const t = f.target?.target ? commandTarget(command, env) : { file: f.path, host: null, payload: null, remote: false };
    entries.push({
      id: `startup|${f.path}`,
      source: 'startup',
      sourceLabel: 'Startup folder',
      where: f.folder,
      name: f.name.replace(/\.lnk$/i, ''),
      command,
      file: t.file || target,
      host: t.host,
      payload: t.payload,
      remote: t.remote,
      enabled: approvedState(raw?.run?.approved, `${f.hive}\\StartupFolder`, f.name),
      actions: {
        disable: approvedAction(f.hive, 'StartupFolder', f.name, false),
        enable: approvedAction(f.hive, 'StartupFolder', f.name, true),
        remove: { type: 'trash-file', path: f.path },
      },
    });
  }

  for (const task of asArray(raw?.tasks)) {
    const action = asArray(task.actions).find((a) => a.exe) || asArray(task.actions)[0] || {};
    if (!action.exe) continue;
    const command = `"${action.exe}" ${action.args || ''}`.trim();
    const t = commandTarget(command, env);
    const user = String(task.user || '');
    entries.push({
      id: `task|${task.path}${task.name}`,
      source: 'task',
      sourceLabel: 'Scheduled task',
      where: task.path,
      name: task.name,
      command,
      file: t.file,
      host: t.host,
      payload: t.payload,
      remote: t.remote,
      enabled: task.state !== 'Disabled',
      elevated: task.runLevel === 'Highest' || /^(system|s-1-5-18|nt authority\\system)$/i.test(user),
      hidden: !!task.hidden,
      author: task.author || '',
      actions: {
        disable: { type: 'task-disable', taskPath: task.path, taskName: task.name },
        enable: { type: 'task-enable', taskPath: task.path, taskName: task.name },
        remove: null,
      },
    });
  }

  for (const svc of asArray(raw?.services)) {
    const t = commandTarget(svc.path, env);
    entries.push({
      id: `service|${svc.name}`,
      source: 'service',
      sourceLabel: 'Service',
      where: svc.start,
      name: svc.display || svc.name,
      serviceName: svc.name,
      command: svc.path,
      file: t.file,
      host: t.host,
      payload: t.payload,
      remote: false,
      enabled: svc.start !== 'Disabled',
      running: svc.state === 'Running',
      actions: {
        disable: { type: 'service-disable', service: svc.name },
        enable: { type: 'service-enable', service: svc.name },
        remove: null,
      },
    });
  }

  for (const drv of asArray(raw?.drivers)) {
    const file = normalizeWinPath(drv.path, env);
    entries.push({
      id: `driver|${drv.name}`,
      source: 'driver',
      sourceLabel: 'Driver',
      where: drv.start,
      name: drv.display || drv.name,
      command: drv.path,
      file,
      enabled: drv.start !== 'Disabled',
      running: drv.state === 'Running',
      actions: { disable: null, enable: null, remove: null },
    });
  }

  const wmi = raw?.wmi || {};
  for (const c of asArray(wmi.commandConsumers)) {
    if (WMI_OK.some((w) => w.name.test(c.name) && w.command.test(c.command))) continue;
    const t = commandTarget(c.command || c.exe, env);
    entries.push({
      id: `wmi|${c.name}`,
      source: 'wmi',
      sourceLabel: 'WMI event task',
      where: 'root\\subscription',
      name: c.name,
      command: c.command || c.exe,
      file: t.file,
      host: t.host,
      payload: t.payload,
      remote: t.remote,
      enabled: true,
      actions: { disable: null, enable: null, remove: { type: 'wmi-remove', consumer: c.name, consumerClass: 'CommandLineEventConsumer' } },
    });
  }
  for (const c of asArray(wmi.scriptConsumers)) {
    entries.push({
      id: `wmi|${c.name}`,
      source: 'wmi',
      sourceLabel: 'WMI event script',
      where: 'root\\subscription',
      name: c.name,
      command: (c.text || c.file || '').slice(0, 400),
      file: c.file ? normalizeWinPath(c.file, env) : '',
      enabled: true,
      actions: { disable: null, enable: null, remove: { type: 'wmi-remove', consumer: c.name, consumerClass: 'ActiveScriptEventConsumer' } },
    });
  }
  return entries;
}

function analyzeAutoruns(raw, { sigs = {}, env = {} } = {}) {
  return buildEntries(raw, env).map((e) => rate(e, sigs[e.file], env));
}

/** Hack Check findings for risky startup entries. */
function autorunFindings(entries) {
  const out = [];
  for (const e of entries) {
    if (e.risk !== 'danger' && e.risk !== 'warning') continue;
    if (!e.enabled && e.risk !== 'danger') continue;
    out.push(finding({
      id: `autorun:${e.id}`,
      category: 'startup',
      severity: e.risk,
      title: `Suspicious ${SOURCE_NOUN[e.source] || 'startup item'}: ${e.name}`,
      summary: e.flags[0] || 'This entry starts automatically and looks unusual.',
      evidence: [...e.flags.slice(1), `Runs: ${e.command}`, `File: ${e.file || 'unknown'} (${e.signatureText})`, `Found in: ${e.where}`],
      advice: 'If you don\'t recognise it, disable it here and scan the file. You can turn it back on later.',
      fix: e.actions.disable ? { label: 'Disable', action: e.actions.disable, confirm: `Stop "${e.name}" from starting automatically?` }
        : e.actions.remove ? { label: 'Remove', action: e.actions.remove, confirm: `Remove "${e.name}"? A backup is kept for registry entries.` } : null,
    }));
  }
  const bad = entries.filter((e) => e.risk === 'danger' || e.risk === 'warning').length;
  if (!bad) {
    out.push(finding({
      id: 'autorun:ok',
      category: 'startup',
      severity: 'ok',
      title: 'No suspicious startup programs',
      summary: `Checked ${entries.length} startup items, scheduled tasks, services and drivers.`,
    }));
  }
  return out;
}

module.exports = { analyzeAutoruns, autorunFindings, autorunFiles, buildEntries };
