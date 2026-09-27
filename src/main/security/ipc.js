'use strict';

const { safeStorage, shell, app } = require('electron');

/** IPC handlers for the Security section. */
function registerSecurityIpc({ handle, security, state, send, onGuardSettingsChanged }) {
  const jobProgress = (jobId) => (data) => send('job:progress', { jobId, data });
  let scanRows = new Map();

  const vtKey = () => {
    const enc = state.getSettings().virusTotalKeyEnc;
    if (!enc) return '';
    try {
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : Buffer.from(enc, 'base64').toString('utf8');
    } catch {
      return '';
    }
  };

  handle('security:status', () => security.status());
  handle('security:audit', (jobId) => security.audit(jobProgress(jobId)));
  handle('security:fix', (token, id) => security.fix(String(token), String(id)));
  handle('security:ignore', (id, on) => security.setIgnored(String(id), !!on));
  handle('security:network', () => security.network());
  handle('security:network-action', (rowId, kind) => security.networkAction(String(rowId), String(kind)));
  handle('security:blocked', () => security.blocked());
  handle('security:unblock', (id) => security.unblock(String(id)));
  handle('security:autoruns', () => security.autoruns());
  handle('security:autorun-action', (id, which) => security.autorunAction(String(id), String(which)));
  handle('security:extensions', () => security.extensions());
  handle('security:privacy', () => security.privacy());
  handle('security:engines', () => security.engines());
  handle('security:alerts-clear', () => security.clearAlerts());

  handle('security:scan', async (jobId, options = {}) => {
    const type = ['quick', 'full', 'custom'].includes(options.type) ? options.type : 'quick';
    if (type === 'custom' && (typeof options.path !== 'string' || !options.path)) throw new Error('Choose a folder to scan.');
    const result = await security.scan({ jobId, type, path: options.path }, jobProgress(jobId));
    scanRows = new Map(result.rows.map((r) => [r.id, r]));
    return result;
  });
  handle('security:scan-cancel', (jobId) => security.cancelScan(jobId));
  handle('security:defender-history', () => security.defenderHistory());
  handle('security:defender-action', (kind) => {
    const types = { update: 'defender-update', remove: 'defender-remove', offline: 'defender-offline' };
    if (!types[kind]) throw new Error('Unknown action.');
    return security.runAction({ type: types[kind] });
  });

  // Quarantine only accepts files that came out of our own scan results.
  handle('security:quarantine', async (rowId, options = {}) => {
    const row = scanRows.get(String(rowId));
    if (!row || !row.path) throw new Error('That result is out of date. Scan again.');
    if (/defender/i.test(row.engine)) throw new Error('Microsoft Defender handles its own detections. Use "Remove threats".');
    return security.quarantineFile(row.path, { threat: row.name, sha256: row.sha256, engine: row.engine, size: row.size }, { killFirst: !!options.killFirst });
  });
  handle('security:ignore-file', (rowId, on) => {
    const row = scanRows.get(String(rowId));
    if (!row) throw new Error('That result is out of date. Scan again.');
    security.setIgnoredFile(row.sha256 || row.path, !!on);
  });
  handle('security:quarantine-list', () => security.quarantineList());
  handle('security:quarantine-restore', (id) => security.quarantineRestore(String(id)));
  handle('security:quarantine-delete', (id) => security.quarantineDelete(String(id)));

  handle('security:virustotal', (sha256) => security.virusTotal(String(sha256), vtKey()));
  handle('security:vt-status', () => ({ hasKey: !!state.getSettings().virusTotalKeyEnc }));
  handle('security:set-vt-key', (key) => {
    const clean = String(key || '').trim();
    if (clean && !/^[a-f0-9]{64}$/i.test(clean)) throw new Error('That doesn\'t look like a VirusTotal API key (64 letters and numbers).');
    const enc = !clean ? '' : safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(clean).toString('base64')
      : Buffer.from(clean, 'utf8').toString('base64');
    state.updateSettings({ virusTotalKeyEnc: enc });
    return { hasKey: !!clean };
  });

  handle('security:open-uri', (uri) => {
    if (typeof uri === 'string' && /^(ms-settings:[a-z-]+|windowsdefender:\/\/[a-z]+)$/i.test(uri)) return shell.openExternal(uri);
    return null;
  });

  handle('security:guard-autostart', async (enable) => {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
    const result = await security.runAction({ type: 'guard-autostart', enable: !!enable, exe });
    if (result.ok) state.updateSettings({ guardAutostart: !!enable });
    onGuardSettingsChanged();
    return result;
  });
}

module.exports = { registerSecurityIpc };
