/**
 * Linux: BlueZ's object tree on the system bus. A connected `Device1` that has
 * a `Battery1` interface carries its level in `Percentage`. `parseBlueZDevices`
 * is the whole decision, over what `GetManagedObjects` returns.
 */
import type { Message, MessageBus } from 'dbus-next';

import { type DeviceBattery, deviceKind, normalizeAddress, percentage } from '../../../src/snapshot';

const SOURCE = 'BlueZ';
const TIMEOUT_MS = 10_000;
const NO_LEVEL = 'BlueZ reports no battery level for this device';

/** A D-Bus variant: dbus-next wraps every property value in one. */
interface Variant {
  value: unknown;
}

/** Object path → interface → property → value, as `GetManagedObjects` answers. */
export type ManagedObjects = Record<string, Record<string, Record<string, Variant>>>;

export async function readBlueZ(): Promise<DeviceBattery[]> {
  const { systemBus } = await import('dbus-next');
  const bus = systemBus();
  // A missing socket arrives as an 'error' event, which would otherwise end the process.
  const failed = new Promise<never>((_resolve, reject) => {
    bus.on('error', error => reject(new Error(`The system D-Bus is not reachable: ${error.message}`)));
  });
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('BlueZ did not answer in time')), TIMEOUT_MS);
  });
  try {
    return await Promise.race([managedDevices(bus), failed, timedOut]);
  } finally {
    clearTimeout(timer);
    bus.disconnect();
  }
}

/** Connected devices, each with its level when BlueZ publishes one. */
export function parseBlueZDevices(objects: ManagedObjects): DeviceBattery[] {
  const devices: DeviceBattery[] = [];
  for (const interfaces of Object.values(objects)) {
    const device = interfaces['org.bluez.Device1'];
    if (device === undefined || device.Connected?.value !== true) {
      continue;
    }
    const address = text(device.Address?.value);
    const name = text(device.Alias?.value) ?? text(device.Name?.value) ?? address ?? 'Bluetooth device';
    const level = percentage(interfaces['org.bluez.Battery1']?.Percentage?.value);
    devices.push({
      name,
      identifier: address === null ? name : normalizeAddress(address),
      kind: deviceKind(text(device.Icon?.value), name),
      readings: level === null ? [] : [{ part: null, percent: level, source: SOURCE }],
      notes: level === null ? [NO_LEVEL] : [],
    });
  }
  return devices;
}

/**
 * Whether a BlueZ signal can change the list: a device connecting or
 * disconnecting, a level moving, or an interface (a device, its battery)
 * appearing or going.
 */
export function isBlueZChange(signal: Pick<Message, 'member' | 'body'>): boolean {
  if (signal.member === 'InterfacesAdded' || signal.member === 'InterfacesRemoved') {
    return true;
  }
  if (signal.member !== 'PropertiesChanged') {
    return false;
  }
  const [name, changed] = signal.body as [unknown, Record<string, unknown> | undefined];
  return (
    (name === 'org.bluez.Device1' && changed?.Connected !== undefined) ||
    (name === 'org.bluez.Battery1' && changed?.Percentage !== undefined)
  );
}

/**
 * Calls `onChange` whenever BlueZ signals a change `isBlueZChange` accepts. With
 * no system bus it does nothing: the periodic read remains.
 */
export function watchBlueZ(onChange: () => void): void {
  subscribe(onChange).catch(() => undefined);
}

async function subscribe(onChange: () => void): Promise<void> {
  // Loaded when needed: jest runs the parse functions above without desktop/node_modules.
  const { Message: BusMessage, systemBus } = await import('dbus-next');
  const bus = systemBus();
  bus.on('error', () => undefined);
  bus.on('message', signal => {
    if (isBlueZChange(signal)) {
      onChange();
    }
  });
  await bus.call(
    new BusMessage({
      path: '/org/freedesktop/DBus',
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
      member: 'AddMatch',
      signature: 's',
      body: ["type='signal',sender='org.bluez'"],
    }),
  );
}

async function managedDevices(bus: MessageBus): Promise<DeviceBattery[]> {
  const root = await bus.getProxyObject('org.bluez', '/').catch((cause: Error) => {
    throw new Error(`bluetoothd is not running or not reachable: ${cause.message}`);
  });
  const manager = root.getInterface('org.freedesktop.DBus.ObjectManager');
  return parseBlueZDevices((await manager.GetManagedObjects()) as ManagedObjects);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
