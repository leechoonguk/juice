---
name: release
description: Publish a new Juice version (tag, signed disk image, Sparkle feed) through make release bump=patch|minor|major, install it with make app-install, or roll one back with make unrelease. Use when the user asks to release, deploy, ship, tag a version, or undo a release.
enforced-by: [check-release]
---

# Release

The git tag is the version; `make release` is the only way to make one
(rule://release). `strict-release-route` blocks raw `git tag`, tag pushes and
`gh release` writes; `strict-publish-consent` blocks `make release` and
`make unrelease` unless the current user turn asks for a release. `check-release`
(part of `make verify`) holds the feed URL, the Sparkle key and the versions to
what the release script publishes.

## Before

1. The change is committed and pushed (`commit` skill), and CI for that commit is
   green: `gh run list --limit 1`.
2. Pick the bump from what changed since the last tag
   (`git log --oneline $(git describe --tags --abbrev=0)..HEAD`): `patch` fixes,
   `minor` new behaviour or settings, `major` a user must change something. If the
   user did not say, propose one and why — do not guess silently.
3. The README's pictures must match what users will get (rule://root-readme).
   If the widget, the shared snapshot types, the window (`app/src/screens`,
   `app/src/theme.ts`, `app/desktop/src/renderer`) or the demo scripts changed
   since the last tag, re-record them:

```bash
git diff --stat $(git describe --tags --abbrev=0)..HEAD -- app/macos/JuiceWidget app/macos/Shared app/macos/CoreTests/WidgetSnapshots/main.swift app/src/screens app/src/theme.ts app/desktop/src/renderer app/desktop/demo.ts app/desktop/src/demo
make demo
make widget-snapshots
```

   `make demo` records both moving pictures. Look at the result before
   committing it — extract frames and view them. `docs/demo.gif` (the window,
   about 13 s): `ffmpeg -ss 1 -i docs/demo.gif -frames:v 1 /tmp/demo-1.png`, and
   again at about 5 s (the keyboard red), 9 s (a phone connected, the threshold
   25%) and 12 s (30%, the phone red). `docs/widgets.gif` (10 s): at 0.2 s, about
   4.5 s (the keyboard close to the threshold) and 8.5 s (red, the headphones
   connected). Every device in them is made up; a real device name or address
   must never appear. If a scene no longer shows what the app does (a changed
   layout, a new state), fix the script (`app/desktop/demo.ts` and
   `app/desktop/src/demo/battery.ts` for the window,
   `app/macos/CoreTests/WidgetSnapshots/main.swift` for the widgets) and record
   again. Commit the pictures (`commit` skill) so they are part of the released
   commit. The dry run below prints a note when the drawing code changed and the
   pictures did not.
4. Independent review for user-facing changes (the widget, the menu bar behaviour, the
   settings, the update path, anything a user sees or that touches their Mac's
   registration state). Self-verification covers happy paths. Start a reviewer subagent
   that did not write the change, give it the diff since the last tag, and require each
   finding tagged `REPRODUCED` (shown with a command and its output) or `INFERRED`. Fix
   what is reproduced, rerun `make verify`, and commit before the release. The subagent
   prompt carries the cleanup duty: remove what it installed or started (build copies,
   registrations, temp directories, processes) and nothing else, and use
   `HOME=$(mktemp -d)`, never the real home.
5. Dry run — every check, no tag:

```bash
make release bump=patch DRY_RUN=1
```

## Release

```bash
make release bump=patch
```

It prints each step (`==>`): the version, the commits going out, the Release
build, the signed disk image and feed, the tag push, the GitHub release, and a
read-back of the feed the way installed copies fetch it. It stops before tagging
when the repository is not public — installed copies download anonymously.
Report the release URL it prints.

Publishing also starts the CI workflows that attach the other platforms' assets
to the same release a few minutes later: `desktop.yml` adds
`Juice-<version>-windows-setup.exe` (+ blockmap), `…-linux-x86_64.AppImage`,
`…-linux-amd64.deb`, `latest.yml` and `latest-linux.yml`; `native.yml` adds
`Juice-<version>-android.apk`. CI never uploads the disk image, `appcast.xml` or
`checksums.txt` — `make release` made those. Check the runs
(`gh run list --limit 3`) and report if one failed; the macOS release is
complete either way, and the Windows, Linux and Android updaters wait for their
files.

## After

```bash
make app-install
make doctor
```

`app-install` installs the published disk image into `/Applications` and
unregisters every build copy, so the widget gallery and Spotlight show one Juice.
`make doctor` must report no findings.

## When It Fails

Read the `release:` line — it names the step.

- Before the tag (branch, dirty tree, unpushed, private repository, tag exists,
  build or signing failed): nothing was published. Fix it and run again.
- The release is missing a file or the feed read-back does not name the new
  version: the tag is public. `make unrelease v=vX.Y.Z`, fix, and release again —
  only if the user agrees.

Never re-tag or move a published version; release the next one.
