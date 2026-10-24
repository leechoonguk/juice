import type { BatterySnapshot } from '../src/native/juiceBattery';
import {
  buildSnapshot,
  clampThreshold,
  deviceKind,
  dueAlerts,
  type DeviceBattery,
  lowDevices,
  normalizeAddress,
  percentage,
} from '../src/snapshot';

// The cases mirror app/macos/CoreTests/Tests/BatteryTests.swift, so the
// platforms without Swift list, classify and alert exactly as macOS does.

function levels(values: Record<string, number>, threshold = 20): BatterySnapshot {
  return {
    devices: Object.entries(values).map(([name, percent]) => ({
      name,
      identifier: name,
      percent,
      parts: {},
      source: 'system',
      note: null,
      kind: 'other' as const,
    })),
    threshold,
    updatedAt: 0,
  };
}

test('the snapshot lists the lowest reading of each device, lowest first', () => {
  const devices: DeviceBattery[] = [
    { name: 'Speaker', identifier: 'a', kind: 'speaker', readings: [], notes: ['reports no battery to this PC'] },
    {
      name: 'Buds',
      identifier: 'b',
      kind: 'headphones',
      readings: [
        { part: 'left', percent: 90, source: 'Android' },
        { part: 'case', percent: 40, source: 'Android' },
      ],
      notes: [],
    },
    { name: 'Board', identifier: 'c', kind: 'keyboard', readings: [{ part: null, percent: 15, source: 'BlueZ' }], notes: [] },
  ];
  const snapshot = buildSnapshot(devices, 20, 1500);
  expect(snapshot.devices.map(device => device.name)).toEqual(['Board', 'Buds', 'Speaker']);
  expect(snapshot.devices[1]).toMatchObject({ percent: 40, parts: { left: 90, case: 40 }, source: 'Android', note: null });
  expect(snapshot.devices[2]).toMatchObject({ percent: null, source: null, note: 'reports no battery to this PC' });
  expect(snapshot.updatedAt).toBe(1500);
  expect(lowDevices(snapshot).map(device => device.name)).toEqual(['Board']);
});

test('names sort by code unit, as Swift sorts them, when levels tie or are missing', () => {
  const device = (name: string, percent: number | null): DeviceBattery => ({
    name,
    identifier: name,
    kind: 'other',
    readings: percent === null ? [] : [{ part: null, percent, source: 'BlueZ' }],
    notes: [],
  });
  const snapshot = buildSnapshot([device('b', 50), device('Z', 50), device('y', null), device('B', null)], 20, 0);
  expect(snapshot.devices.map(entry => entry.name)).toEqual(['Z', 'b', 'B', 'y']);
});

test.each([
  ['Keyboard', 'Board', 'keyboard'],
  [null, 'Magic Trackpad', 'trackpad'],
  ['Headphones', 'Buds', 'headphones'],
  [null, 'my AirPods', 'headphones'],
  [null, "Pat's gadget", 'other'],
  [null, 'iPhone', 'phone'],
] as const)('a device labelled %s named %s is a %s', (label, name, kind) => {
  expect(deviceKind(label, name)).toBe(kind);
});

test('a level that is not a percentage is dropped', () => {
  expect(percentage('75%')).toBe(75);
  expect(percentage(0)).toBe(0);
  expect(percentage('unknown')).toBeNull();
  expect(percentage(140)).toBeNull();
  expect(percentage(-1)).toBeNull();
  expect(percentage(12.5)).toBeNull();
});

test('an address reads the same however a platform spells it', () => {
  expect(normalizeAddress('aa-00-00-00-00-01')).toBe('AA:00:00:00:00:01');
  expect(normalizeAddress('aa0000000001')).toBe('AA:00:00:00:00:01');
  expect(normalizeAddress('not an address')).toBe('NOT AN ADDRESS');
});

test('a threshold stays within what the window offers', () => {
  expect(clampThreshold(2)).toBe(5);
  expect(clampThreshold(140)).toBe(95);
  expect(clampThreshold(Number.NaN)).toBe(20);
});

test('a device alerts once when it reaches the threshold', () => {
  const first = dueAlerts(levels({ Board: 30, Buds: 20 }), []);
  expect(first.due.map(device => device.name)).toEqual(['Buds']);
  expect(dueAlerts(levels({ Board: 30, Buds: 18 }), first.alerted).due).toEqual([]);
});

test('a device alerts again only after it rose clear of the threshold', () => {
  let alerted = dueAlerts(levels({ Board: 19 }), []).alerted;
  for (const percent of [22, 19, 60]) {
    const step = dueAlerts(levels({ Board: percent }), alerted);
    expect(step.due).toEqual([]);
    alerted = step.alerted;
  }
  expect(dueAlerts(levels({ Board: 18 }), alerted).due.map(device => device.name)).toEqual(['Board']);
});

test('a device that leaves keeps its alert state', () => {
  const gone = dueAlerts(levels({}), dueAlerts(levels({ Board: 15 }), []).alerted);
  expect(dueAlerts(levels({ Board: 15 }), gone.alerted).due).toEqual([]);
});
