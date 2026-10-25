import { PermissionsAndroid, Platform } from 'react-native';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { handleWidgetTask } from '../mobile/src/widget';
import type { BluetoothDevice } from '../src/native/androidBluetooth';

const mockNotify = jest.fn();
const mockStorage = new Map<string, string>();
let mockDevices: BluetoothDevice[] = [];

jest.mock('../src/native/androidBluetooth', () => ({
  PERMISSION_ERROR: 'E_PERMISSION',
  connectedDevices: async () => mockDevices,
  readLeBattery: async () => null,
  notify: (...args: unknown[]) => mockNotify(...args),
  onBluetoothChanged: () => () => undefined,
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockStorage.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockStorage.set(key, value);
  },
}));
jest.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  SvgWidget: 'SvgWidget',
  registerWidgetTaskHandler: jest.fn(),
  requestWidgetUpdate: jest.fn(async () => undefined),
}));

const update = (): Promise<void> =>
  handleWidgetTask({
    widgetAction: 'WIDGET_UPDATE',
    widgetInfo: { width: 338, height: 158 } as WidgetTaskHandlerProps['widgetInfo'],
    renderWidget: () => undefined,
  });

const keyboard = (level: number): BluetoothDevice => ({
  name: 'Desk Board',
  address: 'AA:00:00:00:00:01',
  deviceClass: 0x0540,
  level,
  connected: true,
});

beforeEach(() => {
  jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  mockStorage.clear();
  mockNotify.mockReset();
});

afterEach(() => jest.restoreAllMocks());

test('the periodic widget update reads the devices and alerts for a low one, once, with no app window open', async () => {
  mockDevices = [keyboard(12)];

  await update();
  await update();

  expect(JSON.parse(mockStorage.get('juice.snapshot')!).devices[0]).toMatchObject({ percent: 12 });
  expect(mockNotify).toHaveBeenCalledTimes(1);
  expect(mockNotify).toHaveBeenCalledWith('AA:00:00:00:00:01', 'Desk Board battery is low', '12% left');
});
