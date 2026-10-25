/**
 * The Android widget drawn as one SVG, laid out as the macOS widget lays itself
 * out (`app/macos/JuiceWidget/JuiceWidget.swift`): a ring per device — a plate
 * holding the device's icon, a track, and the charge arc from twelve o'clock,
 * green or red when low — in a grid (small), a row (medium) or a list (large).
 *
 * Each size is laid out in the macOS widget's own points and scaled to the cells
 * the launcher gives it, so the proportions match whatever the grid. The colours
 * are measured from `docs/widgets-*.png`. The icons are Material Icons
 * (Apache License 2.0): SF Symbols may not be drawn outside Apple's platforms.
 *
 * React Native–free: `widgetPreview.mts` draws the widget gallery's preview with it.
 */
import { isLow } from '../../src/battery';
import type { BatterySnapshot, DeviceLevel } from '../../src/native/juiceBattery';

export type WidgetFamily = 'small' | 'medium' | 'large';
export type Scheme = 'light' | 'dark';

interface Colors {
  background: string;
  plate: string;
  track: string;
  charge: string;
  low: string;
  label: string;
  secondary: string;
}

interface Box {
  width: number;
  height: number;
}

/** The macOS widget's sizes, in points; each Android size is drawn in one and scaled. */
export const REFERENCE: Record<WidgetFamily, Box> = {
  small: { width: 158, height: 158 },
  medium: { width: 338, height: 158 },
  large: { width: 338, height: 354 },
};

export const WIDGET_COLORS: Record<Scheme, Colors> = {
  light: {
    background: '#ffffff',
    plate: '#ebebeb',
    track: '#e6e6e6',
    charge: '#34c759',
    low: '#ff3b30',
    label: '#1d1d1f',
    secondary: '#8e8e93',
  },
  dark: {
    background: '#2b2b2b',
    plate: '#3c3c3c',
    track: '#404040',
    charge: '#30d158',
    low: '#ff453a',
    label: '#f5f5f7',
    secondary: '#8e8e93',
  },
};

/** What the widget draws before the app has read anything — the macOS widget's sample. */
export const SAMPLE_SNAPSHOT: BatterySnapshot = {
  devices: [
    { name: 'Keyboard', identifier: 'sample-1', percent: 18, parts: {}, source: null, note: null, kind: 'keyboard' },
    { name: 'Trackpad', identifier: 'sample-2', percent: 64, parts: {}, source: null, note: null, kind: 'trackpad' },
    { name: 'Headphones', identifier: 'sample-3', percent: 90, parts: {}, source: null, note: null, kind: 'headphones' },
  ],
  threshold: 20,
  updatedAt: 0,
};

/** Android 12's system widget corner radius, in dp. */
const CORNER = 16;
/** The macOS widget's default content margin. */
const MARGIN = 16;
const FONT = 'sans-serif';
const LINE = 1.2;

/** Material Icons paths on a 24-unit grid, by device kind (`deviceKind`). */
const ICONS: Record<DeviceLevel['kind'], string> = {
  keyboard:
    'M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z',
  mouse:
    'M13 1.07V9h7c0-4.08-3.05-7.44-7-7.93zM4 15c0 4.42 3.58 8 8 8s8-3.58 8-8v-4H4v4zm7-13.93C7.05 1.56 4 4.92 4 9h7V1.07z',
  trackpad:
    'M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74c-3.6-.76-3.54-.75-3.67-.75-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z',
  headphones:
    'M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z',
  phone: 'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z',
  speaker:
    'M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 1.99 2 1.99L17 22c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2c1.1 0 2 .9 2 2s-.9 2-2 2c-1.11 0-2-.9-2-2s.89-2 2-2zm0 16c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
  other:
    'M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z',
};
const WARNING = 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z';
const BATTERY_EMPTY =
  'M17 5v16c0 .55-.45 1-1 1H8c-.55 0-1-.45-1-1V5c0-.55.45-1 1-1h2V2h4v2h2c.55 0 1 .45 1 1zm-2 1H9v14h6V6z';

/** Which macOS size a widget of `width` × `height` dp is drawn as. */
export function widgetFamily(width: number, height: number): WidgetFamily {
  if (width < 250) {
    return 'small';
  }
  return height >= 250 ? 'large' : 'medium';
}

/**
 * The whole widget for `width` × `height` dp: the snapshot's devices that have a
 * level, lowest first — the sample before there is a snapshot.
 */
