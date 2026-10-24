package com.uk.juice.widget

import com.reactnativeandroidwidget.RNWidgetProvider

/**
 * The home screen widget. It holds no logic: react-native-android-widget hands
 * every update and press to JavaScript (`mobile/src/widget.tsx`), which reads
 * the connected devices through `JuiceBluetooth` and draws them.
 */
class JuiceWidget : RNWidgetProvider()
