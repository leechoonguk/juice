# Juice — Project Guide

## Overview

**Juice** — a macOS menu bar battery monitor. It reads the battery of every
connected Bluetooth device (keyboard, mouse, trackpad, headphones, phone…),
shows a battery icon in the menu bar (filled to the lowest level, red when one is low) with a per-device menu, offers a
WidgetKit widget (small, medium, large) and sends a notification when a device
falls to a threshold (default 20%), re-arming once it has charged 5 points
above it. Some keyboards report their battery only as a HID report, which
needs Input Monitoring. The same window runs on Windows and Linux (Electron:
PowerShell `Get-PnpDevice` / BlueZ over D-Bus, tray, notifications) and Android
(the Kotlin `JuiceBluetooth` module, home-screen widget); the platform
table is in rule://app-native-boundary. Updates come from GitHub Releases of
`leechoonguk/juice`: Sparkle on macOS, electron-updater on Windows and Linux,
the release's APK on Android (rule://release).

| Part | Technology |
|---|---|
| Window | react-native-macos 0.83 (React, TypeScript, npm) — a second view of the same snapshot |
| Engine | Swift, React-free: IOBluetooth, IOKit HID, CoreBluetooth (LE 2A19), UserNotifications; publishes a snapshot to the App Group |
| Menu bar | `StatusItemController` (AppKit), part of the engine |
| Widget | WidgetKit extension, sandboxed; only displays the published snapshot |
| Updates | Sparkle (menu bar item and window button) |
| Windows/Linux | Electron (`app/desktop/`): the main process reads batteries (PowerShell `Get-PnpDevice` on Windows, BlueZ over D-Bus on Linux), tray, notifications, electron-updater; esbuild bundles the same window through react-native-web |
| Android | Kotlin `JuiceBluetooth` module + home-screen widget (react-native-android-widget) under `app/android/`, `app/mobile/src/` |

The layers between those parts are rule://app-native-boundary. `README.md` at
the project root is the front page; its widget pictures in `docs/` are made from
the widget's own views (rule://root-readme).

