---
description: The README — the project's front page, kept true to the code; its widget pictures in docs/ are made from the widget's own views (make widget-snapshots), never drawn by hand
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
| `docs/widgets-light.png`, `docs/widgets-dark.png` | `make widget-snapshots` | macOS (SwiftUI) | `app/macos/CoreTests/WidgetSnapshots` renders the real widget views in all three families with `ImageRenderer` |

The README shows them only once they exist in `docs/`; a README that links a
picture that is not there fails `check-readme`. After a change to the widget,
regenerate its pictures and commit them with the change. Never edit a picture
by hand: the next regeneration would undo the edit, and the picture would show
a widget the code does not draw.

## What `check-readme` Holds

| Claim | Fails when |
|---|---|
| Links resolve | a relative link or image in `README.md` names a file that does not exist |
| Commands exist | a `make <target>` written as code in `README.md` is not a Makefile target |
| `docs/` is the README's | a file in `docs/` is not shown by the README, or the README shows a picture from outside `docs/` |

## Never Do These

- Change a command or a path without the README line that names it
- Edit or hand-draw a picture in `docs/` — regenerate it
- Put a picture the README does not show in `docs/`, or show one from elsewhere
