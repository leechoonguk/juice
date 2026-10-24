import React from 'react';
import { NativeModules, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { BatteryScreen } from '../src/screens/BatteryScreen';
import type { BatterySnapshot } from '../src/native/juiceBattery';

const snapshot: BatterySnapshot = {
  devices: [
    { name: 'Board', identifier: 'a', percent: 15, parts: {}, source: 'HID report', note: null, kind: 'keyboard' },
    {
      name: 'Buds',
      identifier: 'b',
      percent: 40,
      parts: { left: 90, case: 40 },
      source: 'system',
      note: null,
      kind: 'headphones',
    },
    {
      name: 'Speaker',
      identifier: 'c',
      percent: null,
      parts: {},
      source: null,
      note: 'reports no battery to this Mac',
      kind: 'other',
    },
  ],
  threshold: 20,
  updatedAt: Date.now(),
};

const juiceBattery = {
  snapshot: jest.fn(),
  refresh: jest.fn(),
  setThreshold: jest.fn(),
  permissions: jest.fn(),
  openInputMonitoringSettings: jest.fn(),
};
const appUpdates = { info: jest.fn(), check: jest.fn() };
let mounted: ReactTestRenderer.ReactTestRenderer | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  juiceBattery.snapshot.mockResolvedValue(snapshot);
  juiceBattery.refresh.mockResolvedValue(snapshot);
  juiceBattery.permissions.mockResolvedValue({ inputMonitoring: true });
  appUpdates.info.mockResolvedValue({ version: '1.2.3', canCheck: true });
  NativeModules.JuiceBattery = juiceBattery;
  NativeModules.AppUpdates = appUpdates;
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted?.unmount();
  });
  mounted = undefined;
});

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  // Async, so the snapshot, permission and version loads settle inside act.
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(<BatteryScreen />);
  });
  return mounted!;
}

function texts(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
}

async function press(renderer: ReactTestRenderer.ReactTestRenderer, testID: string): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await renderer.root.findByProps({ testID }).props.onPress();
  });
}

test('every device shows its level, a low one marked as low', async () => {
  const screen = await render();
  const labels = screen.root
    .findAll(node => typeof node.props.accessibilityLabel === 'string')
    .map(node => node.props.accessibilityLabel);
  expect(labels).toEqual(expect.arrayContaining(['Board, 15%, low', 'Buds, 40%', 'Speaker, —']));
  expect(texts(screen)).toEqual(expect.arrayContaining(['left 90% · case 40% — reported by macOS']));
});

test('the threshold steps through the native side and shows what it stored', async () => {
  juiceBattery.setThreshold.mockResolvedValue({ ...snapshot, threshold: 25 });
  const screen = await render();
  await press(screen, 'threshold-up');
  expect(juiceBattery.setThreshold).toHaveBeenCalledWith(25);
  expect(screen.root.findByProps({ testID: 'threshold' }).props.children).toEqual([25, '%']);
});

test('refresh reads the devices again', async () => {
  juiceBattery.refresh.mockResolvedValue({ ...snapshot, devices: [] });
  const screen = await render();
  await press(screen, 'refresh');
  expect(juiceBattery.refresh).toHaveBeenCalledTimes(1);
  expect(texts(screen)).toContain('No Bluetooth devices are connected.');
});

test('without Input Monitoring the screen offers its settings', async () => {
  juiceBattery.permissions.mockResolvedValue({ inputMonitoring: false });
  const screen = await render();
  await press(screen, 'input-monitoring');
  expect(juiceBattery.openInputMonitoringSettings).toHaveBeenCalled();
});

test('a failed read is shown, not swallowed', async () => {
  juiceBattery.refresh.mockRejectedValue(new Error('Bluetooth is off'));
  const screen = await render();
  await press(screen, 'refresh');
  expect(texts(screen)).toContain('Error: Bluetooth is off');
});
