/**
 * Where the batteries come from on each desktop: PowerShell's view of the
 * Bluetooth devices on Windows, BlueZ over D-Bus on Linux. A provider that
 * cannot read says why; the app shows an empty list rather than failing.
 */
import type { DeviceBattery } from '../../../src/snapshot';
import { readBlueZ } from './linux';
import { readWindows } from './windows';

/** The devices one read found, and the reason there are none when it could not read. */
export interface BatteryRead {
  devices: DeviceBattery[];
  note: string | null;
}

export async function readBatteries(): Promise<BatteryRead> {
  try {
    if (process.platform === 'win32') {
      return { devices: await readWindows(), note: null };
    }
    if (process.platform === 'linux') {
      return { devices: await readBlueZ(), note: null };
    }
    return { devices: [], note: 'Battery levels are read on Windows and Linux only.' };
  } catch (error) {
    return { devices: [], note: error instanceof Error ? error.message : String(error) };
  }
}
