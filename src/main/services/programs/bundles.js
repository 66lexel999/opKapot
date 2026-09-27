'use strict';

const { normalizePublisher } = require('./common');

const MINUTE = 60_000;
const DAY = 86_400_000;

// Publishers that ship dozens of unrelated components; grouping by them is noise.
const GENERIC_PUBLISHERS = new Set(['', 'microsoft', 'microsoftcorporation', 'windows', 'unknown']);

function locationKey(p) {
  return String(p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

function isInside(child, parent) {
  return !!child && !!parent && child.startsWith(`${parent}/`);
}

/**
 * Detect "bundleware": programs that were installed together with another
 * program. Returns [{ id, main, members: [ids of bundled programs] }].
 *
 * Two programs are linked when they:
 *  - share a (non-generic) publisher and were installed within `sameVendorWindowMs`, or
 *  - one is installed inside the other's folder, or
 *  - their install folders were created within `sameTimeWindowMs` of each other.
 */
function groupBundles(programs, {
  sameVendorWindowMs = 2 * DAY,
  sameTimeWindowMs = 3 * MINUTE,
  maxGroupSize = 10,
} = {}) {
  const items = programs
    .filter((p) => !p.systemComponent && (p.installTime || p.installDate))
    .map((p) => ({
      program: p,
      time: p.installTime || p.installDate,
      precise: !!p.installTimePrecise,
      publisher: normalizePublisher(p.publisher),
      location: locationKey(p.installLocation),
    }));

  const parent = items.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const dt = Math.abs(a.time - b.time);
      const vendorOk = !GENERIC_PUBLISHERS.has(a.publisher) && !GENERIC_PUBLISHERS.has(b.publisher);
      const sameVendor = a.publisher === b.publisher && !GENERIC_PUBLISHERS.has(a.publisher) && dt <= sameVendorWindowMs;
      const nested = isInside(a.location, b.location) || isInside(b.location, a.location);
      const sameMoment = a.precise && b.precise && vendorOk && dt <= sameTimeWindowMs;
      if (sameVendor || nested || sameMoment) union(i, j);
    }
  }

  const components = new Map();
  items.forEach((item, i) => {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(item);
  });

  const groups = [];
  for (const members of components.values()) {
    if (members.length < 2 || members.length > maxGroupSize) continue;
    members.sort((a, b) => (a.time - b.time)
      || ((b.program.size || 0) - (a.program.size || 0))
      || a.program.name.localeCompare(b.program.name));
    const [main, ...bundled] = members;
    groups.push({
      id: main.program.id,
      main: main.program.id,
      members: bundled.map((m) => m.program.id),
    });
  }
  return groups;
}

module.exports = { groupBundles, GENERIC_PUBLISHERS };
