---
description: React Native ↔ native boundary — logic in React-free Swift (Native/Core, Shared), adapters and bridge files stay thin, the widget imports no React and reads only the shared snapshot, screens reach native code through src/native wrappers
globs:
      - app/macos/Shared/*.swift
      - app/macos/Juice-macOS/Native/**/*.swift
      - app/macos/Juice-macOS/Native/*.m
      - app/macos/JuiceWidget/*.swift
      - app/macos/CoreTests/**/*.swift
      - app/src/**/*.ts
      - app/src/**/*.tsx
      - app/App.tsx
alwaysApply: false
---

# App Native Boundary

## Why The Line Exists

The `make verify` gate runs without Xcode, so the React Native adapters and the
app target are compiled only by `make build`, never by the gate. The native
gates in `verify` are `make swift-check`, which type-checks the Swift that needs
neither React nor CocoaPods, and `make swift-test`, which runs Swift Testing
over the same code. Logic placed in an adapter is therefore logic the gate
never compiles; the boundary keeps everything that can break inside what those
gates read. The Xcode project itself is checked as files by rule://app-macos-project.

## Layers

| Layer | Path | Holds | May import |
|---|---|---|---|
| Shared snapshot | `app/macos/Shared/*.swift` | `BatterySnapshot`, `DeviceLevel` and the App Group store compiled into both the app and the widget | Foundation, WidgetKit — never React |
| Battery engine | `app/macos/Juice-macOS/Native/Core/*.swift` | Reading every device's battery (`BatteryReader`: IOBluetooth, HID reports, LE 2A19 with notifications), when to read (`RefreshPolicy`: on the accessory power-source notifications Apple's Batteries widget reads on, Bluetooth connections, wake and a stale menu; a backstop poll only for what never announces), the event sources (`BluetoothEvents`), the monitor and snapshot publishing (`BatteryMonitor`), the low-battery rule (`LowBatteryAlerts`), the menu bar item (`StatusItemController`), the window's request to the updater (`AppUpdates`) | Foundation, AppKit, IOKit, IOBluetooth, CoreBluetooth, UserNotifications, WidgetKit, notify, os — never React |
| RN adapters | `app/macos/Juice-macOS/Native/*.swift` | Methods in, events out: translate between React Native and the engine (`JuiceBatteryModule`, `AppUpdatesModule`) | React, Foundation, AppKit — never CoreBluetooth, IOBluetooth or IOKit |
| Bridge files | `app/macos/Juice-macOS/Native/*.m` | `RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD` declarations of the adapter of the same stem | `<React/...>` headers |
| Widget | `app/macos/JuiceWidget/*.swift` | The WidgetKit extension: only displays the snapshot the app published | SwiftUI, WidgetKit — never React, never a device framework |
| Core tests | `app/macos/CoreTests/` | `Package.swift`; `Sources/JuiceCore/` (symlinks to `Shared/` and `Native/Core/`); `Tests/*.swift`, the Swift Testing suite `make swift-test` runs; the `juice-probe`, `juice-icon` and `juice-widget-snapshots` tools | Foundation, AppKit, SwiftUI, WidgetKit, Testing, `@testable import JuiceCore` — never React |
| JS wrappers | `app/src/native/*.ts` | One typed wrapper per native module (`JuiceBattery`, `AppUpdates`) | `react-native` (`NativeModules`, `NativeEventEmitter`) |
| Display helpers | `app/src/battery.ts`, `app/src/theme.ts` | Pure formatting and colours for the window | `react-native`-free TypeScript |
| Screens | `app/src/screens/*.tsx`, `app/App.tsx` | UI | the wrappers in `app/src/native/` — never `NativeModules` |

## Platform

macOS only. The menu bar app (`StatusItemController`) reads batteries and
alerts; the React Native window is a second view of the same snapshot; the
widget only displays it. There is no build for any other platform, so
nothing here is swapped per platform and no widget action reaches back into the
app.

## Conventions

