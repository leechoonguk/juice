/**
 * The Electron main process for Windows and Linux: it reads the Bluetooth
 * batteries, keeps the snapshot and the threshold, notifies when a device runs
 * low, and shows them in a window running the React Native screen and in a tray
 * menu — the counterparts of the macOS window and menu bar item. Closing the
 * window keeps the app in the tray, so the alerts keep coming.
 */
import { join } from 'node:path';

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  Notification,
  powerMonitor,
  Tray,
} from 'electron';

import { isLow, levelLabel } from '../../src/battery';
import type { BatterySnapshot } from '../../src/native/juiceBattery';
import { alertText } from '../../src/snapshot';
import { readBatteries } from './battery';
import { watchBlueZ } from './battery/linux';
import { CHANNELS } from './bridge';
import { createMonitor, type Monitor } from './monitor';
import { loadSettings, saveSettings } from './settings';
import { checkForUpdates, startUpdates, updateInfo, updatesSupported } from './updates';

/** How often the batteries are read while the app runs. */
const READ_INTERVAL_MS = 15 * 60 * 1000;
/** Signals from BlueZ arrive in bursts as a device connects; one read follows the last. */
const SIGNAL_DEBOUNCE_MS = 2000;

const state = {
  window: null as BrowserWindow | null,
  tray: null as Tray | null,
  monitor: null as Monitor | null,
  quitting: false,
  signalTimer: undefined as NodeJS.Timeout | undefined,
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    state.quitting = true;
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.uk.juice');
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    startUpdates();
    refresh();
    setInterval(refresh, READ_INTERVAL_MS);
    powerMonitor.on('resume', refresh);
    if (process.platform === 'linux') {
      watchBlueZ(refreshSoon);
    }
  });
}

ipcMain.handle(CHANNELS.snapshot, () => monitor().snapshot());
ipcMain.handle(CHANNELS.refresh, () => monitor().refresh());
ipcMain.handle(CHANNELS.setThreshold, (_event, value: number) => monitor().setThreshold(value));
ipcMain.handle(CHANNELS.updateInfo, () => updateInfo());
ipcMain.on(CHANNELS.checkForUpdates, () => {
  checkForUpdates(true).catch(() => undefined);
});

/** Built on first use, once the user-data folder is known; the window and the tray share it. */
function monitor(): Monitor {
  state.monitor ??= createMonitor({
    read: readBatteries,
    load: () => loadSettings(settingsFile()),
    save: settings => saveSettings(settingsFile(), settings),
    notify: device => {
      if (Notification.isSupported()) {
        const { title, body } = alertText(device);
        new Notification({ title, body, icon: join(__dirname, 'icon.png') }).show();
      }
    },
    changed: snapshot => {
      if (state.window !== null && !state.window.isDestroyed()) {
        state.window.webContents.send(CHANNELS.snapshotChanged, snapshot);
      }
      updateTray();
    },
    now: Date.now,
  });
  return state.monitor;
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json');
}

function refresh(): void {
  monitor()
    .refresh()
    .catch(() => undefined);
}

/** Refreshes once the signals that asked for it have stopped. */
function refreshSoon(): void {
  clearTimeout(state.signalTimer);
  state.signalTimer = setTimeout(refresh, SIGNAL_DEBOUNCE_MS);
}

function createWindow(): void {
  const window = new BrowserWindow({
    title: 'Juice',
    width: 680,
    height: 520,
    minWidth: 560,
    minHeight: 440,
    icon: join(__dirname, 'icon.png'),
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  window.on('close', event => {
    if (!state.quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  // The window shows one page of ours: nothing opens a second window or takes it elsewhere.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('show', refresh);
  window.once('ready-to-show', () => window.show());
  window.loadFile(join(__dirname, 'index.html'));
  state.window = window;
}

function createTray(): void {
  const tray = new Tray(nativeImage.createFromPath(join(__dirname, 'tray.png')));
  tray.on('click', showWindow);
  tray.on('right-click', refresh);
  state.tray = tray;
  updateTray();
}

function showWindow(): void {
  state.window?.show();
  state.window?.focus();
}

function updateTray(): void {
  const tray = state.tray;
  if (tray === null) {
    return;
  }
  const snapshot = state.monitor?.snapshot() ?? null;
  const lowest = snapshot?.devices.find(device => device.percent !== null);
  tray.setToolTip(lowest === undefined ? 'Juice' : `Juice — ${lowest.name} ${levelLabel(lowest)}`);
  tray.setContextMenu(Menu.buildFromTemplate([...deviceItems(snapshot), ...appItems()]));
}

function deviceItems(snapshot: BatterySnapshot | null): MenuItemConstructorOptions[] {
  if (snapshot === null) {
    return [{ label: 'Reading your devices…', enabled: false }, { type: 'separator' }];
  }
  const rows: MenuItemConstructorOptions[] = snapshot.devices.map(device => {
    const level = device.percent === null ? (device.note ?? 'no level') : levelLabel(device);
    return {
      label: `${device.name} — ${level}${isLow(device, snapshot.threshold) ? ' (low)' : ''}`,
      enabled: false,
    };
  });
  if (rows.length === 0) {
    rows.push({ label: 'No connected devices', enabled: false });
  }
  return [...rows, { type: 'separator' }];
}

function appItems(): MenuItemConstructorOptions[] {
  return [
    { label: 'Refresh', click: refresh },
    { label: 'Show Juice', click: showWindow },
    ...(updatesSupported()
      ? [{ label: 'Check for Updates…', click: () => checkForUpdates(true).catch(() => undefined) }]
      : []),
    { type: 'separator' },
    { label: 'Quit Juice', click: () => app.quit() },
  ];
}
