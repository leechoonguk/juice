import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isBlueZChange, type ManagedObjects, parseBlueZDevices } from '../desktop/src/battery/linux';
import { parseWindowsDevices, SCRIPT as WINDOWS_SCRIPT } from '../desktop/src/battery/windows';
import { createMonitor, type MonitorEnvironment } from '../desktop/src/monitor';
import { loadSettings, saveSettings } from '../desktop/src/settings';
import type { DeviceBattery } from '../src/snapshot';

// The desktop main process's decisions: what each provider makes of what the
// OS answered, and how the monitor turns reads into snapshots and alerts. The
// reads themselves (PowerShell, D-Bus) need the real OS.

function node(address: string, bus: 'BTHENUM' | 'BTHLE', fields: Record<string, unknown>) {
  return {
    FriendlyName: null,
    InstanceId: `${bus}\\DEV_${address}\\7&1A2B3C4D&0&${address}`,
    Status: 'OK',
    Class: 'Bluetooth',
    Battery: null,
    ...fields,
  };
}

const WINDOWS_ANSWER = JSON.stringify([
  node('AA0000000001', 'BTHENUM', { FriendlyName: 'Test Headphones', Battery: 45 }),
  node('AA0000000001', 'BTHLE', {}),
  node('AA0000000002', 'BTHLE', { FriendlyName: 'Test Keyboard', Class: 'Keyboard' }),
  node('AA0000000003', 'BTHENUM', { FriendlyName: 'Test Speaker', Status: 'Unknown', Battery: 90 }),
  {
    FriendlyName: 'Headset Audio',
    InstanceId: 'BTHENUM\\{0000111E-0000-1000-8000-00805F9B34FB}_VID&0001000A_PID&0001\\7&1A2B3C4D&0&AA0000000001_C00000000',
    Status: 'OK',
    Class: 'Bluetooth',
    Battery: null,
  },
]);

const MANAGED_OBJECTS: ManagedObjects = {
  '/org/bluez': { 'org.bluez.AgentManager1': {} },
  '/org/bluez/hci0': { 'org.bluez.Adapter1': { Address: { value: 'AA:00:00:00:00:0F' } } },
  '/org/bluez/hci0/dev_AA_00_00_00_00_01': {
    'org.bluez.Device1': {
      Address: { value: 'AA:00:00:00:00:01' },
      Alias: { value: 'Test Headset' },
      Name: { value: 'Test Headset (name)' },
      Icon: { value: 'audio-headset' },
      Connected: { value: true },
    },
    'org.bluez.Battery1': { Percentage: { value: 80 } },
  },
  '/org/bluez/hci0/dev_AA_00_00_00_00_02': {
    'org.bluez.Device1': {
      Address: { value: 'AA:00:00:00:00:02' },
      Name: { value: 'Test Mouse' },
      Icon: { value: 'input-mouse' },
      Connected: { value: true },
    },
  },
  '/org/bluez/hci0/dev_AA_00_00_00_00_03': {
    'org.bluez.Device1': {
      Address: { value: 'AA:00:00:00:00:03' },
      Alias: { value: 'Test Keyboard' },
      Connected: { value: false },
    },
    'org.bluez.Battery1': { Percentage: { value: 55 } },
  },
};

function device(name: string, percent: number | null): DeviceBattery {
  return {
    name,
    identifier: 'AA:00:00:00:00:0A',
    kind: 'other',
    readings: percent === null ? [] : [{ part: null, percent, source: 'Windows' }],
    notes: percent === null ? ['no level'] : [],
  };
}

function monitorFor(devices: () => DeviceBattery[], options: { note?: string; saveFails?: boolean } = {}) {
  const stored = { threshold: 20, alerted: [] as string[] };
  const notified: string[] = [];
  const published: number[] = [];
  const reads = { count: 0 };
  const environment: MonitorEnvironment = {
    read: async () => {
      reads.count += 1;
      return { devices: devices(), note: options.note ?? null };
    },
    load: () => ({ ...stored }),
    save: settings => {
      if (options.saveFails === true) {
        throw new Error('read-only file system');
      }
      Object.assign(stored, settings);
    },
    notify: found => notified.push(found.name),
    changed: snapshot => published.push(snapshot.updatedAt),
    now: () => 1_000,
  };
  return { monitor: createMonitor(environment), stored, notified, published, reads };
}

test('Windows: one device per address, with the level from whichever node has it', () => {
  expect(parseWindowsDevices(WINDOWS_ANSWER)).toEqual([
    {
      name: 'Test Headphones',
      identifier: 'AA:00:00:00:00:01',
      kind: 'headphones',
      readings: [{ part: null, percent: 45, source: 'Windows' }],
      notes: [],
    },
    {
      name: 'Test Keyboard',
      identifier: 'AA:00:00:00:00:02',
      kind: 'keyboard',
      readings: [],
      notes: ['Windows reports no battery level for this device'],
    },
  ]);
});

