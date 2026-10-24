/**
 * The snapshot rules every platform without Swift shares: Windows and Linux in
 * the desktop app's main process, Android in the app and its widget. macOS keeps
 * the same rules in `BatteryModel.swift` and `LowBatteryAlerts.swift`; the two
 * are kept equal by `__tests__/snapshot.test.ts`, which pins the Swift cases.
 *
 * React Native–free: the desktop main process (Node) imports it directly.
 */
import { THRESHOLD } from './battery';
import type { BatterySnapshot, DeviceLevel } from './native/juiceBattery';

export type DeviceKind = DeviceLevel['kind'];

/** One battery level and the path it came by (`Windows`, `BlueZ`, `Android`, …). */
export interface BatteryReading {
  /** Which battery of a device that has several (`left`, `right`, `case`); null for one. */
  part: string | null;
  percent: number;
  source: string;
}

/** Every reading for one connected device, and why each path that gave nothing gave nothing. */
export interface DeviceBattery {
  name: string;
  identifier: string;
  kind: DeviceKind;
  readings: BatteryReading[];
  notes: string[];
}

/** The threshold before anyone has chosen one. */
export const DEFAULT_THRESHOLD = 20;

/** How far above the threshold a level must climb before the device may alert again. */
export const REARM_MARGIN = 5;

const KINDS: Array<[DeviceKind, string[]]> = [
  ['trackpad', ['trackpad']],
  ['mouse', ['mouse']],
  ['keyboard', ['keyboard']],
  ['headphones', ['headphone', 'headset', 'airpods', 'buds']],
  ['phone', ['phone']],
  ['speaker', ['speaker']],
];

/** What a device is, for its icon: the system's label first, then its name. */
export function deviceKind(label: string | null, name: string): DeviceKind {
  const text = `${label ?? ''} ${name}`.toLowerCase();
  return KINDS.find(([, words]) => words.some(word => text.includes(word)))?.[0] ?? 'other';
}

/** `aa-00-00-00-00-01`, `aa0000000001` and `AA:00:00:00:00:01` are the same address. */
export function normalizeAddress(address: string): string {
  const hex = address.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hex.length === 12 ? (hex.match(/../g) ?? []).join(':') : address.toUpperCase();
}

/** A level a platform reported, or null when it is not a percentage. */
export function percentage(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value.trim().replace(/%$/, '')) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= 0 && number <= 100 ? number : null;
}

/** A threshold the user asked for, held within the range the window offers. */
export function clampThreshold(value: number): number {
  return Number.isFinite(value) ? Math.min(THRESHOLD.max, Math.max(THRESHOLD.min, Math.round(value))) : DEFAULT_THRESHOLD;
}

/**
 * The snapshot a platform publishes: each device's lowest reading, devices with
 * a level first and lowest first, then the rest by name.
 */
export function buildSnapshot(devices: DeviceBattery[], threshold: number, now: number): BatterySnapshot {
  const levels = devices.map((device): DeviceLevel => {
    const lowest = device.readings.reduce<BatteryReading | null>(
      (min, reading) => (min === null || reading.percent < min.percent ? reading : min),
      null,
    );
    const parts: Record<string, number> = {};
    for (const reading of device.readings) {
      if (reading.part !== null) {
        parts[reading.part] = reading.percent;
      }
    }
    return {
      name: device.name,
      identifier: device.identifier,
      percent: lowest?.percent ?? null,
      parts,
      source: lowest?.source ?? null,
      note: lowest === null ? device.notes[0] ?? null : null,
      kind: device.kind,
    };
  });
  return { devices: levels.sort(byLevelThenName), threshold, updatedAt: now };
}

/** The same snapshot judged by another threshold; no new read is needed. */
export function withThreshold(snapshot: BatterySnapshot, threshold: number): BatterySnapshot {
  return { ...snapshot, threshold };
}

/** The devices at or below the threshold. */
export function lowDevices(snapshot: BatterySnapshot): DeviceLevel[] {
  return snapshot.devices.filter(device => device.percent !== null && device.percent <= snapshot.threshold);
}

/**
 * Which devices deserve a low-battery notification now: one when a level falls
 * to the threshold or below, and none again for that device until its level has
 * risen clear of the threshold — a charge, not a reading that wobbles by one. A
 * device that disappears keeps its state. Returns the new alerted set; the
 * caller stores it.
 */
export function dueAlerts(
  snapshot: BatterySnapshot,
  alerted: Iterable<string>,
): { due: DeviceLevel[]; alerted: string[] } {
  const next = new Set(alerted);
  const due: DeviceLevel[] = [];
  for (const device of snapshot.devices) {
    if (device.percent === null) {
      continue;
    }
    if (device.percent <= snapshot.threshold) {
      if (!next.has(device.identifier)) {
        next.add(device.identifier);
        due.push(device);
      }
    } else if (device.percent >= snapshot.threshold + REARM_MARGIN) {
      next.delete(device.identifier);
    }
  }
  return { due, alerted: [...next].sort() };
}

/** `Keyboard battery is low` / `15% left` — the words every platform's notification uses. */
export function alertText(device: DeviceLevel): { title: string; body: string } {
  return { title: `${device.name} battery is low`, body: `${device.percent ?? 0}% left` };
}

/** Code-unit order, as Swift's `<` on `String` sorts, so both platforms list devices alike. */
function compareNames(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function byLevelThenName(left: DeviceLevel, right: DeviceLevel): number {
  if (left.percent !== null && right.percent !== null) {
    return left.percent !== right.percent ? left.percent - right.percent : compareNames(left.name, right.name);
  }
  if (left.percent !== null) {
    return -1;
  }
  if (right.percent !== null) {
    return 1;
  }
  return compareNames(left.name, right.name);
}
