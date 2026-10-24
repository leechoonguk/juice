---
description: The README — the project's front page, kept true to the code; it opens with a moving demo (make demo) and its pictures in docs/ are made from the widget's own views (make widget-snapshots), never drawn by hand
globs:
      - README.md
      - docs/**
      - app/macos/CoreTests/WidgetSnapshots/**
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
| `docs/demo.gif` | `make demo` | macOS (SwiftUI) with ffmpeg | the same tool with `--demo` renders the real widget views frame by frame over a scripted desk of made-up devices — a keyboard drains past the threshold and turns red, headphones connect — and ffmpeg encodes the GIF |
| `docs/widgets-light.png`, `docs/widgets-dark.png` | `make widget-snapshots` | macOS (SwiftUI) | `app/macos/CoreTests/WidgetSnapshots` renders the real widget views in all three families with `ImageRenderer` |

The README shows them only once they exist in `docs/`; a README that links a
picture that is not there fails `check-readme`. After a change to the widget,
regenerate its pictures and commit them with the change. Never edit a picture
by hand: the next regeneration would undo the edit, and the picture would show
a widget the code does not draw.

## The Front Page Moves

A still shows what the widget looks like; it does not show what Juice does. The
README therefore opens — before its first section — with `docs/demo.gif`, and
`make demo` is the one command that records it. The demo is a script, not a
screen recording: a screen recording of the running app would carry the
recorder's real device names, need a demo build that shares the installed
app's App Group and widget, and register one more copy of the app. The script
runs the widget's real views over made-up devices, so it is deterministic,
needs no device, and changes only when the widget or the script does. A change
to the widget re-records both `make widget-snapshots` and `make demo`.

## What `check-readme` Holds

| Claim | Fails when |
|---|---|
| Links resolve | a relative link or image in `README.md` names a file that does not exist |
| Commands exist | a `make <target>` written as code in `README.md` is not a Makefile target |
| `docs/` is the README's | a file in `docs/` is not shown by the README, or the README shows a picture from outside `docs/` |
| The front page moves | the README does not show `docs/demo.gif` before its first `##` section, or the Makefile has no `demo` recipe that writes it |

## Never Do These

- Change a command or a path without the README line that names it
- Edit or hand-draw a picture in `docs/` — regenerate it
- Put a picture the README does not show in `docs/`, or show one from elsewhere
- Open the README without its demo, or replace the scripted demo with a screen
  recording of the running app — it would show real device names
