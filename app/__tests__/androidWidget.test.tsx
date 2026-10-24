import type React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { registerWidgetTaskHandler, requestWidgetUpdate } from 'react-native-android-widget';

import { handleWidgetTask, registerBackgroundTasks, WIDGET_NAME } from '../mobile/src/widget';
import type { BatterySnapshot, DeviceLevel } from '../src/native/juiceBattery';

const mockReadBatteries = jest.fn();
const mockLastSnapshot = jest.fn();
const mockOnSnapshot = jest.fn();

jest.mock('../mobile/src/juiceBattery', () => ({
  readBatteries: () => mockReadBatteries(),
  lastSnapshot: () => mockLastSnapshot(),
  onSnapshot: (listener: unknown) => mockOnSnapshot(listener),
}));
jest.mock('react-native-android-widget', () => ({
  FlexWidget: 'FlexWidget',
  TextWidget: 'TextWidget',
  registerWidgetTaskHandler: jest.fn(),
  requestWidgetUpdate: jest.fn(async () => undefined),
}));

const level = (name: string, percent: number | null, note: string | null = null): DeviceLevel => ({
  name,
  identifier: `id-${name}`,
  percent,
  parts: {},
  source: percent === null ? null : 'Android',
  note,
  kind: 'other',
});

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

const snapshot = (devices: DeviceLevel[], updatedAt = minutesAgo(3)): BatterySnapshot => ({ devices, threshold: 20, updatedAt });

/** Every text a drawn widget shows, in order. */
function texts(element: React.ReactElement): string[] {
  const props = element.props as { text?: string; children?: unknown };
  const children = [props.children].flat(Infinity).filter(Boolean) as React.ReactElement[];
  return [...(props.text === undefined ? [] : [props.text]), ...children.flatMap(texts)];
}

/** Runs one task the way the library would, returning what it drew (light variant). */
async function run(props: Partial<WidgetTaskHandlerProps>): Promise<string[][]> {
  const drawn: string[][] = [];
  await handleWidgetTask({
    widgetAction: 'WIDGET_UPDATE',
    widgetInfo: {} as WidgetTaskHandlerProps['widgetInfo'],
    renderWidget: widget => drawn.push(texts((widget as { light: React.ReactElement }).light)),
    ...props,
  });
  return drawn;
}

beforeEach(() => {
  mockReadBatteries.mockReset();
  mockLastSnapshot.mockReset().mockResolvedValue(null);
  mockOnSnapshot.mockReset();
});

test('the widget draws the devices lowest first, with the low ones marked', async () => {
  mockReadBatteries.mockResolvedValue(snapshot([level('Keys', 15), level('Mouse', 80), level('Gadget', null)]));

  const drawn = await run({});

  expect(drawn).toEqual([['Juice', 'Updated 3 min ago', 'Refresh', 'Keys', '15%', ' Low', 'Mouse', '80%', 'Gadget', '—']]);
});

test('a Refresh press reads the devices again and draws what they report now', async () => {
  mockLastSnapshot.mockResolvedValue(snapshot([level('Keys', 15)], minutesAgo(30)));
  mockReadBatteries.mockResolvedValue(snapshot([level('Keys', 60)], Date.now()));

  const drawn = await run({ widgetAction: 'WIDGET_CLICK', clickAction: 'REFRESH' });

  expect(mockReadBatteries).toHaveBeenCalledTimes(1);
  expect(drawn[0]).toEqual(expect.arrayContaining(['Updated 30 min ago', '15%', 'Reading…']));
  expect(drawn[1]).toEqual(['Juice', 'Updated just now', 'Refresh', 'Keys', '60%']);
});

test('a read that fails keeps the last snapshot and says so', async () => {
  mockLastSnapshot.mockResolvedValue(snapshot([level('Keys', 15)]));
  mockReadBatteries.mockRejectedValue(new Error('no bluetooth'));

  const drawn = await run({});

  expect(drawn).toEqual([['Juice', 'Updated 3 min ago', 'Refresh', 'Keys', '15%', ' Low', "Couldn't read your devices"]]);
});

test('nothing connected, nothing readable, and a removed widget each draw what they should', async () => {
  mockReadBatteries.mockResolvedValueOnce(snapshot([]));
  expect((await run({}))[0]).toContain('No Bluetooth devices are connected.');

  mockReadBatteries.mockResolvedValueOnce(snapshot([level('Bluetooth', null, 'Allow Juice to use Bluetooth.')]));
  expect((await run({}))[0]).toContain('Allow Juice to use Bluetooth.');

  mockReadBatteries.mockClear();
  expect(await run({ widgetAction: 'WIDGET_DELETED' })).toEqual([]);
  expect(mockReadBatteries).not.toHaveBeenCalled();
});

test('the app publishes every read to the placed widgets', async () => {
  registerBackgroundTasks();
  expect(registerWidgetTaskHandler).toHaveBeenCalledWith(handleWidgetTask);

  const publish = mockOnSnapshot.mock.calls[0][0] as (value: BatterySnapshot) => void;
  publish(snapshot([level('Keys', 15)]));

  expect(requestWidgetUpdate).toHaveBeenCalledWith(expect.objectContaining({ widgetName: WIDGET_NAME }));
});
