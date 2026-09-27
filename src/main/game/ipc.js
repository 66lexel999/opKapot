'use strict';

/** IPC handlers for Game Booster: Ping & Speed and Game Mode. */
function registerGameIpc({ handle, game, send }) {
  const jobProgress = (jobId) => (data) => send('job:progress', { jobId, data });
  const running = new Map();

  handle('game:status', () => game.status());
  handle('game:games', () => game.games());
  handle('game:running', () => game.running());
  handle('game:select', (profile) => game.select(profile && typeof profile === 'object' ? profile : {}));
  handle('game:options', (patch) => game.setOptions(patch && typeof patch === 'object' ? patch : {}));
  handle('game:plan', () => game.plan());
  handle('game:enable', (choice = {}) => game.enable({
    apps: Array.isArray(choice.apps) ? choice.apps.map(String) : [],
    services: Array.isArray(choice.services) ? choice.services.map(String) : [],
  }));
  handle('game:disable', () => game.disable());
  handle('game:demo-run', (on) => {
    if (game.demo) game.demoGameRunning = !!on;
  });

  handle('net:test', async (jobId, options = {}) => {
    const controller = new AbortController();
    running.set(jobId, controller);
    try {
      return await game.netTest(jobProgress(jobId), { speed: options.speed !== false, signal: controller.signal });
    } finally {
      running.delete(jobId);
    }
  });
  handle('net:cancel', (jobId) => running.get(jobId)?.abort());
  handle('net:last', () => game.lastTest());
  handle('net:action', (kind) => game.netAction(String(kind)));
}

module.exports = { registerGameIpc };