The `make verify` gate runs without Xcode; `make build`, `make run` and
`make pods` need it (rule://app-macos-project, "Running on This
Mac"). Native logic lives in React-free Swift so the gate still compiles and
tests it.

## Project Structure

```
Makefile                      the only entry point (rule://root-makefile)
README.md                     the front page, kept true to the code (rule://root-readme)
docs/                         the README's pictures: widgets-light.png, widgets-dark.png (`make widget-snapshots`)
app/                          React Native + react-native-macos, TypeScript, npm
  App.tsx, index.js           entry points
  metro.config.js             Metro defaults + the Android swaps of the native wrappers
  src/native/*.ts             typed wrappers over NativeModules (juiceBattery, appUpdates; backgroundTasks no-op; androidBluetooth, Android only)
  src/snapshot.ts             the shared, React-free snapshot rules: threshold, alerts, kinds
  src/updates.ts              release repository, version compare, APK URL
  src/battery.ts              pure display helpers for levels
  src/theme.ts                the window's palette
  src/screens/BatteryScreen.tsx   the window
  __tests__/                  jest tests (battery helpers, the screen)
  desktop/                    Windows/Linux Electron app: own package.json, build.ts (esbuild), src/ main + battery readers + preload + renderer swaps (rule://app-native-boundary)
  mobile/src/                 Android-only JS: juiceBattery, appUpdates, widget (swapped in by metro.config.js)
  android/                    Gradle project, Kotlin shell + the JuiceBluetooth native module (rule://tooling)
  react-native.config.js      keeps Android-only libraries out of macOS autolinking
  macos/
    Podfile
    Juice.xcodeproj                    targets, signing, App Group (rule://app-macos-project)
    Shared/BatterySnapshot.swift       compiled into both the app and the widget
    Juice-macOS/AppDelegate.swift      menu bar app entry (Juice.app)
    Juice-macOS/Native/Core/*.swift    React-free engine: BatteryReader, BatteryMonitor, RefreshPolicy (when to read), BluetoothEvents (what says a level changed), LowBatteryAlerts, HIDDescriptor, BatteryModel, StatusItemController, AppUpdates
    Juice-macOS/Native/*.swift, *.m    RN native module adapters (Swift + ObjC RCT_EXTERN)
    JuiceWidget/*.swift, Info.plist, *.entitlements   WidgetKit extension
    CoreTests/                         SwiftPM: JuiceCore tests, juice-probe, juice-icon, juice-widget-snapshots
.omp/                         rules/ hooks/ extensions/ skills/ (this harness)
.github/workflows/native.yml  CI: the Android APK and the macOS gate (rule://release)
.github/workflows/desktop.yml CI: the Windows and Linux installers (rule://release)
```

The boundary between those layers — what may import React, where the device
frameworks live, what a bridge file may hold — is rule://app-native-boundary.

## Commands

Everything runs through the `Makefile` at the repository root, which is the
project directory.

| Need | Command |
|---|---|
| Install | `make install` (npm and CocoaPods) |
| Unit gates while working | `make lint`, `make typecheck`, `make test`, `make swift-check`, `make swift-test` |
| Run the app as built (Xcode) | `make start` once, then `make run`; `make app-logs` to follow the app and the widget |
| Read batteries without the app | `make battery-probe` (every connected device, once, from the terminal) |
| The Mac's state (copies, widget registration, signing, Metro) | `make doctor` (read-only); `make run` drops stray copies and refuses to start Debug without Metro |
| App icon | `make app-icon` (rendered from `CoreTests/Icon`) |
| The README's pictures | `make widget-snapshots` (macOS) |
| Release (only when asked) | `make release bump=patch\|minor\|major` (`DRY_RUN=1` first); `make app-install` puts the published build in /Applications |
| Windows/Linux desktop app (not in `verify`) | `make desktop-install`, `make desktop-start`, `make desktop-typecheck`, `make desktop-dist v=x.y.z` |
| Android APK (not in `verify`) | `make android-apk v=x.y.z` (Android SDK + JDK 17) |
| One harness check | `make check-<name>` (listed by `make help`) |
| The whole gate | `make verify` — runs once, at commit, through `make commit` |
| Publish (only when asked) | `make commit m="type(scope): subject"`, `make push` |

Device facts are measured: say what a device reports only with the
`make battery-probe` output behind it (or a pinned fixture), otherwise mark it
unverified (rule://app-native-boundary); real device identifiers never enter
the tree (rule://code-layout). The edit guard's `// intent: replace` flag lives
in an edit body only, never in a file.

## Rules (`.omp/rules/`)

Domain rules live in `.omp/rules/` and are **never** imported here. There are
exactly three delivery channels, and only one of them puts a rule body in front
of the model on its own:

| Channel | Frontmatter | What actually reaches the model |
|---|---|---|
| Rulebook | `description` + `globs` | Only the line `- <name> (<globs>): <description>`. The body is read on demand via `rule://<name>` |
| Always-apply | `alwaysApply: true` | Full body in every session's system prompt — capped at 2 rules by `check-omp-rules` |
| TTSR trigger | `condition` (regex) + `scope` + `interruptMode` | Full body injected the moment a matching stream appears — an edit is aborted before it lands |

**`globs` do not deliver anything.** Editing a file that matches a rule's globs
injects nothing: measured, and stated in the harness docs (`globs` "is not used
to automatically select rulebook rules"). On a TTSR rule, `globs` is only a path
gate. So a rulebook rule is documentation of an invariant that a hook enforces
mechanically — the enforcement is the hook (`make verify`), never the listing.

`RULES.md` (this directory, not `rules/`) is the sticky always-apply rule.

Naming: `<scope>-<name>.md` with scope `app-`, `omp-` or `root-` (e.g.
`app-native-boundary.md`); a rule whose globs span several top-level
directories omits the prefix (`tooling.md`). Adding a rule = creating the file
only; no `@rules/` entry here. Every rule maps to a hook in the `omp-hooks.md`
table. A TTSR trigger additionally needs `omp ttsr test` proof that it fires on
the construct and stays quiet on prose (`check-omp-rules` runs it).

## Development Workflow

Before applying or modifying any code pattern for the first time, use **Context7** (`context7-mcp`) to look up relevant library/framework documentation. Query the library ID, fetch the current docs, and apply patterns based on verified content — not assumptions. This applies to React Native, react-native-macos, WidgetKit, IOBluetooth and CoreBluetooth (and the native-module bridge APIs `RCTBridgeModule`/`RCTEventEmitter` they meet at).