test('Windows: a single device, an empty answer and a byte-order mark are all read', () => {
  const single = JSON.stringify(node('AA0000000001', 'BTHLE', { FriendlyName: 'Test Mouse', Battery: 7 }));
  expect(parseWindowsDevices(`\uFEFF${single}`).map(found => found.readings[0].percent)).toEqual([7]);
  expect(parseWindowsDevices('')).toEqual([]);
  expect(parseWindowsDevices('[]')).toEqual([]);
  expect(() => parseWindowsDevices('not json')).toThrow();
});

test('Windows: an out-of-range level is no level, and the lowest of several counts', () => {
  const answer = JSON.stringify([
    node('AA0000000001', 'BTHENUM', { FriendlyName: 'Test Mouse', Battery: 250 }),
    node('AA0000000002', 'BTHENUM', { FriendlyName: 'Test Speaker', Battery: 60 }),
    node('AA0000000002', 'BTHLE', { Battery: 40 }),
  ]);
  const [mouse, speaker] = parseWindowsDevices(answer);
  expect(mouse.readings).toEqual([]);
  expect(speaker.readings).toEqual([{ part: null, percent: 40, source: 'Windows' }]);
});

test('Windows: a device every node of which says it is not connected is dropped, an unknown state is kept', () => {
  const answer = JSON.stringify([
    node('AA0000000001', 'BTHENUM', { FriendlyName: 'Test Headphones', Connected: false, Battery: 45 }),
    node('AA0000000002', 'BTHENUM', { FriendlyName: 'Test Mouse', Connected: true, Battery: 80 }),
    node('AA0000000003', 'BTHENUM', { FriendlyName: 'Test Keyboard' }),
    node('AA0000000004', 'BTHENUM', { FriendlyName: 'Test Speaker', Connected: false }),
    node('AA0000000004', 'BTHLE', { Connected: true }),
    node('AA0000000005', 'BTHENUM', { FriendlyName: 'Test Phone', Connected: false }),
    node('AA0000000005', 'BTHLE', {}),
  ]);
  expect(parseWindowsDevices(answer).map(found => found.name)).toEqual([
    'Test Mouse',
    'Test Keyboard',
    'Test Speaker',
    'Test Phone',
  ]);
});

test('BlueZ: connected devices only, with Battery1 when there is one', () => {
  expect(parseBlueZDevices(MANAGED_OBJECTS)).toEqual([
    {
      name: 'Test Headset',
      identifier: 'AA:00:00:00:00:01',
      kind: 'headphones',
      readings: [{ part: null, percent: 80, source: 'BlueZ' }],
      notes: [],
    },
    {
      name: 'Test Mouse',
      identifier: 'AA:00:00:00:00:02',
      kind: 'mouse',
      readings: [],
      notes: ['BlueZ reports no battery level for this device'],
    },
  ]);
  expect(parseBlueZDevices({})).toEqual([]);
});

test('the monitor alerts once as a device falls low and again only after a charge', async () => {
  const levels = { headphones: 30 };
  const { monitor, notified, stored } = monitorFor(() => [device('Headphones', levels.headphones)]);
  await monitor.refresh();
  expect(notified).toEqual([]);

  levels.headphones = 18;
  const low = await monitor.refresh();
  expect(low.devices[0].percent).toBe(18);
  expect(notified).toEqual(['Headphones']);
  expect(stored.alerted).toEqual(['AA:00:00:00:00:0A']);

  levels.headphones = 15;
  await monitor.refresh();
  expect(notified).toEqual(['Headphones']);

  levels.headphones = 60;
  await monitor.refresh();
  levels.headphones = 10;
  await monitor.refresh();
  expect(notified).toEqual(['Headphones', 'Headphones']);
});

test('the monitor shares a read under way, judges by a stored threshold and keeps it', async () => {
  const { monitor, reads, stored, published } = monitorFor(() => [device('Headphones', 40)]);
  expect(monitor.setThreshold(200)).toBeNull();
  expect(stored.threshold).toBe(95);

  const [first, second] = await Promise.all([monitor.refresh(), monitor.refresh()]);
  expect(first).toBe(second);
  expect(reads.count).toBe(1);
  expect(first.threshold).toBe(95);

  expect(monitor.setThreshold(30)?.threshold).toBe(30);
  expect(monitor.snapshot()?.threshold).toBe(30);
  expect(stored.threshold).toBe(30);
  expect(published).toHaveLength(2);
});

