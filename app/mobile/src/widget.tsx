/**
 * The Android home screen widget, drawn and driven from JavaScript by
 * react-native-android-widget (`JuiceWidget.kt` is its empty provider).
 *
 * It looks like the macOS widget: `widgetArt.ts` draws the whole of it as one
 * SVG for the size the launcher gives it. A press opens the app, which reads
 * the devices at once.
 *
 * A phone stops the app in the background, so there is no resident app to read
 * the devices for the widget, as on macOS. Every update instead runs as a
 * background task: it reads the connected devices through `JuiceBluetooth`
 * (`juiceBattery.ts`) and draws them. The app's own reads reach the widget
 * through `onSnapshot`, so a placed widget follows the window too.
 */
import React from 'react';
import {
  FlexWidget,
  registerWidgetTaskHandler,
  requestWidgetUpdate,
  SvgWidget,
  type WidgetInfo,
  type WidgetTaskHandlerProps,
} from 'react-native-android-widget';

import { type BatterySnapshot, lastSnapshot, onSnapshot, readBatteries } from './juiceBattery';
import { type Scheme, widgetDescription, widgetSvg } from './widgetArt';

/** The provider class's name, which is how the library addresses the widget. */
export const WIDGET_NAME = 'JuiceWidget';

const FILL = { width: 'match_parent', height: 'match_parent' } as const;

/** The task the library runs for every widget update and press, and the app's reads reach the widget. */
export function registerBackgroundTasks(): void {
  registerWidgetTaskHandler(handleWidgetTask);
  onSnapshot(snapshot => {
    requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: info => render(snapshot, info) }).catch(() => undefined);
  });
}

export async function handleWidgetTask({ widgetAction, widgetInfo, renderWidget }: WidgetTaskHandlerProps): Promise<void> {
  if (widgetAction === 'WIDGET_DELETED') {
    return;
  }
  const stored = await lastSnapshot().catch(() => null);
  if (stored !== null) {
    renderWidget(render(stored, widgetInfo));
  }
  try {
    renderWidget(render(await readBatteries(), widgetInfo));
  } catch {
    renderWidget(render(stored, widgetInfo));
  }
}

function render(snapshot: BatterySnapshot | null, info: WidgetInfo) {
  return { light: view(snapshot, info, 'light'), dark: view(snapshot, info, 'dark') };
}

function view(snapshot: BatterySnapshot | null, info: WidgetInfo, scheme: Scheme): React.JSX.Element {
  return (
    <FlexWidget clickAction="OPEN_APP" accessibilityLabel={widgetDescription(snapshot)} style={FILL}>
      <SvgWidget svg={widgetSvg(snapshot, info.width, info.height, scheme)} style={FILL} />
    </FlexWidget>
  );
}
