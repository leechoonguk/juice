---
description: Project Makefile — the one entry point for install, run, the gates, the harness checks and publishing
globs:
      - Makefile
alwaysApply: false
---

# Project Makefile Usage

## Overview

`Makefile` at the repository root is the only way commands run in this project. It
owns the npm and CocoaPods installs, Metro, the Xcode build, the five app gates
(`lint`, `typecheck`, `test`, `swift-check`, `swift-test`), one `check-*` target per harness
post hook, and the publish path. Run it from the repository root, which is the
project directory.

`strict-command-routing` blocks the direct tool invocations these targets own
(`npx tsc`, `npx eslint`, `npx jest`, `swiftc -typecheck`, `pod install`,
`xcodebuild`, the React Native CLI), so every run uses the flags the gate uses.

## Self-Documenting Targets

Every target carries a `## <description>` on its header line. `make help` greps
those descriptions, so a target without one exists but cannot be found - and an
undiscoverable target is re-invented as a raw command. `check-makefiles`
enforces it.

## Verify Membership

`make verify` is the gate: `make commit` and `make push` depend on it, and
`strict-verified-git` reruns it before any raw `git commit`/`git push`. A
`check-*` target that exists but is not a prerequisite of `verify` passes when
run by hand and is never run by the gate. The contract, enforced by
`check-makefiles`:

- Every `check-<name>` target whose recipe runs `node .omp/hooks/post/...`
  **must** be a prerequisite of `verify` — except `check-verify`, which runs
  `make verify` itself and would recurse. That exemption is named in
  `check-makefiles` (`GATE_RUNNER`), not inferred.
- The `make verify` row in the table below lists **exactly** the Makefile's
  prerequisites, joined by ` + `. The doc is the reviewable contract, the
  Makefile is the executed one — `check-makefiles` diffs them in both
  directions, so editing one without the other fails the gate.

Adding a post hook therefore touches four places: the hook file, its
`check-<name>` target, the `verify:` prerequisite list, and this table (its own
row plus the `make verify` row).

## Makefile Targets

