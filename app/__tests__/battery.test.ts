import {
  isLow,
  levelLabel,
  needsInputMonitoring,
  nextThreshold,
  partsLabel,
  sourceLabel,
  timeAgo,
} from '../src/battery';
import type { DeviceLevel } from '../src/native/juiceBattery';

function device(overrides: Partial<DeviceLevel>): DeviceLevel {
  return {
    name: 'Board',
    identifier: 'AA:00:00:00:00:01',
    percent: 50,
    parts: {},
    source: 'system',
    note: null,
    kind: 'keyboard',
    ...overrides,
  };
}

test('the threshold steps by five and stops at the bounds', () => {
  expect(nextThreshold(20, 1)).toBe(25);
  expect(nextThreshold(5, -1)).toBe(5);
  expect(nextThreshold(95, 1)).toBe(95);
});

test('a device is low at the threshold, never without a level', () => {
  expect(isLow(device({ percent: 20 }), 20)).toBe(true);
  expect(isLow(device({ percent: 21 }), 20)).toBe(false);
  expect(isLow(device({ percent: null }), 20)).toBe(false);
});

test('a level without a reading shows a dash', () => {
  expect(levelLabel(device({ percent: 7 }))).toBe('7%');
  expect(levelLabel(device({ percent: null }))).toBe('—');
});

test('several batteries list left, right, case, then the rest', () => {
  expect(partsLabel(device({ parts: { case: 40, other: 3, right: 88, left: 90 } }))).toBe(
    'left 90% · right 88% · case 40% · other 3%',
  );
  expect(partsLabel(device({ parts: {} }))).toBe('');
});

test('a device without a level explains why', () => {
  expect(sourceLabel(device({ source: 'HID report' }))).toBe('read from the device');
  expect(sourceLabel(device({ percent: null, source: null, note: 'reports no battery to this Mac' }))).toBe(
    'reports no battery to this Mac',
  );
});

test('elapsed time reads in minutes then hours', () => {
  expect(timeAgo(0, 59_000)).toBe('just now');
  expect(timeAgo(0, 3 * 60_000)).toBe('3 min ago');
  expect(timeAgo(0, 2 * 3_600_000)).toBe('2 h ago');
  expect(timeAgo(10_000, 0)).toBe('just now');
});

test('only an unread device held back by Input Monitoring asks for it', () => {
  const blocked = device({ percent: null, source: null, note: 'needs Input Monitoring to read its battery' });
  expect(needsInputMonitoring([device({}), blocked])).toBe(true);
  expect(needsInputMonitoring([device({ percent: null, source: null, note: 'reports no battery to this Mac' })])).toBe(
    false,
  );
});
