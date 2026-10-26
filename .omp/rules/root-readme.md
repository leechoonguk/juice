---
description: The README — the project's front page, kept true to the code; it opens with the app window's moving demo (make demo) and its pictures in docs/ are made from the app (make demo, make widget-snapshots), never drawn by hand; the demo desk that records the window never reaches a shipped build
globs:
      - README.md
      - docs/**
      - app/macos/CoreTests/WidgetSnapshots/**
      - app/desktop/demo.ts
      - app/desktop/src/demo/**
alwaysApply: false
---

# README

`README.md` at the project root is the first thing a visitor reads: what Juice
is, how to install it, how to build it. Everything it says is a claim about
the code, so it changes in the same change as the code it describes — a renamed
target or a moved file is a README edit too.

## Pictures Are Made, Not Drawn

Every picture lives in `docs/` and is produced from the app itself, so a changed
widget is regenerated with one command instead of redrawn:

| Picture | Command | Where it runs | How |
|---|---|---|---|
| `docs/demo.gif` | `make demo` | any machine with `make desktop-install` and ffmpeg (xvfb-run on Linux without a display) | `app/desktop/demo.ts` builds the desktop app with the demo desk (`JUICE_DEMO=1`), starts Electron in its dark appearance with a throwaway user-data folder, presses Refresh and the threshold stepper through the Chrome DevTools Protocol, records the screencast and has ffmpeg make the GIF — a keyboard drains past the threshold and turns red, the threshold steps up and the rows are judged again |
| `docs/widgets.gif` | `make demo` | macOS (SwiftUI) with ffmpeg | the same recipe's first line: `juice-widget-snapshots --demo` renders the real widget views frame by frame over a scripted desk of made-up devices — a keyboard drains past the threshold and turns red, headphones connect — and ffmpeg encodes the GIF |
| `docs/widgets-light.png`, `docs/widgets-dark.png` | `make widget-snapshots` | macOS (SwiftUI) | `app/macos/CoreTests/WidgetSnapshots` renders the real widget views in all three families with `ImageRenderer` |

The README shows them only once they exist in `docs/`; a README that links a
picture that is not there fails `check-readme`. After a change to the widget,
regenerate its pictures and commit them with the change. Never edit a picture
by hand: the next regeneration would undo the edit, and the picture would show
a widget the code does not draw.

## The Front Page Moves

A still shows what Juice looks like; it does not show what it does. The README
therefore opens — before its first section — with `docs/demo.gif`, the app's own
window, and shows `docs/widgets.gif` in the widget bullet; `make demo` is the one
command that records both. The window is the real code (the monitor, the IPC, the
renderer and `BatteryScreen`) reading a scripted desk of made-up devices instead
of the machine's Bluetooth, so the recording is deterministic, needs no device,
and carries no real device name or address. A change to the window or the widget
re-records `make demo`, and a change to the widget also `make widget-snapshots`.

## The Demo Desk

`app/desktop/src/demo/battery.ts` is the in-memory battery provider the window
demo reads: Headphones, Mouse, Trackpad, Keyboard, a Speaker with no level and a
Phone that connects, with addresses `AA:00:00:00:00:0n`. It stands in for
`app/desktop/src/battery/` and exists only in the demo bundle:

- only `app/desktop/build.ts` bundles it, and only when `JUICE_DEMO=1`;
- no app source imports it;
- no Makefile recipe or workflow sets `JUICE_DEMO` — only `app/desktop/demo.ts`
  does, and it rebuilds the production bundle afterwards;
- the recorder gives Electron a throwaway user-data folder, so the recording
  never reads or writes the installed app's settings.

`check-readme` holds the first three.

## What `check-readme` Holds

| Claim | Fails when |
|---|---|
| Links resolve | a relative link or image in `README.md` names a file that does not exist |
| Commands exist | a `make <target>` written as code in `README.md` is not a Makefile target |
| `docs/` is the README's | a file in `docs/` is not shown by the README, or the README shows a picture from outside `docs/` |
| The front page moves | the README does not show `docs/demo.gif` before its first `##` section or `docs/widgets.gif` anywhere, or the Makefile has no `demo` recipe that writes both |
| The demo desk stays out of shipped builds | `app/desktop/build.ts` does not gate `app/desktop/src/demo/` behind `process.env.JUICE_DEMO === '1'`, an app source imports it, or the Makefile or a workflow sets `JUICE_DEMO` |

## Never Do These

- Change a command or a path without the README line that names it
- Edit or hand-draw a picture in `docs/` — regenerate it
- Put a picture the README does not show in `docs/`, or show one from elsewhere
- Open the README without its demo, or replace the demo desk with a screen
  recording of the running app on real devices — it would show real device names
- Import the demo desk from app code, or set `JUICE_DEMO` anywhere but the recorder
