/**
 * `app/src/native/juiceBattery.ts` for Windows and Linux: the main process
 * reads the batteries and owns the snapshot and the threshold; the window asks
 * it through the preload bridge, and keeps the snapshots it pushes.
 */
import type { BatterySnapshot, Permissions } from '../../../src/native/juiceBattery';
import type { JuiceBridge } from '../bridge';

export type { BatterySnapshot, DeviceLevel, Permissions } from '../../../src/native/juiceBattery';

declare global {
  interface Window {
    juice: JuiceBridge;
  }
}

const pushed = {
  latest: null as BatterySnapshot | null,
  listening: false,
};

/** The newest snapshot the main process published, or null before the first read has finished. */
export function loadSnapshot(): Promise<BatterySnapshot | null> {
  listen();
  return pushed.latest === null ? window.juice.snapshot() : Promise.resolve(pushed.latest);
}

/** Reads every device now. */
export async function refreshBatteries(): Promise<BatterySnapshot> {
  listen();
  return (pushed.latest = await window.juice.refresh());
}

/** Stores the low-battery threshold and returns the snapshot judged by it. */
export async function setThreshold(value: number): Promise<BatterySnapshot | null> {
  listen();
  const snapshot = await window.juice.setThreshold(value);
  pushed.latest = snapshot ?? pushed.latest;
  return snapshot;
}

/** Nothing to grant outside macOS: Windows and BlueZ report batteries without a permission. */
export function permissions(): Promise<Permissions> {
  return Promise.resolve({ inputMonitoring: true });
}

export function openInputMonitoringSettings(): void {}

function listen(): void {
  if (!pushed.listening) {
    pushed.listening = true;
    window.juice.onSnapshot(snapshot => {
      pushed.latest = snapshot;
    });
  }
}
