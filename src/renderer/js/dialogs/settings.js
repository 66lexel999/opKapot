import { esc, h } from '../util.js';
import { openModal } from '../components/overlay.js';
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

export function openSettings() {
  const win = appState.isWindows || appState.info.demo;
  const body = h(`<div class="settings">
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
  body.addEventListener('change', (e) => {
    const el = e.target.closest('[data-key]');
    if (!el) return;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else value = el.dataset.type === 'number' ? Number(el.value) : el.value;
    appState.updateSettings({ [el.dataset.key]: value });
  });
  openModal({
    title: 'Settings',
    width: 620,
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
      <p>Batch-uninstall programs and Windows apps, wipe leftovers, find large and duplicate files, and clean junk — all in one place.</p>
      <p class="muted small">Registry keys are backed up before deletion to:<br><span class="selectable">${esc(paths.userData)}</span></p></div>
    </div>`,
    buttons: [{ label: 'Close', kind: 'primary', onClick: (m) => m.close() }],
  });
}