export function widgetSvg(snapshot: BatterySnapshot | null, width: number, height: number, scheme: Scheme): string {
  const family = widgetFamily(width, height);
  const reference = REFERENCE[family];
  const scale = Math.min(width / reference.width, height / reference.height);
  const left = (width - reference.width * scale) / 2;
  const top = (height - reference.height * scale) / 2;
  const colors = WIDGET_COLORS[scheme];
  const shown = snapshot ?? SAMPLE_SNAPSHOT;
  const devices = shown.devices.filter(device => device.percent !== null);
  const body =
    devices.length === 0 ? empty(reference, colors) : layout(family, devices, shown.threshold, reference, colors);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">` +
    `<rect width="${round(width)}" height="${round(height)}" rx="${CORNER}" fill="${colors.background}"/>` +
    `<g transform="translate(${round(left)} ${round(top)}) scale(${round(scale)})">${body}</g></svg>`
  );
}

/** The widget's shape, white on black: where a rasterised preview stays opaque. */
export function widgetMask(width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">` +
    `<rect width="${round(width)}" height="${round(height)}" fill="#000000"/>` +
    `<rect width="${round(width)}" height="${round(height)}" rx="${CORNER}" fill="#ffffff"/></svg>`
  );
}

/** What a screen reader says for the widget: every device drawn, with its level. */
export function widgetDescription(snapshot: BatterySnapshot | null): string {
  const shown = snapshot ?? SAMPLE_SNAPSHOT;
  const devices = shown.devices.filter(device => device.percent !== null);
  if (devices.length === 0) {
    return 'No connected device reports a battery';
  }
  return devices
    .map(device => `${device.name}, ${device.percent} percent${isLow(device, shown.threshold) ? ', low' : ''}`)
    .join('; ');
}

function layout(family: WidgetFamily, devices: DeviceLevel[], threshold: number, box: Box, colors: Colors): string {
  if (family === 'small') {
    return devices.length === 1 ? single(devices[0], threshold, box, colors) : grid(devices, threshold, box, colors);
  }
  return family === 'medium' ? row(devices, threshold, box, colors) : list(devices, threshold, box, colors);
}

/** One device: its ring large, with its name and level. */
function single(device: DeviceLevel, threshold: number, box: Box, colors: Colors): string {
  const diameter = 78;
  const lineWidth = 8;
  const ringBox = diameter + lineWidth;
  const height = ringBox + 8 + 10 * LINE + 1 + 15 * LINE;
  const top = (box.height - height) / 2;
  const centerX = box.width / 2;
  const nameTop = top + ringBox + 8;
  return (
    ring(device, threshold, centerX, top + ringBox / 2, diameter, lineWidth, colors) +
    text(fit(device.name, 10, 400, box.width - 2 * MARGIN), centerX, nameTop, 10, 400, colors.label, 'middle') +
    level(device, threshold, centerX, nameTop + 10 * LINE + 1, 15, 600, 'middle', colors)
  );
}

/** Up to four devices in a 2×2 grid, each ring with its level underneath. */
function grid(devices: DeviceLevel[], threshold: number, box: Box, colors: Colors): string {
  const diameter = 44;
  const lineWidth = 5;
  const ringBox = diameter + lineWidth;
  const cellHeight = ringBox + 3 + 12 * LINE;
  const cellWidth = ringBox;
  const shown = devices.slice(0, 4);
  const rows = Math.ceil(shown.length / 2);
  const width = cellWidth * 2 + 12;
  const height = rows * cellHeight + (rows - 1) * 10;
  const left = (box.width - width) / 2;
  const top = (box.height - height) / 2;
  return shown
    .map((device, index) => {
      const centerX = left + (index % 2) * (cellWidth + 12) + cellWidth / 2;
      const cellTop = top + Math.floor(index / 2) * (cellHeight + 10);
      return (
        ring(device, threshold, centerX, cellTop + ringBox / 2, diameter, lineWidth, colors) +
        level(device, threshold, centerX, cellTop + ringBox + 3, 12, 600, 'middle', colors)
      );
    })
    .join('');
}

/** Up to four rings in a row, each with its level and the device's name beneath. */
function row(devices: DeviceLevel[], threshold: number, box: Box, colors: Colors): string {
  const diameter = 56;
  const lineWidth = 6;
  const ringBox = diameter + lineWidth;
  const shown = devices.slice(0, 4);
  const columnWidth = (box.width - 2 * MARGIN - 6 * (shown.length - 1)) / shown.length;
  const height = ringBox + 3 + 12 * LINE + 3 + 10 * LINE;
  const top = (box.height - height) / 2;
  return shown
    .map((device, index) => {
      const centerX = MARGIN + index * (columnWidth + 6) + columnWidth / 2;
      const levelTop = top + ringBox + 3;
      return (
        ring(device, threshold, centerX, top + ringBox / 2, diameter, lineWidth, colors) +
        level(device, threshold, centerX, levelTop, 12, 600, 'middle', colors) +
        text(fit(device.name, 10, 400, columnWidth), centerX, levelTop + 12 * LINE + 3, 10, 400, colors.secondary, 'middle')
      );
    })
    .join('');
}

