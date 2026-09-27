import { api, esc, h, errorMessage } from '../util.js';
import { openModal, toast } from '../components/overlay.js';
import { appState } from '../store.js';

function toggle(key, label, hint = '') {
  return `<label class="setting"><div><div>${esc(label)}</div>${hint ? `<div class="muted small">${esc(hint)}</div>` : ''}</div>
    <input type="checkbox" class="switch" data-key="${key}" ${appState.settings[key] ? 'checked' : ''}></label>`;
}

function select(key, label, options, hint = '') {
  const current = String(appState.settings[key]);
  return `<label class="setting"><div><div>${esc(label)}</div>${hint ? `<div class="muted small">${esc(hint)}</div>` : ''}</div>
    <select class="select" data-key="${key}" data-type="${typeof appState.settings[key]}">${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === current ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}

function vtRow() {
  const has = appState.settings.hasVirusTotalKey;
  return `<div class="setting vt-setting"><div><div>VirusTotal API key</div>
      <div class="muted small">Optional. Lets you check a suspicious file against 70+ antivirus engines. Only the file's fingerprint (SHA-256) is sent, never the file. <a class="link-btn" data-vt-join>Get a free key</a></div></div>
    <div class="vt-controls">${has
    ? '<span class="pill green">Key saved</span><button class="btn btn-sm" data-vt-remove>Remove</button>'
    : '<input type="password" class="text-input" data-vt-key placeholder="Paste your key" spellcheck="false" autocomplete="off"><button class="btn btn-sm" data-vt-save>Save</button>'}</div></div>`;
}

function securitySettings() {
  return `<div class="settings-section">Security</div>
    ${toggle('guardEnabled', 'Real-time Guard', 'Watches for new incoming connections, startup programs, remote-control tools and camera or microphone use, and alerts you.')}
    ${select('guardIntervalSec', 'Check every', [[15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [120, '2 minutes']], 'Shorter catches things sooner but uses a little more CPU.')}
    ${toggle('closeToTray', 'Keep protecting when the window is closed', 'opKapot stays in the notification area while the Guard is on. Quit it from the tray icon.')}
    <label class="setting"><div><div>Start protection when Windows starts</div><div class="muted small">Starts opKapot quietly in the tray when you sign in.</div></div>
      <input type="checkbox" class="switch" data-autostart ${appState.settings.guardAutostart ? 'checked' : ''}></label>
    ${vtRow()}`;
}

export function openSettings() {
  const win = appState.isWindows || appState.info.demo;
  const body = h(`<div class="settings">
    ${win ? securitySettings() : ''}
    <div class="settings-section">Uninstalling</div>
    ${win ? toggle('restorePoint', 'Create a restore point before uninstalling', 'Lets you roll Windows back if something goes wrong.') : ''}
    ${toggle('scanLeftovers', 'Scan for leftovers after uninstalling', 'Finds folders, shortcuts and registry entries left behind.')}
    ${toggle('autoRemoveLeftovers', 'Remove recommended leftovers automatically', 'Skips the review step for high-confidence items.')}
    ${toggle('quietUninstall', 'Uninstall silently when possible', 'Uses the program’s silent mode (MSI, Inno Setup, QuietUninstallString).')}
    ${toggle('showSystemComponents', 'Show system components', 'Include runtimes and components that are normally hidden.')}
    <div class="settings-section">Deleting files</div>
    ${select('deleteMode', 'When deleting files and leftovers', [['trash', appState.isWindows ? 'Move to the Recycle Bin' : 'Move to the Trash'], ['permanent', 'Delete permanently']])}
    <div class="settings-section">Scanning</div>
    ${toggle('excludeSystemFolders', 'Skip Windows and system folders', 'Recommended. Avoids listing files the OS needs.')}
    ${toggle('skipHidden', 'Skip hidden dot-files and folders')}
    ${select('largeFileThresholdMB', 'Large file size', [[50, '50 MB'], [100, '100 MB'], [250, '250 MB'], [500, '500 MB'], [1024, '1 GB']])}
    ${select('maxFileResults', 'Maximum results per scan', [[50000, '50,000'], [100000, '100,000'], [250000, '250,000'], [500000, '500,000']])}
    <div class="settings-section">Junk cleaner</div>
    ${select('tempMinAgeHours', 'Keep temporary files newer than', [[0, 'Clean everything'], [1, '1 hour'], [6, '6 hours'], [24, '24 hours'], [72, '3 days'], [168, '1 week']], 'Files still in use are always skipped.')}
  </div>`);
  body.addEventListener('change', async (e) => {
    if (e.target.matches('[data-autostart]')) {
      const want = e.target.checked;
      e.target.disabled = true;
      try {
        const res = await api.security.guardAutostart(want);
        if (res?.ok === false) throw new Error(res.message || 'Windows refused the change.');
        appState.settings = { ...appState.settings, guardAutostart: want };
      } catch (err) {
        e.target.checked = !want;
        toast(esc(errorMessage(err)), 'error', 7000);
      } finally {
        e.target.disabled = false;
      }
      return;
    }
    const el = e.target.closest('[data-key]');
    if (!el) return;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else value = el.dataset.type === 'number' ? Number(el.value) : el.value;
    appState.updateSettings({ [el.dataset.key]: value });
  });
  body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-vt-join]')) {
      api.app.openExternal('https://www.virustotal.com/gui/join-us');
      return;
    }
    const save = e.target.closest('[data-vt-save], [data-vt-remove]');
    if (!save) return;
    const key = save.matches('[data-vt-save]') ? body.querySelector('[data-vt-key]').value : '';
    if (save.matches('[data-vt-save]') && !key.trim()) return;
    try {
      const { hasKey } = await api.security.setVirusTotalKey(key);
      appState.settings = { ...appState.settings, hasVirusTotalKey: hasKey };
      body.querySelector('.vt-setting').replaceWith(h(vtRow()));
      toast(hasKey ? 'VirusTotal key saved (encrypted with your Windows account).' : 'VirusTotal key removed.', 'success');
    } catch (err) {
      toast(esc(errorMessage(err)), 'error', 7000);
    }
  });
  openModal({
    title: 'Settings',
    width: 640,
    body,
    buttons: [{ label: 'Done', kind: 'primary', onClick: (m) => m.close() }],
  });
}

export function openAbout() {
  const { name, version, paths } = appState.info;
  openModal({
    title: `About ${name}`,
    width: 520,
    body: `<div class="about">
      <img src="assets/icon.png" width="64" height="64" alt="">
      <div><div class="details-name">${esc(name)} ${esc(version)}</div>
      <p>Batch-uninstall programs and Windows apps, wipe leftovers, find large and duplicate files and clean junk. Scan for viruses with Microsoft Defender's engine plus opKapot's own checks, and find out if anyone is spying on or accessing your PC.</p>
      <p class="muted small">Registry keys are backed up before they are changed or deleted. Backups, quarantine and settings live in:<br><span class="selectable">${esc(paths.userData)}</span></p></div>
    </div>`,
    buttons: [{ label: 'Close', kind: 'primary', onClick: (m) => m.close() }],
  });
}
