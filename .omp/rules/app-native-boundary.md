---
description: React Native ↔ native boundary — logic in React-free Swift (Native/Core, Shared), adapters and bridge files stay thin, the widget imports no React and reads only the shared snapshot, screens reach native code through src/native wrappers, platform swaps keep the wrapper's shape
globs:
      - app/macos/Shared/*.swift
      - app/macos/Juice-macOS/Native/**/*.swift
      - app/macos/Juice-macOS/Native/*.m
      - app/macos/JuiceWidget/*.swift
      - app/macos/CoreTests/**/*.swift
      - app/src/**/*.ts
      - app/src/**/*.tsx
      - app/App.tsx
      - app/desktop/build.ts
      - app/desktop/src/**/*.ts
      - app/mobile/src/**/*.ts
      - app/mobile/src/**/*.tsx
      - app/metro.config.js
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
| JS wrappers | `app/src/native/*.ts` | One typed wrapper per native module (`JuiceBattery`, `AppUpdates` on macOS; `JuiceBluetooth` on Android) and the no-op `backgroundTasks` the Android bundle swaps for the widget | `react-native` (`NativeModules`, `NativeEventEmitter`) |
| JS transports | `app/desktop/src/renderer/*.ts`, `app/mobile/src/*.ts(x)` | The replacements swapped in for `app/src/native/*` by `desktop/build.ts` and `metro.config.js`; they reach the platform's readers (the preload bridge, `JuiceBluetooth`) and apply `app/src/snapshot.ts` — never the threshold or alert rules themselves | `react-native` (Android) or the preload bridge `window.juice` (desktop), `app/src/snapshot.ts`, `app/src/updates.ts` |
| Display helpers | `app/src/battery.ts`, `app/src/theme.ts` | Pure formatting and colours for the window | `react-native`-free TypeScript |
| Screens | `app/src/screens/*.tsx`, `app/App.tsx` | UI | the wrappers in `app/src/native/` — never `NativeModules` |

## Platforms

| Platform | Bundler | Reads batteries | `JuiceBattery` / `AppUpdates` | Extra |
|---|---|---|---|---|
| macOS | Metro (react-native-macos) | Swift: `BatteryReader` (IOBluetooth, HID reports, LE 2A19) | Swift native modules | menu bar item, WidgetKit widget, Sparkle updates |
| Windows, Linux | esbuild (`app/desktop/build.ts`), `react-native` → react-native-web | Electron main process, Node (`app/desktop/src/battery/`): PowerShell `Get-PnpDevice` on Windows, BlueZ over D-Bus on Linux | `app/desktop/src/renderer/{juiceBattery,appUpdates}.ts` call the preload bridge | tray menu, close-to-tray window, electron-updater |
| Android | Metro, `resolveRequest` in `app/metro.config.js` | Kotlin `JuiceBluetooth` (`app/android/`), wrapped by `app/src/native/androidBluetooth.ts` | `app/mobile/src/{juiceBattery,appUpdates}.ts` | home-screen widget (`mobile/src/widget.tsx`, swapped in for `backgroundTasks`), notifications through `JuiceBluetooth.notify` |

The three JS wrappers (`juiceBattery`, `appUpdates`, `backgroundTasks`) are the
only files swapped per platform, by the bundler, never by `Platform.OS` or file
suffixes. macOS holds the Swift engine described above; on the other platforms
the same JS API (`loadSnapshot`, `refreshBatteries`, `setThreshold`,
`permissions`, `openInputMonitoringSettings`; `updateInfo`, `checkForUpdates`)
is answered from the snapshot rules in `app/src/snapshot.ts`, so the threshold,
the re-arm margin and the alert text are the same everywhere. What each
non-macOS reader returns on real hardware is not measured by `verify`.

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
- **The widget draws shapes, not controls.** `ProgressView`, `Toggle`, `Slider`,
  `TextField` and `Picker` are AppKit-backed: WidgetKit and `ImageRenderer`
  cannot render them, so the widget gallery and the README's snapshots show a
  placeholder where the bar should be. A level bar is a `Capsule` or `Circle`
  stack; `check-app-native-boundary` rejects the controls in `JuiceWidget/`.
