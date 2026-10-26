/**
 * The batteries `make demo` records: a scripted desk of made-up devices that
 * stands in for the real provider (`../battery`) in the demo bundle and nowhere
 * else — `build.ts` swaps it in under `JUICE_DEMO=1`, and nothing imports it.
 * It reads no Bluetooth device, so no real name or address can reach a picture.
 *
 * The recorder (`demo.ts`) moves the script on by writing the step number to
 * the file `JUICE_DEMO_STEP_FILE` names, then pressing Refresh; every read
 * shows that step.
 */
import { readFileSync } from 'node:fs';

import type { BatteryReading, DeviceBattery } from '../../../src/snapshot';
import type { BatteryRead } from '../battery';

type Kind = DeviceBattery['kind'];

/** One device on the desk: its level at each step, null while it has none, `undefined` while it is not connected. */
interface Desk {
  name: string;
  kind: Kind;
  identifier: string;
  /** The macOS path the level came by, so the window words it as it does on a Mac. */
  source: string;
  levels: Array<number | null | undefined>;
}

/**
 * Step 0 is the first screen; each later step is one Refresh. The keyboard
 * drains past the 20% threshold, a phone connects just above the next two
 * thresholds, and the headphones leave.
 */
const DESK: Desk[] = [
  { name: 'Headphones', kind: 'headphones', identifier: 'AA:00:00:00:00:01', source: 'system', levels: [88, 88, 88, 87, undefined] },
  { name: 'Mouse', kind: 'mouse', identifier: 'AA:00:00:00:00:02', source: 'system', levels: [52, 52, 51, 51, 51] },
  { name: 'Trackpad', kind: 'trackpad', identifier: 'AA:00:00:00:00:03', source: 'system', levels: [75, 75, 75, 74, 74] },
  { name: 'Keyboard', kind: 'keyboard', identifier: 'AA:00:00:00:00:04', source: 'HID report', levels: [24, 21, 18, 18, 17] },
  { name: 'Speaker', kind: 'speaker', identifier: 'AA:00:00:00:00:05', source: 'system', levels: [null, null, null, null, null] },
  { name: 'Phone', kind: 'phone', identifier: 'AA:00:00:00:00:06', source: 'LE', levels: [undefined, undefined, undefined, 27, 27] },
];

export async function readBatteries(): Promise<BatteryRead> {
  const step = currentStep();
  const devices = DESK.flatMap(desk => {
    const level = desk.levels[Math.min(step, desk.levels.length - 1)];
    return level === undefined ? [] : [connected(desk, level)];
  });
  return { devices, note: null };
}

/** Stands in for `battery/linux`: a Linux session has no BlueZ of the recorder's to watch. */
export function watchBlueZ(): void {}

function connected(desk: Desk, level: number | null): DeviceBattery {
  const readings: BatteryReading[] = level === null ? [] : [{ part: null, percent: level, source: desk.source }];
  const notes = level === null ? ['reports no battery to this Mac'] : [];
  return { name: desk.name, identifier: desk.identifier, kind: desk.kind, readings, notes };
}

function currentStep(): number {
  const file = process.env.JUICE_DEMO_STEP_FILE;
  const step = file === undefined ? 0 : Number.parseInt(readFileSync(file, 'utf8'), 10);
  return Number.isNaN(step) ? 0 : step;
}
