---
description: Xcode project for the macOS app (Juice) — every native source in its target, team signing, one App Group, one product name, a menu bar app that outlives its window, Bluetooth usage declared, one build location
globs:
      - app/macos/Juice.xcodeproj/project.pbxproj
      - app/macos/Juice-macOS/Info.plist
      - app/macos/Juice-macOS/AppDelegate.swift
      - app/macos/JuiceWidget/Info.plist
      - app/macos/**/*.entitlements
      - app/macos/Juice.xcworkspace/xcshareddata/WorkspaceSettings.xcsettings
      - Makefile
alwaysApply: false
---

# App macOS Project

## Why This Is Checked

Everything here builds cleanly when it is wrong. A source file left out of its
target links without it; an ad-hoc signature builds and launches; a stale
product name builds. Each one fails only at run time, on the Mac, as a
widget that shows a sample, a process killed at its first Bluetooth call, or an
app that quits when its window closes — and no compile step, test, or type check looks there. The
project file, the Info.plists and the entitlements are therefore checked as
files, by `check-app-macos-project`, in `make verify`.

## Targets and Trees

A target compiles exactly the sources under the directory of its own name, plus
`Shared/`:

| Target | Tree | Product |
|---|---|---|
| `Juice-macOS` | `app/macos/Juice-macOS/` + `app/macos/Shared/` | `Juice.app` — the menu bar app that reads every device's battery and alerts when one runs low |
| `JuiceWidget` | `app/macos/JuiceWidget/` + `app/macos/Shared/` | `JuiceWidget.appex` — the sandboxed widget, embedded in the app; it only displays the snapshot the app published |

`app/macos/CoreTests/` is a SwiftPM package (`make swift-test`, `make
battery-probe`, `make app-icon`, `make widget-snapshots`), not part of the Xcode project; it reaches the core
through symlinks, never by membership.

## Project Conventions

- **Every source is in its target.** A `.swift`/`.m` under a target's tree has
  a `PBXFileReference`, a `PBXBuildFile`, and an entry in that target's Sources
  phase; a file in `Shared/` is in both. A file that moves out of a tree, or is
  deleted, leaves no reference behind. A file needed by both targets lives in
  `Shared/` — never compiled across trees.
- **Signed by a team.** Every configuration that signs with entitlements names
  a `DEVELOPMENT_TEAM`. With an ad-hoc signature the App Group loses its team
  prefix and macOS refuses the shared container *without a prompt*, so the
  widget falls back to its sample instead of showing the app's batteries.
- **One App Group.** Both entitlements files and both Info.plists
  (`AppGroupIdentifier`) name the same `$(TeamIdentifierPrefix)juice`.
  The app publishes the snapshot the widget displays as a file in that
  container (`SharedStore`), never through `UserDefaults`.
- **One name.** The app target's `PRODUCT_NAME` and both `CFBundleDisplayName`s
  are equal. The widget gallery lists the containing bundle's name, so renaming
  only the display name leaves the widget listed under the old one.
- **A menu bar app outlives its window.** With `LSUIElement` set, the app
  delegate returns `false` from `applicationShouldTerminateAfterLastWindowClosed`
  — the widget only shows what the running app last published, and the menu
  bar item is the app.
- **Bluetooth is declared.** The app target uses CoreBluetooth and IOBluetooth,
  so its Info.plist carries `NSBluetoothAlwaysUsageDescription`; macOS kills the
  process at the first Bluetooth call without it. The app is not sandboxed
  (`Juice.entitlements` holds only the App Group), so it needs no
  `com.apple.security.device.bluetooth`; if its entitlements ever enable the
  sandbox, the check requires that entitlement too.
- **One build location.** Every build lands in `app/macos/build/DerivedData.noindex`:
  Xcode through the workspace's shared `WorkspaceSettings.xcsettings`
  (`WorkspaceRelativePath`, `build/DerivedData.noindex`), every `xcodebuild` in the root
  Makefile through `-derivedDataPath $(DERIVED_DATA)`, and the release builder
  (`app-release.ts`) through the same directory. Xcode's default DerivedData is
  keyed by the repository's path, so each move or clone left one more
  `Juice.app` that Spotlight, Launchpad and the widget gallery listed beside
  the installed one — three Juices on this Mac before the rule. The `.noindex`
  suffix keeps Spotlight out of the one build directory, and every Xcode build
  registers its app with Launch Services again: `make app-install` unregisters
  the build copies, `make clean` unregisters them before deleting them.

## Adding a New Native Source File

1. Create the file in the tree of the target that compiles it (`Shared/` when
   both do) and register it in `project.pbxproj` in the same change: one
   `PBXFileReference`, one `PBXBuildFile` per target, one entry in each
   target's Sources phase, one child in its group. Run
   `make check-app-macos-project`.
2. If the file is React-free (`Shared/`, `Native/Core/`, `JuiceWidget/`),
   run `make swift-check`; if it holds testable logic, cover it in
   `CoreTests/Tests/` and run `make swift-test` (rule://app-native-boundary).
3. Run `make build` — the first gate that links the targets.
4. Run `make run` and exercise the change on this Mac; follow it with
   `make app-logs` when the menu bar app or the widget misbehaves.

## Running on This Mac

- **Signing identity.** `make build` needs an *Apple Development* identity for
  the project's team in the login keychain (Xcode › Settings › Accounts ›
  Manage Certificates). If `security find-identity -v -p codesigning` lists
  none while the certificate is present, the keychain is missing Apple's WWDR
  G3 intermediate certificate.
- **Debug needs Metro.** The Debug build loads its JavaScript from Metro;
  without `make start` the app runs with an empty window; the menu bar item
  still reads and alerts, because those live in Swift.
- **`make run`** rebuilds, quits the running app (a menu bar app keeps the
  old build alive otherwise), re-registers the widget extension and restarts
  the widget host so the gallery and the placed widgets pick up the new build.
- **`make app-logs`** streams the log lines of the running app and its widget
  extension (`log stream`, filtered by process name).
- **`make battery-probe`** reads every connected device's battery once from the
  terminal through the app's own reader, without the app or React, to tell a
  reader fault from a UI one.
- **Bluetooth and Input Monitoring permission** are asked once per signing
  identity. A rebuilt app with the same team keeps them; an ad-hoc build is a new
  app every time. A keyboard's battery report needs Input Monitoring.
- **Editor diagnostics are not the gate.** SourceKit type-checks one file at a
  time, so a file in `Shared/`, `Native/Core/` or `JuiceWidget/` that uses a
  type from a sibling file reports "Cannot find '…' in scope". The
  authoritative answer is `make swift-check`, which compiles each tree as a
  whole; trust it over the editor.

## Enforcement

`check-app-macos-project` (`make check-app-macos-project`, part of
`make verify`) holds every Project Convention by reading the project, plist and
entitlements files — it builds nothing and contacts no device. It is dormant
(cause `absent`) while the Xcode project does not exist.

## Never Do These

- Add a `.swift`/`.m` under `app/macos/` without registering it in its target
- Compile a file from one target's tree into another — move it to `Shared/`
- Build with the team removed, or with a hardcoded team ID in an App Group
- Rename the app in one of `PRODUCT_NAME` / `CFBundleDisplayName` only
- Share state between the app and the widget through `UserDefaults(suiteName:)`
- Let the menu bar app terminate when its window closes
- Build with `react-native run-macos`, Xcode's default DerivedData, or an
  `xcodebuild` without `-derivedDataPath` — each leaves another Juice.app listed
- Delete a build directory without unregistering its app (`make clean` does both)