- **React-free means compiled here.** `Shared/`, `Native/Core/`,
  `JuiceWidget/` and `CoreTests/` import no React module and name no `RCT`
  symbol; a React type in them breaks `make swift-check`, `make swift-test` and
  the widget extension's link.
- **One reader.** `CoreBluetooth`, `IOBluetooth` and `IOKit` are imported only
  under `Native/Core/`. An adapter that reads a device is untested logic; a
  widget that reads one is a second reader fighting the app's.
- **Bridge files declare, never implement.** A `Native/*.m` holds `#import`,
  comments, `RCT_EXTERN_MODULE`, `RCT_EXTERN_METHOD` (a signature may wrap
  across lines) and `@end` — no `@implementation`, no `{` body — and its stem
  matches the Swift adapter it exposes (`JuiceBatteryModule.m` →
  `JuiceBatteryModule.swift`).
- **Selectors agree both ways.** Every `@objc` instance method of an adapter
  has an `RCT_EXTERN_METHOD` with the same selector, and every declared
  selector has its `@objc` method. A method with arguments names its selector
  explicitly (`@objc(setThreshold:)`) so the two can be compared. A missing
  declaration leaves the method unreachable from JavaScript; a declaration
  without a method crashes at call time — and without Xcode neither fails a
  build here.
- **One door per native module.** Screens import the typed wrapper from
  `app/src/native/`; only the wrappers read `NativeModules`, so a renamed
  native method fails `make typecheck` in one file instead of at runtime in
  every screen. Tests in `app/__tests__/` may mock `NativeModules` — that is
  how a wrapper is tested without a native runtime.
- **App and widget share files, not defaults.** The snapshot crosses from the
  app to the widget through `SharedStore` — a JSON file in the App Group
  container — never `UserDefaults(suiteName:)`. cfprefsd refuses a suite shared
  with the sandboxed widget, and its change notifications never reach the other
  process; both fail silently.
- **Protocol extensions only default declared requirements.** A method that
  exists only in a protocol extension is statically dispatched: a conformer's
  own implementation is never called through the protocol, and nothing warns.
  Declare the method in the protocol, then give it a default in the extension.
- **Device facts are measured, not guessed.** How a device reports its battery
  (a HID report layout, an LE characteristic, a system property) comes from a
  `make battery-probe` read of the real device and is pinned in
  `CoreTests/Tests/` with the captured bytes. A layout with no capture behind it
  is a guess the device will not honour.

## Adding a Native Capability

1. If the capability reads a device, run `make battery-probe` against it first.
   Write the behaviour in `Native/Core/` (or the type in `Shared/`), pin the
   captured bytes in `CoreTests/Tests/`, and run `make swift-check` and
   `make swift-test` — it must compile and pass without React.
2. Expose it from the adapter in `Native/<Module>Module.swift` as a pure
   translation with an explicit `@objc(selector:)`, and declare the same
   selector in `Native/<Module>Module.m` with `RCT_EXTERN_METHOD`; run
   `make check-app-native-boundary`.
3. Add the typed function to `app/src/native/<module>.ts`, call it from the
   screen, and run `make typecheck` and `make test`.
4. If the widget shows it, add it to the snapshot in `Shared/`, read it in
   `JuiceWidget/` and run `make swift-check` again.

## Enforcement

`check-app-native-boundary` (`make check-app-native-boundary`, part of
`make verify`) checks the conventions above except the last on code lines only —
comments that explain the boundary may name what it forbids. It is dormant
(cause `absent`) while `app/macos/` does not exist.

## Never Do These

- Import React, or use an `RCT…` type, in `Shared/`, `Native/Core/`, `JuiceWidget/` or `CoreTests/`
- Import CoreBluetooth, IOBluetooth or IOKit outside `Native/Core/`
- Put an `@implementation` or a method body in a `Native/*.m` file
- Add an adapter `@objc` method without its `RCT_EXTERN_METHOD`, or the reverse
- Read `NativeModules` in a screen or in `App.tsx`
- Share app ↔ widget state through `UserDefaults(suiteName:)`
- Define a method in a protocol extension that the protocol does not declare
- Encode a device battery layout that no `make battery-probe` capture backs