| Target | Command | Purpose |
|---|---|---|
| `make help` | `grep -E '^[a-zA-Z_-]+:.*?## .*'` | Show this help |
| `make install` | `cd app && npm ci` + `make pods` | Install JS dependencies, then CocoaPods |
| `make pods` | `cd app/macos && pod install` | Install CocoaPods for the macOS app (requires Xcode) |
| `make start` | `cd app && npx react-native start` | Start the Metro bundler |
| `make run` | `app-doctor.ts metro` + `make build` + `pkill -x Juice` + `app-launch-services.ts unregister-others <Debug Juice.app>` + `pluginkit -a <JuiceWidget.appex>` + `open <Juice.app>` + `killall chronod` | Build and launch the macOS app with its widget. Fails first, before the build, when nothing answers on 8081 — Debug loads its JS from Metro, so without it the window is empty (`make start`, or `make app-install` for a Release). A menu bar app keeps the old build alive and the widget host caches the old extension, so both are replaced; every registered copy except `/Applications/Juice.app` and the Debug build is unregistered by absolute path, because the widget host prefers a copy with a higher version (requires Xcode) |
| `make build` | `xcodebuild -workspace … -scheme Juice-macOS -configuration Debug -derivedDataPath app/macos/build/DerivedData.noindex build` | Build the macOS app and widget extension, Debug, into the one build location (requires Xcode; `rule://app-macos-project`) |
| `make app-logs` | `log stream --predicate 'process == "Juice" OR process == "JuiceWidget"'` | Stream the log lines of the running app and its widget extension (`rule://app-macos-project`) |
| `make typecheck` | `cd app && npx tsc --noEmit` | Type-check TypeScript (`tsc`) — the app's sources |
| `make lint` | `cd app && npx eslint .` | Lint TypeScript (`eslint`) — the app's sources |
| `make test` | `cd app && npx jest` | Run JS tests (`jest`) — the app's tests |
| `make swift-check` | `swiftc -typecheck` over `Shared/` + `Native/Core/`, then `Shared/` + `JuiceWidget/` | Type-check the React-free Swift sources against the Command Line Tools SDK — the native gate that runs without Xcode |
| `make swift-test` | `swift test --package-path app/macos/CoreTests` + the Command Line Tools' Swift Testing plugin/framework paths | Run the Swift Testing suite over the React-free Swift (`Shared/` + `Native/Core/`, symlinked into the package) — the native behaviour gate that runs without Xcode |
| `make battery-probe` | `swift run --package-path app/macos/CoreTests juice-probe $(ARGS)` | Read every connected device's battery once from the terminal through the app's own `BatteryReader`, without React — one line per device with its level and source; not a `verify` gate (needs hardware) |
| `make app-icon` | `swift run --package-path app/macos/CoreTests juice-icon <AppIcon.appiconset>` | Render the app icon from its Swift drawing into the asset catalog's PNG set (`CoreTests/Icon`) — the icon is code, so it is regenerated, never hand-edited |
| `make widget-snapshots` | `swift run --package-path app/macos/CoreTests juice-widget-snapshots docs` | Render `docs/widgets-light.png` and `docs/widgets-dark.png` from the widget's own views with SwiftUI's `ImageRenderer` — requires macOS (`rule://root-readme`) |
| `make demo` | `swift run --package-path app/macos/CoreTests juice-widget-snapshots --demo docs/demo.gif` | Record `docs/demo.gif`, the README's moving demo: the widget's own views over a scripted desk of made-up devices, frame by frame, encoded by ffmpeg — requires macOS and ffmpeg (`rule://root-readme`) |
| `make desktop-install` | `cd app/desktop && npm ci` | Install the Windows/Linux desktop app's dependencies (Electron, electron-builder, esbuild, react-native-web) — not in `verify`, which must not need them |
| `make desktop-build` | `node app/desktop/build.ts` | Bundle the Windows/Linux desktop app into `app/desktop/out`: the main process (which reads the batteries), the preload script and the window — `app/App.tsx` itself, with `react-native` resolved to react-native-web (through `app/desktop/src/renderer/reactNative.ts`) and the two native wrappers swapped for the preload bridge (`app/desktop/src/renderer/`) — not in `verify` |
| `make desktop-start` | `make desktop-build` + `cd app/desktop && npx electron .` | Run the desktop app from its bundle (Windows/Linux; on macOS `make run` is the app) — not in `verify` |
| `make desktop-typecheck` | `cd app/desktop && npx tsc --noEmit -p tsconfig.json` | Type-check the desktop app against DOM and Node types — not in `verify`, which must not need `make desktop-install`; CI runs it |
| `make desktop-dist` | `make desktop-build` + `cd app/desktop && npx electron-builder --publish never` | Package this OS's installers into `app/desktop/release` — NSIS on Windows, AppImage + deb on Linux; `v=x.y.z` sets the version. Not in `verify`; CI attaches them to the GitHub release `make release` publishes (`.github/workflows/desktop.yml`) |
| `make android-apk` | `cd app/android && ./gradlew assembleRelease -PjuiceVersionName=$(v)` | Build the Android APK — Release (bundled JS, Hermes) signed with the template's public debug key, so it installs by hand but is not a store build; `v=x.y.z` sets `versionName` and `versionCode` (`x*10000+y*100+z`). Needs the Android SDK and JDK 17; not in `verify`; CI attaches it to the GitHub release (`.github/workflows/native.yml`) |
| `make verify` | `lint + typecheck + test + swift-check + swift-test + check-app-duplicate-blocks + check-app-macos-project + check-app-native-boundary + check-code-layout + check-makefiles + check-omp-hooks + check-omp-probes + check-omp-rules + check-omp-skills + check-omp-types + check-readme + check-release + check-tooling` | Run every gate that runs without Xcode |
| `make clean` | `pluginkit -r` + `lsregister -u` the Debug app, then `rm -rf app/macos/build app/macos/CoreTests/.build app/coverage` + `jest --clearCache` | Remove build output and caches; the Debug app is unregistered first so nothing lists a deleted copy |
| `make commit` | `git add -A -- .` + `git commit -- .` behind `verify` | Commit this project's verified changes — `m="type(scope): subject"`; the gate is a prerequisite, so the tree that is committed is the tree that passed |
| `make push` | `git push origin <current branch>` behind `verify` | Push the current branch after the gate passes again, because the worktree may have moved since the commit |
| `make dist` | `node .omp/hooks/lib/app-release.ts dist $(v)` | Build Release with version `v`, check the bundle, pack it into `Juice-<v>-macos.dmg` (the app beside an Applications link) and Sparkle-sign it, write `appcast.xml` + `checksums.txt` into `app/macos/build/dist` — publishes nothing (`rule://release`; requires Xcode) |
| `make release` | `node .omp/hooks/lib/app-release.ts release $(bump)` behind `verify` | Tag the next version, build and sign it, publish the GitHub release, read the feed back — only when the user asks; refuses before anything is built or tagged when the repository is not public, because installed copies download anonymously; `DRY_RUN=1` runs the preflight only (`rule://release`) |
| `make unrelease` | `node .omp/hooks/lib/app-release.ts unrelease $(v)` | Delete a GitHub release and its tag; `latest` falls back to the previous release (`rule://release`) |
| `make app-install` | `node .omp/hooks/lib/app-release.ts install` | Install the published release into `/Applications` as the only registered Juice — download the latest release's `-macos.dmg` through `gh`, check its sha256 and signature, install it as `/Applications/Juice.app` and unregister build copies from LaunchServices and the widget host, so one Juice exists (`rule://release`) |
| `make doctor` | `node .omp/hooks/lib/app-doctor.ts` | Read-only environment report: every Launch Services copy of `com.uk.juice` with path and version, the widget registration pluginkit chose and the app that runs, the code-signing identity against the project's `DEVELOPMENT_TEAM`, Apple's WWDR G3 intermediate, `xcode-select -p`, Metro; exits 1 on a finding (`rule://app-macos-project`) |
| `make hook-report` | `node .omp/hooks/lib/hook-metrics.ts` | Report what the hooks cost, which warnings were acted on and which pre hooks blocked how often — read from `.omp/state/hook-metrics.jsonl`, which `recordedBlocks()` and `guarded()` fill; not a `verify` gate (`rule://omp-hooks`) |
| `make check-app-duplicate-blocks` | `node .omp/hooks/post/check-app-duplicate-blocks.ts` | Check `app/` sources for duplicated block runs (`rule://app-duplicate-blocks`) |
| `make check-app-macos-project` | `node .omp/hooks/post/check-app-macos-project.ts` | Check the Xcode project — target membership, team signing, App Group, names, Bluetooth usage, menu bar residency (`rule://app-macos-project`) |
| `make check-app-native-boundary` | `node .omp/hooks/post/check-app-native-boundary.ts` | Check the React Native ↔ Swift boundary — React-free engine/shared/widget, thin adapters (`rule://app-native-boundary`) |
| `make check-code-layout` | `node .omp/hooks/post/check-code-layout.ts` | Check code layout — comments, TS file layout, member order, whitespace (`rule://code-layout`) |
| `make check-makefiles` | `node .omp/hooks/post/check-makefiles.ts` | Check Makefile targets against root-makefile.md and the post hooks — documented targets exist, every target has `##` help, and the help's first clause opens its row's purpose |
| `make check-omp-hooks` | `node .omp/hooks/post/check-omp-hooks.ts` | Check `.omp/hooks/` against `omp-hooks.md` and the hook contract |
| `make check-omp-probes` | `node .omp/hooks/post/check-omp-probes.ts` | Run the pre hooks' probe table (`.omp/hooks/probes.json`) and compare every verdict — a mention that does not run, a dry run, a sibling path, a sibling cwd and both gate forms are cases (`rule://omp-hooks`) |
| `make check-omp-rules` | `node .omp/hooks/post/check-omp-rules.ts` | Check `.omp/rules/` frontmatter, naming and TTSR triggers |
| `make check-omp-skills` | `node .omp/hooks/post/check-omp-skills.ts` | Check the skills catalog against the discovered `SKILL.md` files |
| `make check-omp-types` | `node .omp/hooks/post/check-omp-types.ts` | Type-check the harness TypeScript (`.omp/**/*.ts`) |
| `make check-readme` | `node .omp/hooks/post/check-readme.ts` | Check the README's links and `make` targets resolve and that `docs/` holds exactly the pictures it shows (`rule://root-readme`) |
| `make check-release` | `node .omp/hooks/post/check-release.ts` | Check the update feed URL, Sparkle key, tag-driven versions and Sparkle pod, plus the installer entitlements if the app is ever sandboxed (`rule://release`) |
| `make check-tooling` | `node .omp/hooks/post/check-tooling.ts` | Check the tooling language policy (`rule://tooling`) |
| `make check-verify` | `node .omp/hooks/post/check-verify.ts` | Run the root `make verify` and quote the failing lines — outside `verify` because it runs `verify` |