test('settings survive a restart, and a missing or damaged file is a first run', () => {
  const folder = mkdtempSync(join(tmpdir(), 'juice-settings-'));
  try {
    const file = join(folder, 'nested', 'settings.json');
    expect(loadSettings(file)).toEqual({ threshold: 20, alerted: [] });

    saveSettings(file, { threshold: 35, alerted: ['AA:00:00:00:00:01'] });
    expect(loadSettings(file)).toEqual({ threshold: 35, alerted: ['AA:00:00:00:00:01'] });

    writeFileSync(file, '{"threshold": "high", "alerted": [1, "AA:00:00:00:00:02"]}');
    expect(loadSettings(file)).toEqual({ threshold: 20, alerted: ['AA:00:00:00:00:02'] });

    writeFileSync(file, 'not json');
    expect(loadSettings(file)).toEqual({ threshold: 20, alerted: [] });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('Windows: service nodes are ignored, and the script asks only a device node for properties', () => {
  const services = JSON.stringify([
    {
      FriendlyName: 'Handsfree Audio',
      InstanceId: 'BTHENUM\\{0000111E-0000-1000-8000-00805F9B34FB}_VID&0001000A_PID&0001\\7&1A2B3C4D&0&AA0000000001_C00000000',
      Status: 'OK',
      Class: 'Bluetooth',
      Battery: 50,
    },
    {
      FriendlyName: 'LE Service',
      InstanceId: 'BTHLEDEVICE\\{0000180F-0000-1000-8000-00805F9B34FB}_DEV_VID&01_PID&02\\8&1&0&0001',
      Status: 'OK',
      Class: 'Bluetooth',
      Battery: 60,
    },
  ]);
  expect(parseWindowsDevices(services)).toEqual([]);

  const filter = WINDOWS_SCRIPT.indexOf("-like 'BTHENUM\\DEV_*'");
  expect(filter).toBeGreaterThan(-1);
  expect(WINDOWS_SCRIPT).toContain("-like 'BTHLE\\DEV_*'");
  expect(filter).toBeLessThan(WINDOWS_SCRIPT.indexOf('Get-PnpDeviceProperty'));
});

test('a settings file that cannot be written costs neither the read nor the alert nor the threshold', async () => {
  const complaint = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const { monitor, notified, published } = monitorFor(() => [device('Headphones', 10)], { saveFails: true });

    const snapshot = await monitor.refresh();
    expect(snapshot.devices[0].percent).toBe(10);
    expect(monitor.snapshot()).toBe(snapshot);
    expect(notified).toEqual(['Headphones']);
    expect(published).toHaveLength(1);

    expect(monitor.setThreshold(35)?.threshold).toBe(35);
    expect(monitor.snapshot()?.threshold).toBe(35);
    expect(complaint).toHaveBeenCalled();
  } finally {
    complaint.mockRestore();
  }
});

test('a read that found nothing because it could not read publishes one row that says why', async () => {
  const { monitor, notified } = monitorFor(() => [], { note: 'The system D-Bus is not reachable: connect ENOENT' });
  const snapshot = await monitor.refresh();
  expect(snapshot.devices).toEqual([
    {
      name: 'Bluetooth',
      identifier: 'bluetooth',
      percent: null,
      parts: {},
      source: null,
      note: 'The system D-Bus is not reachable: connect ENOENT',
      kind: 'other',
    },
  ]);
  expect(notified).toEqual([]);

  const quiet = monitorFor(() => []);
  expect((await quiet.monitor.refresh()).devices).toEqual([]);
});

test('BlueZ signals that change the list are told from the rest', () => {
  const changed = (member: string, body: unknown[]) => isBlueZChange({ member, body });
  expect(changed('PropertiesChanged', ['org.bluez.Device1', { Connected: { value: true } }, []])).toBe(true);
  expect(changed('PropertiesChanged', ['org.bluez.Battery1', { Percentage: { value: 40 } }, []])).toBe(true);
  expect(changed('PropertiesChanged', ['org.bluez.Device1', { RSSI: { value: -50 } }, []])).toBe(false);
  expect(changed('PropertiesChanged', ['org.bluez.Adapter1', { Discovering: { value: true } }, []])).toBe(false);
  expect(changed('InterfacesAdded', ['/org/bluez/hci0/dev_AA_00_00_00_00_01', {}])).toBe(true);
  expect(changed('InterfacesRemoved', ['/org/bluez/hci0/dev_AA_00_00_00_00_01', []])).toBe(true);
  expect(changed('NameOwnerChanged', [])).toBe(false);
});
