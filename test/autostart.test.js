'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Autostart, TASK_NAME } = require('../src/main/services/autostart');

const EXE = 'C:\\Users\\Me\\Documents\\opKapot\\opKapot.exe';

/** An Autostart wired to a fake Task Scheduler. */
function setup({ task = { exists: false }, settings = {}, auto = true, fail = false, platform = 'win32', demo = false } = {}) {
  let current = { guardAutostart: false, autostartDefaulted: false, ...settings };
  const actions = [];
  const autostart = new Autostart({
    demo,
    platform,
    state: {
      getSettings: () => current,
      updateSettings: (patch) => {
        current = { ...current, ...patch };
      },
    },
    runPs: async (name, params) => {
      assert.equal(name, 'autostart');
      assert.equal(params.name, TASK_NAME);
      if (fail) return { task: { error: 'The Task Scheduler service is not running.' } };
      return { task };
    },
    runAction: async (action) => {
      actions.push(action);
      return { ok: true, message: 'Done.' };
    },
    launch: { exe: EXE, args: '--background', auto },
  });
  return { autostart, actions, settings: () => current };
}

test('a new install starts with Windows by default', async () => {
  const { autostart, actions, settings } = setup();
  assert.equal(await autostart.sync(), true);
  assert.deepEqual(actions, [{ type: 'guard-autostart', enable: true, exe: EXE, args: '--background' }]);
  assert.equal(settings().guardAutostart, true);
  assert.equal(settings().autostartDefaulted, true);
});

test('switching it off sticks: the default is only applied once', async () => {
  const { autostart, actions, settings } = setup({ settings: { autostartDefaulted: true, guardAutostart: true } });
  assert.equal(await autostart.sync(), true, 'the task was removed elsewhere, so the setting follows');
  assert.equal(actions.length, 0);
  assert.equal(settings().guardAutostart, false);
});

test('a disabled task counts as off', async () => {
  const { autostart, actions, settings } = setup({ task: { exists: true, enabled: false, exe: EXE, args: '--background' }, settings: { autostartDefaulted: true, guardAutostart: true } });
  await autostart.sync();
  assert.equal(actions.length, 0);
  assert.equal(settings().guardAutostart, false);
});

test('the task follows the exe when the portable app is moved', async () => {
  const { autostart, actions, settings } = setup({ task: { exists: true, enabled: true, exe: 'C:\\Users\\Me\\Downloads\\opKapot.exe', args: '--background' }, settings: { autostartDefaulted: true, guardAutostart: true } });
  assert.equal(await autostart.sync(), false);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].exe, EXE);
  assert.equal(settings().guardAutostart, true);
});

test('nothing changes when the task already starts this exe', async () => {
  const { autostart, actions, settings } = setup({ task: { exists: true, enabled: true, exe: `"${EXE.toUpperCase()}"`, args: '--background' }, settings: { autostartDefaulted: true } });
  assert.equal(await autostart.sync(), true, 'the setting catches up with the task');
  assert.equal(actions.length, 0);
  assert.equal(settings().guardAutostart, true);
});

test('dev builds, demo mode, other systems and Task Scheduler errors leave things alone', async () => {
  const dev = setup({ auto: false });
  await dev.autostart.sync();
  assert.equal(dev.actions.length, 0, 'npm start never turns itself on');
  assert.equal(dev.settings().autostartDefaulted, true);

  for (const opts of [{ demo: true }, { platform: 'linux' }, { fail: true }]) {
    const s = setup(opts);
    assert.equal(await s.autostart.sync(), false);
    assert.equal(s.actions.length, 0);
    assert.equal(s.settings().autostartDefaulted, false);
  }
});

test('turning it on or off updates the setting only when Windows agreed', async () => {
  const { autostart, actions, settings } = setup();
  assert.equal((await autostart.set(true)).ok, true);
  assert.equal(settings().guardAutostart, true);
  await autostart.set(false);
  assert.equal(settings().guardAutostart, false);
  assert.deepEqual(actions.map((a) => a.enable), [true, false]);

  const off = setup({ platform: 'darwin' });
  assert.equal((await off.autostart.set(true)).ok, false);
  assert.equal(off.actions.length, 0);
});
