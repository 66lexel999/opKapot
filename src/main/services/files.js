'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runJob } = require('./jobs');
const { safety } = require('../lib/safety');

/** Folders skipped while scanning: virtual filesystems always, OS folders on request. */
function scanExcludes(excludeSystem, env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const drive = `${env.SystemDrive || 'C:'}\\`;
    const always = [path.join(drive, 'System Volume Information'), path.join(drive, '$Recycle.Bin'), path.join(drive, 'Config.Msi')];
    if (!excludeSystem) return always;
    return [
      ...always,
      env.SystemRoot || 'C:\\Windows',
      path.join(drive, 'Recovery'),
      path.join(env.ProgramFiles || 'C:\\Program Files', 'WindowsApps'),
    ];
  }
  const always = ['/proc', '/sys', '/dev', '/run', '/snap'];
  if (platform === 'darwin') always.push('/System/Volumes', '/private/var/vm', '/Volumes');
  if (!excludeSystem) return always;
  return [...always, '/usr', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/boot', '/etc', '/var/lib', '/System', '/Library', '/private'];
}

function checkRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Choose a folder to scan.');
  if (!fs.existsSync(root)) throw new Error(`Folder not found: ${root}`);
}

function scanFiles(params, { jobId, onProgress, settings }) {
  const roots = [].concat(params.roots || params.root);
  roots.forEach(checkRoot);
  return runJob('files', {
    roots,
    minSize: Number(params.minSize) || 0,
    maxSize: params.maxSize ?? null,
    exts: params.exts || null,
    excludeExts: params.excludeExts || null,
    modifiedBefore: params.modifiedBefore ?? null,
    modifiedAfter: params.modifiedAfter ?? null,
    skipHidden: !!settings.skipHidden,
    exclude: scanExcludes(settings.excludeSystemFolders),
    limit: Math.min(Math.max(Number(settings.maxFileResults) || 100_000, 1000), 500_000),
  }, { jobId, onProgress });
}

function findDuplicates(params, { jobId, onProgress, settings }) {
  const roots = [].concat(params.roots || params.root);
  roots.forEach(checkRoot);
  return runJob('duplicates', {
    roots,
    minSize: Math.max(1, Number(params.minSize) || 1),
    exts: params.exts || null,
    skipHidden: !!settings.skipHidden,
    exclude: scanExcludes(settings.excludeSystemFolders),
  }, { jobId, onProgress });
}

function folderContents(root, { jobId, onProgress }) {
  checkRoot(root);
  return runJob('dirSizes', { root }, { jobId, onProgress });
}

/** Delete files/folders, refusing anything that could damage the system. */
async function deletePaths(paths, { permanent = false, trash }) {
  const deleted = [];
  const failed = [];
  for (const p of paths) {
    if (safety.isProtectedPath(p)) {
      failed.push({ path: p, error: 'Protected system location' });
      continue;
    }
    try {
      if (permanent) await fs.promises.rm(p, { recursive: true, force: false, maxRetries: 2 });
      else await trash(p);
      deleted.push(p);
    } catch (err) {
      failed.push({ path: p, error: err.code === 'EBUSY' || err.code === 'EPERM' ? 'File is in use or access is denied' : err.message });
    }
  }
  return { deleted, failed };
}

module.exports = { scanFiles, findDuplicates, folderContents, deletePaths, scanExcludes };
