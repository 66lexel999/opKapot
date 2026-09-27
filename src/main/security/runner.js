'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../lib/exec');

const SCRIPT_DIR = path.join(__dirname, 'ps');
// Tests point this at PowerShell 7 to exercise the real scripts off Windows.
const POWERSHELL = process.env.OPKAPOT_POWERSHELL || 'powershell.exe';
const cache = new Map();

const PRELUDE = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
].join('; ');

// The script travels over stdin rather than a temp file, so nothing else on
// the PC can swap it before it runs with administrator rights.
const BOOTSTRAP = Buffer.from('$s = [Console]::In.ReadToEnd(); . ([ScriptBlock]::Create($s))', 'utf16le').toString('base64');

function load(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(SCRIPT_DIR, `${name}.ps1`), 'utf8'));
  return cache.get(name);
}

/** Build the full script text for a collector (exported for tests). */
function buildScript(name, params = {}) {
  const payload = Buffer.from(JSON.stringify(params), 'utf8').toString('base64');
  return [
    PRELUDE,
    `$P = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    load('common'),
    load(name),
  ].join('\n');
}

/** Run a script from ps/ and parse the JSON it prints. */
async function runPs(name, params = {}, { timeout = 120_000, signal } = {}) {
  const res = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', BOOTSTRAP], {
    timeout,
    signal,
    input: buildScript(name, params),
  });
  if (res.aborted) throw new Error('Cancelled');
  const text = res.stdout.replace(/^\uFEFF/, '').trim();
  const line = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('[')).pop();
  if (line) {
    try {
      return JSON.parse(line);
    } catch { /* fall through */ }
  }
  const reason = res.timedOut ? 'took too long' : (res.stderr || res.error?.message || 'returned no data').trim().split(/\r?\n/)[0];
  throw new Error(`Windows check "${name}" failed: ${reason}`);
}

module.exports = { runPs, buildScript };
