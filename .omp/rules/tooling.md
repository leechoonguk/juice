---
description: Tooling language — TypeScript for the app and the harness, Swift and the Android shell's Kotlin for native code, no Python/Ruby/shell scripts; checks run as node .omp/hooks/... behind make targets
globs:
      - .omp/hooks/**/*.ts
      - .omp/extensions/**/*.ts
      - Makefile
      - app/**/*.ts
      - app/macos/**/*.swift
      - app/desktop/**/*.ts
      - app/android/app/src/main/java/**/*.kt
alwaysApply: false
---

# Tooling Language

Automation is read far more often than it is written, and it must run on any
machine that can run the harness. That fixes the languages and the locations:
**the app and the harness are TypeScript, native code is Swift (and, on Android,
the shell's Kotlin), and tooling is TypeScript under `.omp/hooks/`, executed by a `make` target.**

Machine-checked by `strict-tooling.ts` (write time), `check-tooling.ts` (tree
scan) and `check-omp-types.ts` (the harness type-checks).

## Placement

| Kind | Location | Executed by |
|---|---|---|
| Automatic check | `.omp/hooks/post/check-<name>.ts` | `make check-<name>` (and `make verify`) |
| Write-time block | `.omp/hooks/pre/strict-<name>.ts` | `tool_call` event |
| Shared logic | `.omp/hooks/lib/<scope>-<name>.ts` | its hook |
| Session-lifetime behaviour | `.omp/extensions/<name>/*.ts` | the extension runner — **auto-loaded**, never invoked |
| App code | `app/App.tsx`, `app/index.js`, `app/src/**`, `app/__tests__/**`, package-root config | Metro, tsc, eslint, jest |
| Native code | `app/macos/**/*.swift` and the `Native/*.m` bridge files | Xcode, `make swift-check` |
| Desktop app (Windows, Linux) | `app/desktop/package.json` (manifest, own `package-lock.json`), `app/desktop/build.ts`, `app/desktop/src/**/*.ts(x)` | esbuild (`make desktop-build`), Electron, electron-builder (`make desktop-dist`), `make desktop-typecheck` |
| Android app shell | `app/android/**` Gradle files and the Kotlin under `app/android/app/src/main/java/com/uk/juice/` (the template's `MainActivity`/`MainApplication`, the widget's empty `JuiceWidget` provider, the `JuiceBluetooth` native module), JS in `app/mobile/src/**` | Gradle, `make android-apk` |

- **No Python, Ruby or shell scripts.** Each needs a second toolchain to answer
  one question, and `node` already runs the harness — it strips TypeScript types
  natively, so a `.ts` file is directly executable. The CocoaPods `Podfile` and
  the Bundler `Gemfile` are manifests (no extension), not scripts.
- **Native sources live under `app/macos/`.** A `.swift`, `.m`, `.mm` or
  `.h` anywhere else is compiled by no target and no gate. The app carries its
  logic in React-free Swift (`Shared/`, `Native/Core/`, `JuiceWidget/`), which
  `make swift-check` and `make swift-test` compile without Xcode.
- **Kotlin lives under one package directory.** `.kt` and `.java` are compiled
  by Gradle (`make android-apk`) from `app/android/app/src/main/java/com/uk/juice/`
  and nowhere else. Juice's rule differs from the one it was ported from on
  purpose: Android has no other way to read a device's battery, so the Kotlin
  native module `JuiceBluetooth` (`com.uk.juice.bluetooth`, registered in
  `MainApplication` through a `ReactPackage`) is sanctioned logic there, beside
  the template's `MainActivity`/`MainApplication` and the widget's empty
  `JuiceWidget` provider. The Gradle wrapper (`gradlew`, `gradlew.bat`) is
  vendored, not written here. The module's JS side is the one wrapper
  `app/src/native/androidBluetooth.ts`, imported only from `app/mobile/src/`
  (rule://app-native-boundary).
- **The desktop package is one more manifest and its build output is not
  source.** `app/desktop/` is its own npm package (not a workspace) whose scripts
  are TypeScript under `app/` like the rest; `app/desktop/out/` and
  `app/desktop/release/` hold bundles and installers and are git-ignored
  (`app/desktop/.gitignore`), so the tree scans skip them.
- **`.omp/hooks/` and `.omp/extensions/` are TypeScript only.** Hooks and libs
  import each other, so a stray `.js`/`.mjs` breaks the import graph and the
  type contract. The one data file is `.omp/hooks/probes.json`, the pre hooks'
  verdict table that `check-omp-probes` reads.
- **No project-root `scripts/`, `tools/`, `bin/`, `utils/`.** Tooling outside
  `.omp/hooks/` is invisible to `check-omp-hooks` (no rule↔hook mapping, no
  contract table) and to `make`, so nothing runs it.
- **No throwaway scripts.** A verification script kept outside the project
  proves nothing after the session ends: land it as a hook with a make target,
  or do not rely on it.
- **Scratch and build output stay out of lint scope.** `eslint .` runs over all
  of `app/`; ESLint ignores `macos/build/**` (`app/.eslintrc.js`
  `ignorePatterns`), the one directory tools write generated files into. A probe
  dump, a recorded log or a generated bundle written anywhere else under `app/`
  is linted as source and fails the gate: write it under `app/macos/build/` or
  outside the repository.
- **The write guard judges this project only.** `strict-tooling` takes the
  project root from its own location, so a file of a sibling project, or one
  under `/tmp`, is never blocked by this project's placement policy
  (rule://omp-hooks, Project root).

## Execution

- Every `check-*` target in the `Makefile` runs `node .omp/hooks/...` — never an
  interpreter or a shell wrapper.
- The harness has no `package.json` and no `node_modules`: `check-omp-types`
  type-checks `.omp/tsconfig.json` with the TypeScript `app/` already depends
  on, and `lib/harness-env.d.ts` declares the few globals the hooks use.
- Register the target in the `Makefile` and `root-makefile.md`, and add the
  hook to `omp-hooks.md` — `check-makefiles` and `check-omp-hooks` enforce both.

## Hooks vs Extensions

Both are TypeScript, both load through the same extension runner, and the split
is by *what the code needs*:

- **`.omp/hooks/`** — a check or a block tied to one tool call. It answers a
  question about the workspace, and `make check-<name>` must be able to run the
  same logic from the CLI. Every hook maps to a rule (`omp-hooks.md`).
- **`.omp/extensions/`** — behaviour that needs the *session*: lifecycle events,
  persisted session state, a registered tool or command. This is the native
  auto-discovery root (`<cwd>/.omp/extensions/`), so an extension is **loaded
  automatically and applies without anyone invoking it**.

An extension may be disabled by name without deleting it:
`disabledExtensions: ["extension-module:<dir or file stem>"]`. Hook-capability
modules under `.omp/hooks/` use `hook:<type>:<tool>:<name>` ids instead
(omp://extension-loading.md).

## Never Do These

- Write a Python, Ruby or shell script for a check, a runner or a fixture
- Put Swift or Objective-C outside `app/macos/`
- Put Kotlin or Java outside `app/android/app/src/main/java/com/uk/juice/`, or
  write Android logic there beyond the sanctioned set (the template's two entry
  classes, the widget's empty provider, the `JuiceBluetooth` module)
- Put a `.js`/`.mjs` file under `.omp/hooks/` or `.omp/extensions/`
- Create a project-root `scripts/`, `tools/`, `bin/` or `utils/` directory
- Run a check through anything but `node`
- Add a `package.json` under `.omp/` — the harness borrows `app/`'s TypeScript
- Keep verification code outside the project (temp dir, home directory)
