'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run, powershellJson, psQuote } = require('./exec');
const { normalizeRegistryKey, isProtectedRegistryKey } = require('./safety');

/** Windows registry helpers built on reg.exe and PowerShell. */

async function keyExists(key) {
  const res = await run('reg.exe', ['query', normalizeRegistryKey(key)], { timeout: 15_000 });
  if (res.code === 0) return true;
  if (res.code === 1) return false;
  return null; // unknown (reg.exe failed to run)
}

function backupFileName(key) {
  const safe = normalizeRegistryKey(key).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}_${safe}.reg`;
}

/**
 * Delete a registry key after exporting it to `backupDir`.
 * Refuses keys that hold shared system state.
 */
async function deleteKey(key, backupDir) {
  const k = normalizeRegistryKey(key);
  if (isProtectedRegistryKey(k)) return { ok: false, error: 'Protected registry key' };
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, backupFileName(k));
  const exported = await run('reg.exe', ['export', k, backup, '/y'], { timeout: 30_000 });
  if (exported.code !== 0) {
    const missing = (await keyExists(k)) === false;
    return missing ? { ok: true, missing: true } : { ok: false, error: (exported.stderr || 'Backup failed').trim() };
  }
  const deleted = await run('reg.exe', ['delete', k, '/f'], { timeout: 30_000 });
  if (deleted.code !== 0) return { ok: false, error: (deleted.stderr || 'Delete failed').trim(), backup };
  return { ok: true, backup };
}

/**
 * List subkey names for several registry paths in one PowerShell call.
 * Returns { [path]: string[] }.
 */
async function listSubkeys(keys) {
  if (!keys.length) return {};
  const list = keys.map((k) => psQuote(`Registry::${normalizeRegistryKey(k)
    .replace(/^HKLM/i, 'HKEY_LOCAL_MACHINE')
    .replace(/^HKCU/i, 'HKEY_CURRENT_USER')}`)).join(',');
  const script = `
$out = [ordered]@{}
foreach ($k in @(${list})) {
  $names = @(Get-ChildItem -LiteralPath $k | ForEach-Object { $_.PSChildName })
  $out[$k] = $names
}
ConvertTo-Json -InputObject $out -Depth 3 -Compress`;
  const data = await powershellJson(script, { timeout: 60_000 });
  const result = {};
  keys.forEach((k) => {
    const lookup = `Registry::${normalizeRegistryKey(k).replace(/^HKLM/i, 'HKEY_LOCAL_MACHINE').replace(/^HKCU/i, 'HKEY_CURRENT_USER')}`;
    const names = data?.[lookup];
    result[k] = Array.isArray(names) ? names : names ? [names] : [];
  });
  return result;
}

module.exports = { keyExists, deleteKey, listSubkeys };
