import type { DeviceLevel } from './native/juiceBattery';

/** The threshold moves in steps of five, within what the native side accepts. */
export const THRESHOLD = { min: 5, max: 95, step: 5 };

export function nextThreshold(current: number, direction: 1 | -1): number {
  return Math.min(THRESHOLD.max, Math.max(THRESHOLD.min, current + direction * THRESHOLD.step));
}

export function isLow(device: DeviceLevel, threshold: number): boolean {
  return device.percent !== null && device.percent <= threshold;
}

/** `51%`, or `—` when the device reports no level. */
export function levelLabel(device: DeviceLevel): string {
  return device.percent === null ? '—' : `${device.percent}%`;
}

/** `left 90% · right 88% · case 40%` for a device with several batteries, else empty. */
export function partsLabel(device: DeviceLevel): string {
  const order = ['left', 'right', 'case'];
  const rank = (part: string) => (order.includes(part) ? order.indexOf(part) : order.length);
  return Object.entries(device.parts)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([part, percent]) => `${part} ${percent}%`)
    .join(' · ');
}

/** Where a level came from, in words a person reads. */
export function sourceLabel(device: DeviceLevel): string {
  switch (device.source) {
    case 'system':
      return 'reported by macOS';
    case 'HID report':
      return 'read from the device';
    case 'LE':
      return 'read over Bluetooth LE';
    default:
      return device.note ?? '';
  }
}

/** `just now`, `3 min ago`, `2 h ago`. */
export function timeAgo(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

/** Whether a device could not be read only for want of Input Monitoring. */
export function needsInputMonitoring(devices: DeviceLevel[]): boolean {
  return devices.some(device => device.percent === null && (device.note ?? '').includes('Input Monitoring'));
}