- **A swap keeps the wrapper's shape.** `app/desktop/build.ts` (Windows/Linux,
  `SWAPS`) and `app/metro.config.js` (Android, `ANDROID_SWAPS`) replace
  `app/src/native/*` modules. Each replacement exists and exports every runtime
  name of the module it replaces (and re-exports its types with
  `export type {…} from`), and a wrapper that reads a module macOS provides
  (`JuiceBattery`, `AppUpdates`) is replaced on both — neither bundle is built by
  `make verify`, so a missing export or swap fails only at launch. Keep each swap
  entry on one line (`[/\/native\/<module>$/, <path segments>]`): the check reads
  that shape.
- **A module only Android provides is imported from Android code only.**
  `JuiceBluetooth` is Kotlin (`app/android/…/com/uk/juice/bluetooth/`); its
  wrapper `app/src/native/androidBluetooth.ts` has no swap — nothing on macOS or
  the desktop bundle provides the module — so only `app/mobile/src/**` may
  import it. Shared code reaches batteries through `juiceBattery`, which the
  platforms swap.
- **One implementation per language.** Files under `app/desktop/src/` and
  `app/mobile/src/` must not re-declare any name exported by `app/src/snapshot.ts`
  (threshold clamp, alert rule, kind mapping), `app/src/updates.ts` (version
  compare, release URLs) or `app/src/battery.ts`: a second copy drifts from the
  shared one and the shared tests stop covering it. Import it.
- **An absent value crosses as an explicit null.** A payload sent to JavaScript
  with optional fields lists every key, sending `NSNull` for a value that is
  nil — never an omitted key. A synthesized `Codable` omits a nil key, the
  JavaScript `=== null` test then misses `undefined`, and the window printed
  `undefined%` with a full bar for a device that reports no level while every
  Swift and JS test passed. Each such payload is pinned by a Swift payload test
  asserting the nil case arrives as a key holding null (`CoreTests/Tests/`),
  and the TypeScript type declares the field `number | null`, not optional.
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
`make verify`) checks every convention above except the last two — the null
payload (pinned by its Swift test) and measured device facts (pinned by their
captures) — on code lines only: comments that explain the boundary may name what
it forbids. Claims 7 and 8 (the swaps and the one-implementation rule) read
`app/desktop/build.ts`, `app/metro.config.js` and the platform trees; a missing
swap file or a swap list the parser cannot read is reported, never skipped. The
whole check is dormant (cause `absent`) while `app/macos/` does not exist.

## Never Do These

- Import React, or use an `RCT…` type, in `Shared/`, `Native/Core/`, `JuiceWidget/` or `CoreTests/`
- Import CoreBluetooth, IOBluetooth or IOKit outside `Native/Core/`
- Put an `@implementation` or a method body in a `Native/*.m` file
- Add an adapter `@objc` method without its `RCT_EXTERN_METHOD`, or the reverse
- Read `NativeModules` in a screen or in `App.tsx`
- Share app ↔ widget state through `UserDefaults(suiteName:)`
- Define a method in a protocol extension that the protocol does not declare
- Encode a device battery layout that no `make battery-probe` capture backs
- Draw `ProgressView`, `Toggle`, `Slider`, `TextField` or `Picker` in the widget
- Replace a macOS-provided wrapper on one platform only, name a swap target that does not exist or lacks a runtime export of the wrapper
- Import `app/src/native/androidBluetooth.ts` from anywhere but `app/mobile/src/`
- Re-declare a function or constant `app/src/snapshot.ts`, `app/src/updates.ts` or `app/src/battery.ts` exports in `app/desktop/src/` or `app/mobile/src/`
- Omit a key for an absent value in a payload sent to JavaScript — send `NSNull`
