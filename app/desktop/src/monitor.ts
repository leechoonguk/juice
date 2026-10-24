/**
 * The main process's picture of the batteries: the last snapshot, the
 * threshold, and which devices have already alerted. Reading, storing and
 * notifying are handed in, so the rules run the same under test as in Electron.
 */
import type { BatterySnapshot, DeviceLevel } from '../../src/native/juiceBattery';
import { buildSnapshot, clampThreshold, type DeviceBattery, dueAlerts, withThreshold } from '../../src/snapshot';
import type { BatteryRead } from './battery';
import type { Settings } from './settings';

export interface MonitorEnvironment {
  read(): Promise<BatteryRead>;
  load(): Settings;
  save(settings: Settings): void;
  notify(device: DeviceLevel): void;
  /** Called with every snapshot the monitor publishes. */
  changed(snapshot: BatterySnapshot): void;
  now(): number;
}

export interface Monitor {
  snapshot(): BatterySnapshot | null;
  /** Reads every device now; a read already under way is shared. */
  refresh(): Promise<BatterySnapshot>;
  setThreshold(value: number): BatterySnapshot | null;
}

export function createMonitor(environment: MonitorEnvironment): Monitor {
  const settings = environment.load();
  const state = {
    snapshot: null as BatterySnapshot | null,
    reading: null as Promise<BatterySnapshot> | null,
  };

  /** What a read that could not read says in place of devices, as Android does for a denied permission. */
  function unreadable(note: string): DeviceBattery {
    return { name: 'Bluetooth', identifier: 'bluetooth', kind: 'other', readings: [], notes: [note] };
  }

  /** A settings file that cannot be written must not cost the read: the values stay in memory. */
  function persist(): void {
    try {
      environment.save(settings);
    } catch (error) {
      console.error('Juice could not save its settings:', error);
    }
  }

  function publish(snapshot: BatterySnapshot): void {
    const { due, alerted } = dueAlerts(snapshot, settings.alerted);
    const rearmed = alerted.join() !== settings.alerted.join();
    settings.alerted = alerted;
    state.snapshot = snapshot;
    due.forEach(device => environment.notify(device));
    environment.changed(snapshot);
    if (due.length > 0 || rearmed) {
      persist();
    }
  }

  async function read(): Promise<BatterySnapshot> {
    const { devices, note } = await environment.read();
    const found = devices.length === 0 && note !== null ? [unreadable(note)] : devices;
    const snapshot = buildSnapshot(found, settings.threshold, environment.now());
    publish(snapshot);
    return snapshot;
  }

  return {
    snapshot: () => state.snapshot,
    refresh() {
      state.reading ??= read().finally(() => {
        state.reading = null;
      });
      return state.reading;
    },
    setThreshold(value) {
      settings.threshold = clampThreshold(value);
      const judged = state.snapshot === null ? null : withThreshold(state.snapshot, settings.threshold);
      if (judged !== null) {
        publish(judged);
      }
      persist();
      return judged;
    },
  };
}
