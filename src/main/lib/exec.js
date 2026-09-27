'use strict';

const { spawn } = require('node:child_process');

/**
 * Run a process and collect its output. Never rejects: failures are reported
 * through `code` (-1 when the process could not start or timed out) and `error`.
 */
function run(file, args = [], options = {}) {
  const { timeout = 60_000, input, signal, ...spawnOptions } = options;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let child;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...result });
    };

    try {
      child = spawn(file, args, { windowsHide: true, ...spawnOptions });
    } catch (error) {
      finish({ code: -1, error });
      return;
    }

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish({ code: -1, error }));
    child.on('close', (code) => finish({ code }));

    if (timeout) {
      timer = setTimeout(() => {
        child.kill();
        finish({ code: -1, timedOut: true, error: new Error('Timed out') });
      }, timeout);
    }
    if (signal) {
      const abort = () => {
        child.kill();
        finish({ code: -1, aborted: true, error: new Error('Cancelled') });
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    if (input != null) child.stdin?.end(input);
  });
}

const PS_PRELUDE = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
].join('; ') + ';\n';

/** Quote a value as a PowerShell single-quoted string literal. */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function powershell(script, { timeout = 120_000 } = {}) {
  const encoded = Buffer.from(PS_PRELUDE + script, 'utf16le').toString('base64');
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout },
  );
}

/** Run a PowerShell script whose output is JSON and parse it (null on failure). */
async function powershellJson(script, options) {
  const result = await powershell(script, options);
  const text = result.stdout.replace(/^\uFEFF/, '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** ConvertTo-Json unwraps single-item arrays; normalise back to an array. */
function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

module.exports = { run, powershell, powershellJson, psQuote, asArray };
