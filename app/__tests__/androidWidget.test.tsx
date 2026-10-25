import type React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { registerWidgetTaskHandler, requestWidgetUpdate } from 'react-native-android-widget';

import { handleWidgetTask, registerBackgroundTasks, WIDGET_NAME } from '../mobile/src/widget';
import { SAMPLE_SNAPSHOT, WIDGET_COLORS, widgetDescription, widgetFamily, widgetSvg } from '../mobile/src/widgetArt';
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
  SvgWidget: 'SvgWidget',
  registerWidgetTaskHandler: jest.fn(),
  requestWidgetUpdate: jest.fn(async () => undefined),
}));

const MEDIUM = { width: 338, height: 158 };

const level = (name: string, percent: number | null, kind: DeviceLevel['kind'] = 'other'): DeviceLevel => ({
  name,
  identifier: `id-${name}`,
  percent,
  parts: {},
  source: percent === null ? null : 'Android',
  note: null,
  kind,
});

const snapshot = (devices: DeviceLevel[]): BatterySnapshot => ({ devices, threshold: 20, updatedAt: 0 });

/** The texts an SVG draws, in order. */
const texts = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(match => match[1]);
/** The charge arcs an SVG draws, by colour. */
const arcs = (svg: string): string[] => [...svg.matchAll(/stroke="(#[0-9a-f]+)"[^>]*stroke-dasharray/g)].map(match => match[1]);
const dark = WIDGET_COLORS.dark;

/** The SVG a drawn widget carries (light variant). */
function svgOf(widget: unknown): string {
  const light = (widget as { light: React.ReactElement<{ children: React.ReactElement<{ svg: string }> }> }).light;
  return light.props.children.props.svg;
}

async function run(props: Partial<WidgetTaskHandlerProps> = {}): Promise<string[]> {
  const drawn: string[] = [];
  await handleWidgetTask({
    widgetAction: 'WIDGET_UPDATE',
    widgetInfo: MEDIUM as WidgetTaskHandlerProps['widgetInfo'],
    renderWidget: widget => drawn.push(svgOf(widget)),
    ...props,
  });
  return drawn;
}

beforeEach(() => {
  mockReadBatteries.mockReset();
  mockLastSnapshot.mockReset().mockResolvedValue(null);
  mockOnSnapshot.mockReset();
});

test('the launcher\'s cells pick the macOS size: narrow is small, short is medium, tall is large', () => {
  expect(widgetFamily(170, 170)).toBe('small');
  expect(widgetFamily(598, 207)).toBe('medium');
  expect(widgetFamily(338, 354)).toBe('large');
});

test('the medium widget draws a ring per device with a level, lowest first, named underneath', () => {
  const svg = widgetSvg(
    snapshot([level('Keys', 15, 'keyboard'), level('Mouse', 80, 'mouse'), level('Gadget', null)]),
    MEDIUM.width,
    MEDIUM.height,
    'dark',
  );

  expect(texts(svg)).toEqual(['15%', 'Keys', '80%', 'Mouse']);
  expect(arcs(svg)).toEqual([dark.low, dark.charge]);
});

test('a low device carries the warning mark and a red arc; the rest stay green', () => {
  const low = widgetSvg(snapshot([level('Keys', 20)]), 170, 170, 'light');
  const fine = widgetSvg(snapshot([level('Keys', 21)]), 170, 170, 'light');

  expect(arcs(low)).toEqual([WIDGET_COLORS.light.low]);
  expect(low).toContain('M1 21h22L12 2 1 21z');
  expect(arcs(fine)).toEqual([WIDGET_COLORS.light.charge]);
  expect(fine).not.toContain('M1 21h22L12 2 1 21z');
});

test('each size shows as many devices as the macOS widget: one large or a 2×2 grid, four in a row, six in a list', () => {
  const many = snapshot(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, index) => level(name, 30 + index)));

  expect(texts(widgetSvg(snapshot([level('Solo', 50)]), 170, 170, 'dark'))).toEqual(['Solo', '50%']);
  expect(arcs(widgetSvg(many, 170, 170, 'dark'))).toHaveLength(4);
  expect(arcs(widgetSvg(many, MEDIUM.width, MEDIUM.height, 'dark'))).toHaveLength(4);
  expect(texts(widgetSvg(many, 338, 354, 'dark'))).toEqual(['A', '30%', 'B', '31%', 'C', '32%', 'D', '33%', 'E', '34%', 'F', '35%']);
});

test('before any read the widget shows the sample, as on macOS; with nothing to show it says so', () => {
  expect(texts(widgetSvg(null, MEDIUM.width, MEDIUM.height, 'dark'))).toEqual(
    SAMPLE_SNAPSHOT.devices.flatMap(device => [`${device.percent}%`, device.name]),
  );
  expect(texts(widgetSvg(snapshot([level('Gadget', null)]), MEDIUM.width, MEDIUM.height, 'dark'))).toEqual([
    'No connected device',
    'reports a battery',
  ]);
});

test('a long name is cut to its column, never drawn over the next one', () => {
  const svg = widgetSvg(
    snapshot([1, 2, 3, 4].map(index => level(`Very Long Device Name Number ${index}`, 50))),
    MEDIUM.width,
    MEDIUM.height,
    'dark',
  );

  for (const name of texts(svg).filter(value => value.startsWith('Very'))) {
    expect(name.endsWith('…')).toBe(true);
  }
});

test('the drawing fills the cells it is given, keeping the macOS proportions', () => {
  const svg = widgetSvg(snapshot([level('Keys', 40)]), 598, 207, 'dark');

  expect(svg).toContain('viewBox="0 0 598 207"');
  expect(svg).toMatch(/scale\(1\.31\)/);
});

test('a screen reader hears every device drawn and which are low', () => {
  expect(widgetDescription(snapshot([level('Keys', 15), level('Mouse', 80), level('Gadget', null)]))).toBe(
    'Keys, 15 percent, low; Mouse, 80 percent',
  );
});

test('an update draws the stored snapshot at once, then what the devices report now', async () => {
  mockLastSnapshot.mockResolvedValue(snapshot([level('Keys', 15)]));
  mockReadBatteries.mockResolvedValue(snapshot([level('Keys', 60)]));

  const drawn = await run();

  expect(drawn.map(texts)).toEqual([['15%', 'Keys'], ['60%', 'Keys']]);
});

test('a read that fails keeps the last snapshot on the widget', async () => {
  mockLastSnapshot.mockResolvedValue(snapshot([level('Keys', 15)]));
  mockReadBatteries.mockRejectedValue(new Error('Bluetooth is off'));

  const drawn = await run();

  expect(drawn.map(texts)).toEqual([['15%', 'Keys'], ['15%', 'Keys']]);
});

test('a removed widget reads nothing', async () => {
  expect(await run({ widgetAction: 'WIDGET_DELETED' })).toEqual([]);
  expect(mockReadBatteries).not.toHaveBeenCalled();
});

test('the app\'s reads redraw every placed widget at its own size', async () => {
  registerBackgroundTasks();
  expect(registerWidgetTaskHandler).toHaveBeenCalledWith(handleWidgetTask);

  mockOnSnapshot.mock.calls[0][0](snapshot([level('Keys', 70)]));
  const request = (requestWidgetUpdate as jest.Mock).mock.calls[0][0];
  expect(request.widgetName).toBe(WIDGET_NAME);
  expect(texts(svgOf(await request.renderWidget({ width: 170, height: 170 })))).toEqual(['Keys', '70%']);
});
