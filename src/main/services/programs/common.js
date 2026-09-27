'use strict';

const MIN_YEAR = 1995;

/** Parse the many InstallDate formats found in the wild into epoch ms. */
function parseInstallDate(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  let y;
  let m;
  let d;
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (match) [, y, m, d] = match;
  if (!match) {
    match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (match) [, y, m, d] = match;
  }
  if (!match) {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
    if (match) {
      // Prefer month/day/year (the Windows default) unless that is impossible.
      [, m, d, y] = match;
      if (Number(m) > 12) [m, d] = [d, m];
    }
  }
  let time;
  if (match) {
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
    time = date.getTime();
  } else {
    time = Date.parse(s);
  }
  if (!Number.isFinite(time)) return null;
  const year = new Date(time).getFullYear();
  if (year < MIN_YEAR || time > Date.now() + 86_400_000) return null;
  return time;
}

/** Collapse a string to lowercase alphanumerics for fuzzy comparisons. */
function compact(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
}

const PUBLISHER_SUFFIXES = /\b(inc|incorporated|ltd|limited|llc|l\.l\.c|corp|corporation|co|company|gmbh|ag|s\.?a|s\.?r\.?l|b\.?v|plc|pty|oy|ab|as|k\.?k|kk|sas|spa|s\.?p\.?a)\b\.?/gi;

/** "Razer Inc." → "razer", "MSI Co., LTD" → "msi". */
function normalizePublisher(publisher) {
  const cleaned = String(publisher || '')
    .replace(/[®™©]/g, '')
    .replace(/\(r\)|\(tm\)/gi, '')
    .replace(/,/g, ' ')
    .replace(PUBLISHER_SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return cleaned.replace(/[^a-z0-9]+/g, '');
}

/** Strip versions and architecture tags: "7-Zip 23.01 (x64)" → "7-Zip". */
function baseProgramName(name) {
  return String(name || '')
    .replace(/\((?:x64|x86|64-bit|32-bit|64 bit|32 bit|amd64|arm64|remove only|user|machine)\)/gi, ' ')
    .replace(/\b(?:x64|x86|amd64|arm64|64-bit|32-bit)\b/gi, ' ')
    .replace(/\bv?\d+(?:\.\d+)+[a-z]?\b/gi, ' ')
    .replace(/\bversion\b/gi, ' ')
    .replace(/[-–:]\s*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { parseInstallDate, compact, normalizePublisher, baseProgramName, sleep };
