import { api, esc, h, relativeTime, formatDateTime, errorMessage } from '../../util.js';
import { icon } from '../../icons.js';
import { DataTable } from '../../components/table.js';
import { securityStore } from '../../securityStore.js';
import { viewHeader, emptyHtml, loadingHtml, opButtons } from '../common.js';
import { appIcon, notSupportedHtml } from './shared.js';

const DEVICE_ICON = { webcam: 'camera', microphone: 'mic', location: 'mapPin' };
const SETTINGS_URI = { webcam: 'ms-settings:privacy-webcam', microphone: 'ms-settings:privacy-microphone', location: 'ms-settings:privacy-location' };

function span(ms) {
  if (ms == null) return '—';
  const m = Math.round(ms / 60_000);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  const hrs = Math.floor(m / 60);
  return `${hrs} h ${m % 60} min`;
}

/** Which apps used the camera, microphone and location, and when. */
export class PrivacyView {
  mount() {
    if (this.el) return this.el;
    this.el = h(`<div class="view">
      ${viewHeader({
        title: 'Which apps used your camera and mic?',
        info: 'Windows keeps a record of every app that turned on your camera, microphone or location. An app you don\'t recognise here could be spying on you.',
        actions: `<button class="btn" data-open="webcam">${icon('camera', { size: 16 })}Camera settings</button><button class="btn" data-open="microphone">${icon('mic', { size: 16 })}Microphone settings</button>`,
      })}
      <div class="live-banner" hidden></div>
      <div class="panel"></div>
    </div>`);
    this.banner = this.el.querySelector('.live-banner');
    this.table = new DataTable({
      rowHeight: 58,
      selectable: false,
      emptyHtml: loadingHtml('Reading camera and microphone history…'),
      columns: [
        { key: 'name', label: (t) => `App (${t.rows.length})`, render: (r) => `<div class="cell-name">${appIcon(r.path, r.name, 28)}<div class="name-text"><div class="name-title trunc">${esc(r.name)}</div><div class="name-sub trunc" title="${esc(r.path || r.packageName)}">${esc(r.path || r.packageName || 'Store app')}</div></div></div>` },
        { key: 'device', label: 'Used', width: '150px', render: (r) => `<span class="dev">${icon(DEVICE_ICON[r.cap] || 'eye', { size: 16 })}${esc(r.device)}</span>` },
        { key: 'lastStart', label: 'Last used', width: '190px', render: (r) => `<span class="trunc" title="${esc(formatDateTime(r.lastStart))}">${r.inUse ? '<b class="txt-danger">Right now</b>' : esc(relativeTime(r.lastStart))}</span>` },
        { key: 'duration', label: 'For', width: '130px', render: (r) => `<span class="trunc">${esc(span(r.duration))}</span>` },
        { key: 'op', label: 'Action', width: '110px', align: 'center', render: (r) => opButtons([...(r.path ? [['reveal', 'reveal', 'Show file']] : []), ['settings', 'settings', 'Privacy settings']]) },
      ],
      onAction: (a, r) => {
        if (a === 'reveal') api.files.reveal(r.path);
        else api.security.openUri(SETTINGS_URI[r.cap]);
      },
    });
    this.el.querySelector('.panel').append(this.table.el);
    this.el.querySelector('.view-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]');
      if (b) api.security.openUri(SETTINGS_URI[b.dataset.open]);
    });
    securityStore.on('icons', () => this.visible && this.table.refresh());
    return this.el;
  }

  onShow() {
    this.visible = true;
    this.load();
  }

  onHide() {
    this.visible = false;
  }

  refresh() {
    this.load();
  }

  async load() {
    try {
      const st = securityStore.status || (await api.security.status());
      if (!st.supported) {
        this.table.setEmpty(notSupportedHtml());
        this.table.setRows([]);
        return;
      }
      const rows = await api.security.privacy();
      securityStore.loadIcons(rows.map((r) => r.path));
      const live = rows.filter((r) => r.inUse && r.cap !== 'location');
      this.banner.hidden = !live.length;
      this.banner.innerHTML = live.length ? `${icon('eye', { size: 20 })}<span><b>${esc(live.map((r) => `${r.name} (${r.device.toLowerCase()})`).join(', '))}</b> ${live.length > 1 ? 'are' : 'is'} in use right now. If you're not on a call or recording, close ${live.length > 1 ? 'them' : 'it'} and run Hack Check.</span>` : '';
      this.table.setEmpty(emptyHtml('No app has used your camera or microphone yet.', '', 'camera'));
      this.table.setRows(rows);
    } catch (err) {
      this.table.setEmpty(emptyHtml('Could not read the privacy history.', errorMessage(err), 'alert'));
    }
  }
}