## Gates That Need Xcode

`make pods`, `make build`, `make run` and `make dist` need Xcode; the
`verify` gate does not, so it runs on a machine with the Command Line Tools
only. `make swift-check` and `make swift-test` exist for exactly that reason:
they type-check and test the Swift that does not depend on React or CocoaPods
(`app/macos/Shared/`, `Native/Core/`, `app/macos/JuiceWidget/`) against
whichever SDK is selected. That is why rule://app-native-boundary keeps logic
out of the React Native adapters — code in an adapter is code only `make build`
compiles — and why `check-app-macos-project` reads the project file instead of
building it: a source left out of its target is visible without Xcode.

## Targets Outside `verify`

`desktop-install`, `desktop-build`, `desktop-start`, `desktop-typecheck`,
`desktop-dist` and `android-apk` are deliberately not prerequisites of `verify`:
they need `make desktop-install`, the Android SDK or Electron's download, which
the gate must not require. `.github/workflows/desktop.yml` and `native.yml` run
them, on the OS each installer is built for.

## Verification Status

- A `make verify` failure is authoritative only when the command's captured exit
  status is nonzero.
- If a tool wrapper reports a nonzero status while every check prints `PASS`, rerun
  the command and capture Make's status before changing code:

  ```bash
  make verify; status=$?; printf 'MAKE_VERIFY_EXIT=%s\n' "$status"
  ```

- `MAKE_VERIFY_EXIT=0` means verification passed. Report the wrapper discrepancy
  as a harness issue; do not change project code to satisfy a contradictory status.

## Never Do These

- Declare a catch-all rule (`%:`, `.DEFAULT:`) — it answers every unknown target
  with success, so every `check-*` gate would pass without running. Measured in
  the harness this was ported from: an unattended local model whose acceptance
  was a nonexistent target added exactly that rule to make the predicate pass.
  `check-makefiles` rejects it.
- Add a `check-*` target that runs anything but `node .omp/hooks/...`
  (`check-tooling` rejects it).
- Run `npx tsc`, `npx eslint`, `npx jest`, `swiftc -typecheck`, `pod install` or
  `xcodebuild` directly — use the target that owns them.
- Truncate a gate's output with a pipe (`| tail`, `| grep`): the pipe returns its
  own exit status, so a red gate reads green.
