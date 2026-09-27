import { esc } from './util.js';

export const FILE_TYPES = {
  video: { label: 'Videos', short: 'Video', color: '#8b5cf6', exts: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'vob', 'm2ts'] },
  audio: { label: 'Music & audio', short: 'Audio', color: '#ec4899', exts: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'mid', 'alac'] },
  image: { label: 'Pictures', short: 'Picture', color: '#14b8a6', exts: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic', 'heif', 'raw', 'cr2', 'nef', 'arw', 'dng', 'psd', 'svg', 'ico'] },
  document: { label: 'Documents', short: 'Document', color: '#3b82f6', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'rtf', 'csv', 'md', 'epub', 'pages', 'key', 'numbers'] },
  archive: { label: 'Archives', short: 'Archive', color: '#f59e0b', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst', 'cab', 'lz', 'lzma'] },
  installer: { label: 'Installers & disk images', short: 'Installer', color: '#ef4444', exts: ['exe', 'msi', 'msix', 'msixbundle', 'appx', 'iso', 'img', 'dmg', 'vhd', 'vhdx', 'vmdk', 'vdi', 'deb', 'rpm', 'appimage', 'apk', 'pkg'] },
  code: { label: 'Developer files', short: 'Dev file', color: '#64748b', exts: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'json', 'xml', 'html', 'css', 'sql', 'db', 'sqlite', 'log', 'dll', 'so', 'jar', 'pdb'] },
};

const EXT_TO_TYPE = new Map();
for (const [type, def] of Object.entries(FILE_TYPES)) for (const ext of def.exts) EXT_TO_TYPE.set(ext, type);

export function typeOf(ext) {
  return EXT_TO_TYPE.get(String(ext || '').toLowerCase()) || 'other';
}

export function typeLabel(ext) {
  const type = typeOf(ext);
  if (type === 'other') return ext ? `${ext.toUpperCase()} file` : 'File';
  return FILE_TYPES[type].short;
}

/** Filter parameters for the scan worker from a type-select value. */
export function typeFilter(value) {
  if (!value || value === 'any') return {};
  if (value === 'other') return { excludeExts: [...EXT_TO_TYPE.keys()] };
  return { exts: FILE_TYPES[value]?.exts || [] };
}

export function typeOptions(selected = 'any') {
  const opts = [['any', 'All file types'], ...Object.entries(FILE_TYPES).map(([k, v]) => [k, v.label]), ['other', 'Other files']];
  return opts.map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

export function fileBadge(ext, size = 32) {
  const type = typeOf(ext);
  const color = type === 'other' ? '#4b5563' : FILE_TYPES[type].color;
  const label = (ext || 'file').slice(0, 4);
  return `<span class="ftype" style="background:${color};width:${size}px;height:${size}px">${esc(label)}</span>`;
}
