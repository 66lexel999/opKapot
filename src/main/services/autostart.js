'use strict';

// opKapot starts at sign-in through a scheduled task rather than the Run key:
// it needs administrator rights, and Windows silently skips elevated programs
// listed under Run. The name is kept from 1.x so existing tasks are reused.
const TASK_NAME = 'opKapot Guard';

const samePath = (a, b) => String(a || '').trim().replace(/^"|"$/g, '').toLowerCase() === String(b || '').trim().replace(/^"|"$/g, '').toLowerCase();

/**
 * Starts opKapot when Windows starts. A new install turns this on once by
 * itself; after that the scheduled task decides, so switching it off anywhere
 * (Settings, Startup Manager, the tray, Task Scheduler) sticks.
 *
 * launch: { exe, args, auto } where auto=false (a dev build) never turns itself on.
 */
class Autostart {
  constructor({ demo = false, platform = process.platform, state, runPs, runAction, launch }) {
    this.demo = !!demo;
    this.platform = platform;
    this.state = state;
    this.runPs = runPs;
    this.runAction = runAction;
    this.launch = launch;
  }

  get supported() {
    return this.demo || this.platform === 'win32';
  }

  /** The task as Windows has it: { exists, enabled, exe, args }. */
  async query() {
    const res = await this.runPs('autostart', { name: TASK_NAME }, { timeout: 60_000 });
    const task = res?.task;
    if (!task || typeof task !== 'object') throw new Error('Task Scheduler did not answer.');
    if (typeof task.error === 'string') throw new Error(task.error);
    return { exists: !!task.exists, enabled: task.enabled !== false, exe: String(task.exe || ''), args: String(task.args || '') };
  }

  async set(enable) {
    if (!this.supported) return { ok: false, message: 'Starting with the computer is only available on Windows.' };
    const result = await this.runAction({ type: 'guard-autostart', enable: !!enable, exe: this.launch.exe, args: this.launch.args });
    if (result.ok) this.state.updateSettings({ guardAutostart: !!enable });
    return result;
  }

  /**
   * Run at launch: turn on by default once, follow the exe if it was moved,
   * and mirror the real task into settings. Returns true when settings changed.
   */
  async sync() {
    if (this.demo || this.platform !== 'win32') return false;
    let task;
    try {
      task = await this.query();
    } catch {
      return false;
    }
    const before = !!this.state.getSettings().guardAutostart;
    if (!this.state.getSettings().autostartDefaulted) {
      this.state.updateSettings({ autostartDefaulted: true });
      if (!task.exists && this.launch.auto) {
        await this.set(true);
        return before !== !!this.state.getSettings().guardAutostart;
      }
    }
    const on = task.exists && task.enabled;
    if (on && (!samePath(task.exe, this.launch.exe) || task.args.trim() !== this.launch.args)) {
      // The portable exe was moved or another copy is in use: point the task here.
      await this.set(true);
    } else if (on !== before) {
      this.state.updateSettings({ guardAutostart: on });
    }
    return before !== !!this.state.getSettings().guardAutostart;
  }
}

module.exports = { Autostart, TASK_NAME };
