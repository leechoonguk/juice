/**
 * The Android home screen widget, drawn and driven from JavaScript by
 * react-native-android-widget (`JuiceWidget.kt` is its empty provider).
 *
 * A phone stops the app in the background, so there is no resident app to read
 * the devices for the widget, as on macOS. Every update and press instead runs
 * as a background task: it reads the connected devices through
 * `JuiceBluetooth` (`juiceBattery.ts`) and draws them, lowest level first. The
 * app's own reads reach the widget through `onSnapshot`, so a placed widget
 * follows the window too.
 */
/* eslint-disable react-native/no-inline-styles -- widget styles are props of the widget library, not StyleSheet styles */
import React from 'react';
import {
  FlexWidget,
  registerWidgetTaskHandler,
  requestWidgetUpdate,
  TextWidget,
  type WidgetTaskHandlerProps,
} from 'react-native-android-widget';

import { isLow, levelLabel, timeAgo } from '../../src/battery';
import { type Palette, PALETTES } from '../../src/theme';
import { type BatterySnapshot, type DeviceLevel, lastSnapshot, onSnapshot, readBatteries } from './juiceBattery';

/** The provider class's name, which is how the library addresses the widget. */
export const WIDGET_NAME = 'JuiceWidget';

/** The click action of the Refresh button. */
const REFRESH = 'REFRESH';

/** What fits a 4×2 widget; the rest is counted. */
const MAX_ROWS = 3;

/** What the widget says under the list when a read failed or is running. */
type Status = 'reading' | 'failed' | null;

/** The task the library runs for every widget update and press, and the app's reads reach the widget. */
export function registerBackgroundTasks(): void {
  registerWidgetTaskHandler(handleWidgetTask);
  onSnapshot(snapshot => {
    requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => render(snapshot, null) }).catch(() => undefined);
  });
}

export async function handleWidgetTask({
  widgetAction,
  clickAction,
  renderWidget,
}: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED') {
    return;
  }
  const stored = await lastSnapshot().catch(() => null);
  if (clickAction === REFRESH) {
    renderWidget(render(stored, 'reading'));
  }
  try {
    renderWidget(render(await readBatteries(), null));
  } catch {
    renderWidget(render(stored, 'failed'));
  }
}

function render(snapshot: BatterySnapshot | null, status: Status) {
  return { light: view(snapshot, status, PALETTES.light), dark: view(snapshot, status, PALETTES.dark) };
}

function view(snapshot: BatterySnapshot | null, status: Status, colors: Palette): React.JSX.Element {
  const devices = snapshot?.devices ?? [];
  const shown = devices.slice(0, MAX_ROWS);
  const hidden = devices.length - shown.length;
  const unread = devices.length > 0 && devices.every(device => device.percent === null);
  const note = status === 'failed' ? "Couldn't read your devices" : status === 'reading' ? 'Reading…' : null;
  return (
    <FlexWidget clickAction="OPEN_APP" style={{ ...panel(colors), flexDirection: 'column', justifyContent: 'flex-start' }}>
      <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}>
        <FlexWidget style={{ flexDirection: 'column' }}>
          <TextWidget text="Juice" style={{ fontSize: 15, fontWeight: '600', color: colors.label }} />
          <TextWidget
            text={snapshot === null ? 'Open Juice to read your devices' : `Updated ${timeAgo(snapshot.updatedAt, Date.now())}`}
            style={{ fontSize: 11, color: colors.secondaryLabel }}
          />
        </FlexWidget>
        {refreshButton(colors)}
      </FlexWidget>
      {snapshot !== null && devices.length === 0 && (
        <TextWidget text="No Bluetooth devices are connected." style={{ fontSize: 12, color: colors.secondaryLabel }} />
      )}
      {shown.map(device => row(device, snapshot?.threshold ?? 0, colors))}
      {hidden > 0 && <TextWidget text={`+${hidden} more`} style={{ fontSize: 11, color: colors.tertiaryLabel }} />}
      {unread && devices[0].note !== null && (
        <TextWidget text={devices[0].note} maxLines={2} style={{ fontSize: 11, color: colors.secondaryLabel }} />
      )}
      {note !== null && (
        <TextWidget text={note} style={{ fontSize: 11, color: status === 'failed' ? colors.low : colors.secondaryLabel }} />
      )}
    </FlexWidget>
  );
}

/** One device: its name, its level, and a mark when the level is at or below the threshold. */
function row(device: DeviceLevel, threshold: number, colors: Palette): React.JSX.Element {
  const low = isLow(device, threshold);
  return (
    <FlexWidget
      key={device.identifier}
      style={{ flexDirection: 'row', width: 'match_parent', justifyContent: 'space-between', alignItems: 'center' }}
    >
      <TextWidget text={device.name} maxLines={1} truncate="END" style={{ fontSize: 13, color: colors.label }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        <TextWidget
          text={levelLabel(device)}
          style={{ fontSize: 13, fontWeight: '600', color: low ? colors.low : colors.label }}
        />
        {low && <TextWidget text=" Low" style={{ fontSize: 11, fontWeight: '600', color: colors.low }} />}
      </FlexWidget>
    </FlexWidget>
  );
}

function refreshButton(colors: Palette): React.JSX.Element {
  return (
    <FlexWidget
      clickAction={REFRESH}
      accessibilityLabel="Refresh"
      style={{
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.track,
      }}
    >
      <TextWidget text="Refresh" style={{ fontSize: 12, fontWeight: '600', color: colors.label }} />
    </FlexWidget>
  );
}

function panel(colors: Palette) {
  return {
    height: 'match_parent' as const,
    width: 'match_parent' as const,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.window,
  };
}