/** Up to six rows from the top: ring, name, level. */
function list(devices: DeviceLevel[], threshold: number, box: Box, colors: Colors): string {
  const diameter = 40;
  const lineWidth = 4.5;
  const ringBox = diameter + lineWidth;
  const nameLeft = MARGIN + ringBox + 12;
  return devices
    .slice(0, 6)
    .map((device, index) => {
      const top = MARGIN + index * (ringBox + 10);
      const lineTop = top + (ringBox - 13 * LINE) / 2;
      const levelWidth = levelTextWidth(device, threshold, 13, 500);
      return (
        ring(device, threshold, MARGIN + ringBox / 2, top + ringBox / 2, diameter, lineWidth, colors) +
        text(fit(device.name, 13, 400, box.width - MARGIN - nameLeft - levelWidth - 8), nameLeft, lineTop, 13, 400, colors.label, 'start') +
        level(device, threshold, box.width - MARGIN, lineTop, 13, 500, 'end', colors)
      );
    })
    .join('');
}

function empty(box: Box, colors: Colors): string {
  const size = 22;
  const top = (box.height - (size + 6 + 2 * 10 * LINE)) / 2;
  const lines = ['No connected device', 'reports a battery'];
  return (
    icon(BATTERY_EMPTY, box.width / 2 - size / 2, top, size, colors.secondary) +
    lines.map((line, index) => text(line, box.width / 2, top + size + 6 + index * 10 * LINE, 10, 400, colors.secondary, 'middle')).join('')
  );
}

/** The plate with the device's icon, the track, and the charge arc from twelve o'clock. */
function ring(
  device: DeviceLevel,
  threshold: number,
  centerX: number,
  centerY: number,
  diameter: number,
  lineWidth: number,
  colors: Colors,
): string {
  const radius = diameter / 2;
  const fraction = Math.min(Math.max((device.percent ?? 0) / 100, 0), 1);
  const circumference = 2 * Math.PI * radius;
  const iconSize = diameter * 0.5;
  const [x, y, r] = [round(centerX), round(centerY), round(radius)];
  const arc =
    fraction === 0
      ? ''
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${isLow(device, threshold) ? colors.low : colors.charge}" ` +
        `stroke-width="${lineWidth}" stroke-linecap="round" stroke-dasharray="${round(fraction * circumference)} ${round(circumference)}" ` +
        `transform="rotate(-90 ${x} ${y})"/>`;
  return (
    `<circle cx="${x}" cy="${y}" r="${round(radius - lineWidth)}" fill="${colors.plate}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${colors.track}" stroke-width="${lineWidth}"/>` +
    arc +
    icon(ICONS[device.kind], centerX - iconSize / 2, centerY - iconSize / 2, iconSize, colors.label)
  );
}

/** `51%`, with the warning icon before it when low; `anchor` places the pair. */
function level(
  device: DeviceLevel,
  threshold: number,
  x: number,
  top: number,
  size: number,
  weight: number,
  anchor: 'middle' | 'end',
  colors: Colors,
): string {
  const low = isLow(device, threshold);
  const width = levelTextWidth(device, threshold, size, weight);
  const start = anchor === 'middle' ? x - width / 2 : x - width;
  const warningSize = 10;
  const label = device.percent === null ? '—' : `${device.percent}%`;
  const warning = low ? icon(WARNING, start, top + (size * LINE - warningSize) / 2, warningSize, colors.label) : '';
  return warning + text(label, start + (low ? warningSize + 3 : 0), top, size, weight, colors.label, 'start');
}

function levelTextWidth(device: DeviceLevel, threshold: number, size: number, weight: number): number {
  const label = device.percent === null ? '—' : `${device.percent}%`;
  return textWidth(label, size, weight) + (isLow(device, threshold) ? 13 : 0);
}

function icon(path: string, left: number, top: number, size: number, color: string): string {
  return `<path d="${path}" fill="${color}" transform="translate(${round(left)} ${round(top)}) scale(${round(size / 24)})"/>`;
}

/** One line of text whose box starts at `top`. */
function text(
  value: string,
  x: number,
  top: number,
  size: number,
  weight: number,
  color: string,
  anchor: 'start' | 'middle' | 'end',
): string {
  const baseline = top + size * 0.95;
  return (
    `<text x="${round(x)}" y="${round(baseline)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" ` +
    `fill="${color}" text-anchor="${anchor}">${escape(value)}</text>`
  );
}

/** `value`, cut with an ellipsis where it would be wider than `width`. */
function fit(value: string, size: number, weight: number, width: number): string {
  if (textWidth(value, size, weight) <= width) {
    return value;
  }
  let cut = value;
  while (cut.length > 1 && textWidth(`${cut}…`, size, weight) > width) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

/** An estimate: SVG text cannot be measured before the widget host draws it. */
function textWidth(value: string, size: number, weight: number): number {
  return [...value].length * size * (weight >= 600 ? 0.6 : 0.56);
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
