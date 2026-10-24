import { NativeModules } from 'react-native';

/** One connected device's battery, as the app publishes it (`BatterySnapshot.swift`). */
export interface DeviceLevel {
  name: string;
  /** The Bluetooth address, or this Mac's identifier for an LE-only device. */
  identifier: string;
  /** The lowest of the device's batteries, or null when none could be read. */
  percent: number | null;
  /** Each battery of a device that has several: `{ left: 90, case: 40 }`. */
  parts: Record<string, number>;
  /** `system`, `HID report` or `LE`; null when there is no level. */
  source: string | null;
  /** Why there is no level, when there is none. */
  note: string | null;
  kind: 'keyboard' | 'mouse' | 'trackpad' | 'headphones' | 'phone' | 'speaker' | 'other';
}

export interface BatterySnapshot {
  /** Devices with a level first, lowest first; then the rest by name. */
  devices: DeviceLevel[];
  threshold: number;
  /** Milliseconds since 1970. */
  updatedAt: number;
}

export interface Permissions {
  /** Whether a keyboard's battery report may be read (Input Monitoring). */
  inputMonitoring: boolean;
}

interface JuiceBatteryNative {
  snapshot(): Promise<BatterySnapshot | null>;
  refresh(): Promise<BatterySnapshot>;
  setThreshold(value: number): Promise<BatterySnapshot | null>;
  permissions(): Promise<Permissions>;
  openInputMonitoringSettings(): void;
}

function native(): JuiceBatteryNative {
  const module = NativeModules.JuiceBattery as JuiceBatteryNative | undefined;
  if (module === undefined) {
    throw new Error('JuiceBattery native module is not linked');
  }
  return module;
}

/** The last published snapshot, or null before the first read has finished. */
export function loadSnapshot(): Promise<BatterySnapshot | null> {
  return native().snapshot();
}

/** Reads every device now. */
export function refreshBatteries(): Promise<BatterySnapshot> {
  return native().refresh();
}

/** Stores the low-battery threshold and returns the snapshot judged by it. */
export function setThreshold(value: number): Promise<BatterySnapshot | null> {
  return native().setThreshold(value);
}

export function permissions(): Promise<Permissions> {
  return native().permissions();
}

export function openInputMonitoringSettings(): void {
  native().openInputMonitoringSettings();
}
