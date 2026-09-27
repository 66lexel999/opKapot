'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');

// Workers cannot be loaded from inside an asar archive; electron-builder
// unpacks src/main/workers (see "asarUnpack" in package.json).
const WORKER_PATH = path
  .join(__dirname, '..', 'workers', 'scan-worker.js')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const running = new Map();
let counter = 0;

/**
 * Run a scan-worker task. Resolves with the task result; progress updates are
 * passed to `onProgress`. `cancelJob(jobId)` stops the task early, and it then
 * resolves with whatever it collected so far (`stopped: true`).
 */
function runJob(task, params, { jobId, onProgress } = {}) {
  const id = jobId || `job-${++counter}`;
  const stop = new SharedArrayBuffer(4);
  running.set(id, new Int32Array(stop));

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      running.delete(id);
      fn(value);
    };
    const worker = new Worker(WORKER_PATH, { workerData: { task, params, stop } });
    worker.on('message', (msg) => {
      if (msg.type === 'progress') onProgress?.(msg.data);
      else if (msg.type === 'done') settle(resolve, msg.result);
      else if (msg.type === 'error') settle(reject, new Error(msg.message));
    });
    worker.on('error', (err) => settle(reject, err));
    worker.on('exit', (code) => settle(reject, new Error(`Scan stopped unexpectedly (exit code ${code})`)));
  });
}

function cancelJob(id) {
  const flag = running.get(id);
  if (!flag) return false;
  Atomics.store(flag, 0, 1);
  return true;
}

function cancelAll() {
  for (const id of running.keys()) cancelJob(id);
}

module.exports = { runJob, cancelJob, cancelAll };
