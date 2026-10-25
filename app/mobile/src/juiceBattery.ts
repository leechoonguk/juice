/**
 * `src/native/juiceBattery.ts` for Android. There is no resident service as on
 * macOS: a read happens when the window asks, when the system broadcasts a
 * change while the app runs, and when the widget updates. Each read builds a
 * snapshot with the rules every platform shares (`src/snapshot.ts`), keeps it
 * and the threshold in AsyncStorage, sends the low-battery alerts that are due,
 * and hands the snapshot to whoever listens (the widget, `widget.tsx`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';

import {
  type BluetoothDevice,
  connectedDevices,
  notify,
  onBluetoothChanged,
  PERMISSION_ERROR,
  readLeBattery,
} from '../../src/native/androidBluetooth';
import type { BatterySnapshot, Permissions } from '../../src/native/juiceBattery';
import {
  alertText,
  buildSnapshot,
  clampThreshold,
  DEFAULT_THRESHOLD,
  type DeviceBattery,
  deviceKind,
  dueAlerts,
  normalizeAddress,
  percentage,
  withThreshold,
} from '../../src/snapshot';

export type { BatterySnapshot, DeviceLevel, Permissions } from '../../src/native/juiceBattery';

const THRESHOLD_KEY = 'juice.threshold';
const ALERTED_KEY = 'juice.alerted';
const SNAPSHOT_KEY = 'juice.snapshot';

/** A snapshot this young is shown as it is; the window polls more often than devices change. */
const FRESH_MS = 10_000;

/** Android 12 split Bluetooth permissions; 13 made notifications one. */
const CONNECT_API = 31;
const NOTIFICATIONS_API = 33;

const NO_PERMISSION: DeviceBattery = {
  name: 'Bluetooth',
  identifier: 'bluetooth-permission',
  kind: 'other',
  readings: [],
  notes: ['Allow Juice to use Bluetooth in Android Settings to see your devices.'],
};

/** Android's `BluetoothClass.Device` codes, as the words `deviceKind` knows. */
const CLASS_LABELS = new Map<number, string>([
  [0x0404, 'headset'],
  [0x0408, 'headset'],
  [0x0414, 'speaker'],
  [0x0418, 'headphones'],
  [0x041c, 'speaker'],
  [0x0540, 'keyboard'],
  [0x05c0, 'keyboard'],
  [0x0580, 'mouse'],
]);
const PHONE_MAJOR_CLASS = 2;

const listeners = new Set<(snapshot: BatterySnapshot) => void>();
let listening = false;
let queue: Promise<unknown> = Promise.resolve();

/** The last snapshot a read kept, or null before the first one. */
export async function lastSnapshot(): Promise<BatterySnapshot | null> {
  const stored = await AsyncStorage.getItem(SNAPSHOT_KEY);
  return stored === null ? null : (JSON.parse(stored) as BatterySnapshot);
}

/** The last snapshot, read afresh when it is older than the window's poll. */
export async function loadSnapshot(): Promise<BatterySnapshot | null> {
  listen();
  const stored = await lastSnapshot();
  if (stored !== null && Date.now() - stored.updatedAt < FRESH_MS) {
    return stored;
  }
  return publish(await readBatteries(stored === null));
}

/** Reads every device now, asking for the permissions the app is missing. */
export async function refreshBatteries(): Promise<BatterySnapshot> {
  listen();
  return publish(await readBatteries(true));
}

/**
 * Reads the connected devices, keeps the snapshot and sends the alerts that are
 * due. `ask` lets the system show its permission prompts; without it a missing
 * permission only becomes a note on the snapshot.
 */
export function readBatteries(ask = false): Promise<BatterySnapshot> {
  return serialized(async () => {
    const threshold = await storedThreshold();
    const devices = await readDevices(ask);
    if (ask) {
      await requestNotifications();
    }
    const snapshot = buildSnapshot(devices, threshold, Date.now());
    await keep(snapshot);
    return snapshot;
  });
}

/** Stores the low-battery threshold and returns the last snapshot judged by it. */
export function setThreshold(value: number): Promise<BatterySnapshot | null> {
  return serialized(async () => {
    const threshold = clampThreshold(value);
    await AsyncStorage.setItem(THRESHOLD_KEY, String(threshold));
    const latest = await lastSnapshot();
    if (latest === null) {
      return null;
    }
    const judged = withThreshold(latest, threshold);
    await keep(judged);
    return publish(judged);
  });
}

