import type { JuiceBridge } from '../desktop/src/bridge';
import type * as Updates from '../desktop/src/renderer/appUpdates';
import type * as Battery from '../desktop/src/renderer/juiceBattery';
import type { BatterySnapshot } from '../src/native/juiceBattery';

// The window's swapped wrappers against a fake `window.juice`: what the screen
// asks of `juiceBattery` and `appUpdates` reaches the main process, and what the
// main process pushes is what the screen is handed.

const SNAPSHOT: BatterySnapshot = {
  devices: [
    { name: 'Test Headphones', identifier: 'AA:00:00:00:00:01', percent: 45, parts: {}, source: 'Windows', note: null, kind: 'headphones' },
  ],
  threshold: 20,
  updatedAt: 1_000,
};

function fakeBridge(initial: BatterySnapshot | null) {
  const calls: string[] = [];
  const listeners: Array<(snapshot: BatterySnapshot) => void> = [];
  const bridge: JuiceBridge = {
    snapshot: async () => {
      calls.push('snapshot');
      return initial;
    },
    refresh: async () => {
      calls.push('refresh');
      return { ...SNAPSHOT, updatedAt: 2_000 };
    },
    setThreshold: async value => {
      calls.push(`setThreshold ${value}`);
      return { ...SNAPSHOT, threshold: value };
    },
    onSnapshot: listener => {
      listeners.push(listener);
    },
    updateInfo: async () => ({ version: '1.2.3', canCheck: true }),
    checkForUpdates: () => {
      calls.push('checkForUpdates');
    },
  };
  Object.defineProperty(globalThis, 'window', { value: { juice: bridge }, configurable: true, writable: true });
  return { calls, push: (snapshot: BatterySnapshot) => listeners.forEach(listener => listener(snapshot)) };
}

/** A fresh copy of the wrapper, so each test starts before its first call. */
function loadBattery() {
  jest.resetModules();
  return jest.requireActual<typeof Battery>('../desktop/src/renderer/juiceBattery');
}

function loadUpdates() {
  return jest.requireActual<typeof Updates>('../desktop/src/renderer/appUpdates');
}

test('the window loads the main process snapshot, then the ones it pushes', async () => {
  const { calls, push } = fakeBridge(null);
  const battery = loadBattery();

  expect(await battery.loadSnapshot()).toBeNull();
  push(SNAPSHOT);
  expect(await battery.loadSnapshot()).toBe(SNAPSHOT);
  expect(calls).toEqual(['snapshot']);
});

test('a refresh and a threshold change go to the main process and are what the window shows next', async () => {
  const { calls } = fakeBridge(SNAPSHOT);
  const battery = loadBattery();

  expect((await battery.refreshBatteries()).updatedAt).toBe(2_000);
  expect((await battery.loadSnapshot())?.updatedAt).toBe(2_000);
  expect((await battery.setThreshold(35))?.threshold).toBe(35);
  expect((await battery.loadSnapshot())?.threshold).toBe(35);
  expect(calls).toEqual(['refresh', 'setThreshold 35']);
});

test('Input Monitoring is not a question off the Mac, and opening its settings does nothing', async () => {
  fakeBridge(SNAPSHOT);
  const battery = loadBattery();

  expect(await battery.permissions()).toEqual({ inputMonitoring: true });
  expect(battery.openInputMonitoringSettings()).toBeUndefined();
});

test('the swap exports every runtime name the macOS wrapper does', async () => {
  fakeBridge(SNAPSHOT);
  const battery = loadBattery();
  const updates = loadUpdates();

  expect(Object.keys(battery).sort()).toEqual(
    ['loadSnapshot', 'openInputMonitoringSettings', 'permissions', 'refreshBatteries', 'setThreshold'],
  );
  expect(Object.keys(updates).sort()).toEqual(['checkForUpdates', 'updateInfo']);
});

test('update info and checks are the main process updater', async () => {
  const { calls } = fakeBridge(SNAPSHOT);
  const updates = loadUpdates();

  expect(await updates.updateInfo()).toEqual({ version: '1.2.3', canCheck: true });
  updates.checkForUpdates();
  expect(calls).toEqual(['checkForUpdates']);
});
