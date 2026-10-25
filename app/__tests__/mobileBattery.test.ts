import { PermissionsAndroid, Platform } from 'react-native';

import { loadSnapshot, onSnapshot, permissions, refreshBatteries, setThreshold } from '../mobile/src/juiceBattery';
import type { BluetoothDevice } from '../src/native/androidBluetooth';

const mockNotify = jest.fn();
const mockConnectedDevices = jest.fn();
const mockReadLeBattery = jest.fn();
const mockStorage = new Map<string, string>();

jest.mock('../src/native/androidBluetooth', () => ({
  PERMISSION_ERROR: 'E_PERMISSION',
  connectedDevices: () => mockConnectedDevices(),
  readLeBattery: (address: string) => mockReadLeBattery(address),
  notify: (...args: unknown[]) => mockNotify(...args),
  onBluetoothChanged: () => () => undefined,
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockStorage.set(key, value);
  },
}));

const device = (n: number, name: string, level: number | null, deviceClass: number | null = null): BluetoothDevice => ({
  name,
  address: `AA:00:00:00:00:0${n}`,
  deviceClass,
  level,
  connected: true,
});

const KEYBOARD_CLASS = 0x0540;

beforeEach(() => {
  mockStorage.clear();
  mockNotify.mockReset();
  mockConnectedDevices.mockReset();
  mockReadLeBattery.mockReset().mockResolvedValue(null);
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
});

afterEach(() => jest.restoreAllMocks());

test('connected devices come back lowest level first, unreadable ones last, with their kind and source', async () => {
  mockConnectedDevices.mockResolvedValue([
    device(1, 'Plain Gadget', null),
    device(2, 'Desk Board', 80, KEYBOARD_CLASS),
    device(3, 'Pocket Buds', 35),
    { ...device(4, 'Paired Elsewhere', 10), connected: false },
  ]);

  const snapshot = await refreshBatteries();

  expect(snapshot.devices.map(({ name, percent, source, kind }) => ({ name, percent, source, kind }))).toEqual([
    { name: 'Pocket Buds', percent: 35, source: 'Android', kind: 'headphones' },
    { name: 'Desk Board', percent: 80, source: 'Android', kind: 'keyboard' },
    { name: 'Plain Gadget', percent: null, source: null, kind: 'other' },
  ]);
  expect(snapshot.devices[0].identifier).toBe('AA:00:00:00:00:03');
  expect(snapshot.devices[2].note).toMatch(/Neither Android nor .* reports a level/);
  expect(snapshot.threshold).toBe(20);
  expect(JSON.parse(mockStorage.get('juice.snapshot')!)).toEqual(snapshot);
});

test('a device Android reports no level for is read from its own LE battery service; one Android reports is not', async () => {
  mockConnectedDevices.mockResolvedValue([device(1, 'Desk Mouse', null), device(2, 'Pocket Buds', 35)]);
  mockReadLeBattery.mockImplementation(async (address: string) => (address === 'AA:00:00:00:00:01' ? 64 : null));

  const snapshot = await refreshBatteries();

  expect(snapshot.devices.map(({ name, percent, source }) => ({ name, percent, source }))).toEqual([
    { name: 'Pocket Buds', percent: 35, source: 'Android' },
    { name: 'Desk Mouse', percent: 64, source: 'LE' },
  ]);
  expect(mockReadLeBattery).toHaveBeenCalledTimes(1);
});

test('an LE read that fails leaves the device without a level, not the read failed', async () => {
  mockConnectedDevices.mockResolvedValue([device(1, 'Desk Mouse', null)]);
  mockReadLeBattery.mockRejectedValue(new Error('GATT error'));

  const snapshot = await refreshBatteries();

  expect(snapshot.devices[0]).toMatchObject({ name: 'Desk Mouse', percent: null });
});

test('a low device alerts once, and again only after it has charged clear of the threshold', async () => {
  const read = async (level: number) => {
    mockConnectedDevices.mockResolvedValue([device(1, 'Desk Board', level)]);
    await refreshBatteries();
  };

  await read(19);
  await read(15);
  expect(mockNotify).toHaveBeenCalledTimes(1);
  expect(mockNotify).toHaveBeenCalledWith('AA:00:00:00:00:01', 'Desk Board battery is low', '19% left');

  await read(24);
  await read(18);
  expect(mockNotify).toHaveBeenCalledTimes(1);

  await read(25);
  await read(17);
  expect(mockNotify).toHaveBeenCalledTimes(2);
  expect(mockNotify).toHaveBeenLastCalledWith('AA:00:00:00:00:01', 'Desk Board battery is low', '17% left');
});

test('a denied Bluetooth permission becomes a note, never a read or an alert', async () => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

  const snapshot = await refreshBatteries();

  expect(mockConnectedDevices).not.toHaveBeenCalled();
  expect(snapshot.devices).toHaveLength(1);
  expect(snapshot.devices[0]).toMatchObject({ name: 'Bluetooth', percent: null });
  expect(snapshot.devices[0].note).toMatch(/Allow Juice to use Bluetooth/);
  expect(mockNotify).not.toHaveBeenCalled();
});

test('only a refresh asks for permissions; a poll with the permission missing just reports it', async () => {
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  mockStorage.set('juice.snapshot', JSON.stringify({ devices: [], threshold: 20, updatedAt: 1 }));

  const snapshot = await loadSnapshot();

  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  expect(snapshot?.devices[0].note).toMatch(/Allow Juice/);
});

test('the threshold is kept, judges the last snapshot, and every read is published to listeners', async () => {
  mockConnectedDevices.mockResolvedValue([device(1, 'Desk Board', 30)]);
  const published: number[] = [];
  const stop = onSnapshot(snapshot => published.push(snapshot.threshold));

  await expect(setThreshold(40)).resolves.toBeNull();
  await refreshBatteries();
  expect(mockNotify).toHaveBeenCalledTimes(1);
  mockNotify.mockClear();
  const judged = await setThreshold(10);
  stop();

  expect(judged).toMatchObject({ threshold: 10 });
  expect(mockStorage.get('juice.threshold')).toBe('10');
  expect(published).toEqual([40, 10]);
  await expect(permissions()).resolves.toEqual({ inputMonitoring: true });
});