/** Android needs no permission a person must grant in Settings for a battery report. */
export function permissions(): Promise<Permissions> {
  return Promise.resolve({ inputMonitoring: true });
}

export function openInputMonitoringSettings(): void {}

/** Calls `listener` with every snapshot a read publishes; the returned function stops it. */
export function onSnapshot(listener: (snapshot: BatterySnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads and alerts when the system says a level or a connection changed while the app runs. */
function listen(): void {
  if (!listening) {
    listening = true;
    onBluetoothChanged(() => {
      readBatteries().then(publish, () => undefined);
    });
  }
}

/** One read or threshold change at a time, so two of them never alert for the same device. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

function publish(snapshot: BatterySnapshot): BatterySnapshot {
  listeners.forEach(listener => listener(snapshot));
  return snapshot;
}

async function storedThreshold(): Promise<number> {
  const stored = await AsyncStorage.getItem(THRESHOLD_KEY);
  return stored === null ? DEFAULT_THRESHOLD : clampThreshold(Number(stored));
}

/** Stores the snapshot and notifies for each device that has just fallen to the threshold. */
async function keep(snapshot: BatterySnapshot): Promise<void> {
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  const stored = await AsyncStorage.getItem(ALERTED_KEY);
  const { due, alerted } = dueAlerts(snapshot, stored === null ? [] : (JSON.parse(stored) as string[]));
  await AsyncStorage.setItem(ALERTED_KEY, JSON.stringify(alerted));
  for (const device of due) {
    const text = alertText(device);
    notify(device.identifier, text.title, text.body);
  }
}

async function readDevices(ask: boolean): Promise<DeviceBattery[]> {
  if (!(await bluetoothAllowed(ask))) {
    return [NO_PERMISSION];
  }
  try {
    const devices = (await connectedDevices()).filter(device => device.connected);
    return await Promise.all(devices.map(withLeLevel));
  } catch (error) {
    if ((error as { code?: string }).code === PERMISSION_ERROR) {
      return [NO_PERMISSION];
    }
    throw error;
  }
}

async function bluetoothAllowed(ask: boolean): Promise<boolean> {
  if (Number(Platform.Version) < CONNECT_API) {
    return true;
  }
  const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
  if (await PermissionsAndroid.check(permission)) {
    return true;
  }
  if (!ask) {
    return false;
  }
  const result = await PermissionsAndroid.request(permission).catch(() => null);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/** Alerts need the notification permission; without it Android drops them, so the window asks once it is open. */
async function requestNotifications(): Promise<void> {
  if (Number(Platform.Version) >= NOTIFICATIONS_API) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => null);
  }
}

/**
 * A device with the level Android reports, or else the one its own Bluetooth LE
 * Battery Service gives — what a mouse or keyboard over HID-over-GATT often keeps
 * to itself on Android, as macOS reads it too.
 */
async function withLeLevel(device: BluetoothDevice): Promise<DeviceBattery> {
  const reported = percentage(device.level);
  if (reported !== null) {
    return toDevice(device, reported, 'Android');
  }
  const le = percentage(await readLeBattery(device.address).catch(() => null));
  return toDevice(device, le, 'LE');
}

function toDevice(device: BluetoothDevice, level: number | null, source: string): DeviceBattery {
  return {
    name: device.name,
    identifier: normalizeAddress(device.address),
    kind: deviceKind(classLabel(device.deviceClass), device.name),
    readings: level === null ? [] : [{ part: null, percent: level, source }],
    notes: level === null ? ['Neither Android nor the device’s Bluetooth LE battery service reports a level.'] : [],
  };
}

/** The system's own word for what a device is, from its Bluetooth class. */
function classLabel(deviceClass: number | null): string | null {
  if (deviceClass === null) {
    return null;
  }
  const major = Math.floor(deviceClass / 0x100) % 0x20;
  return major === PHONE_MAJOR_CLASS ? 'phone' : (CLASS_LABELS.get(deviceClass % 0x2000) ?? null);
}
