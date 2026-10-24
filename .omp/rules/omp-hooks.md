---
description: OMP hook conventions - pre/post hooks, rule↔hook mapping, the post-hook contract, rule update workflow
globs:
      - .omp/hooks/**/*.ts
alwaysApply: false
---

# OMP Hooks

## Rule ↔ Hook Mapping

**Project governance contract — not an OMP runtime requirement.** OMP discovers
rules and hooks as separate capabilities. This project additionally requires
every rule in `.omp/rules/` to map to at least one enforcing hook and every
hook to map back to at least one rule. This table is the single source of truth;
`check-omp-hooks.ts` validates it mechanically.

**Separation principle** — each rule maps to at least one enforcing hook. Post
hooks stay within one validation domain; explicitly cross-cutting hooks and pre
hooks may serve several rules. Do not merge unrelated checks merely to reduce
file count.

- A domain rule normally maps to one post hook, plus one lib module when the
  logic is shared.
- A hook whose name carries no scope prefix is cross-cutting, as are `strict-*`
  pre hooks; both may be shared by multiple rules. Membership follows from the
  absent prefix, not from a list of hook names.
- When a new concern is not cross-cutting, split a new rule and hook pair.
- Example: `app-native-boundary.md` → `check-app-native-boundary.ts`.

**lib module naming** — lib modules are prefixed by their scope so checks never
collide:

| Prefix | Scope | Example |
|---|---|---|
| `app-` | App checks (`app/`) and the Mac's state | `lib/app-duplicate-blocks.ts` (the duplicated-run detector and the `app/` scan), `lib/app-xcode-project.ts` (the pbxproj and Info.plist reader of the Xcode-project check), `lib/app-launch-services.ts` (the registered copies, widget registrations and running processes of Juice; unregisters the strays), `lib/app-doctor.ts` (`make doctor` and the Metro precondition of `make run`) |
| `hook-` | Cross-cutting guard shared by every hook | `lib/hook-safety-guard.ts`, `lib/hook-dormancy.ts`, `lib/hook-visibility.ts`, `lib/hook-tool-paths.ts`, `lib/hook-scope.ts`, `lib/hook-rule-hint.ts`, `lib/hook-mutating-tools.ts`, `lib/hook-project-root.ts`, `lib/hook-publish-consent.ts`, `lib/hook-metrics.ts` (the hook-metrics log, `recordBlock`/`recordedBlocks` for pre-hook blocks, and `make hook-report`) |

`lib/harness-env.d.ts` declares the few runtime globals and the host module the
hooks use; it exports nothing and carries no scope.

**Payload shapes are read in one place.** `lib/hook-tool-paths.ts` answers "which
files is this call about to write": `write` carries `input.path`, while `edit`
names its files in `[path#TAG]` section headers (and `MV` targets) inside the
patch body. Every write-path guard that read only `input.path` ignored `edit`
entirely — measured in the harness this was ported from, where an immutable
file was rewritten with `edit` while its guard stayed silent. The question has
one answer now.

| Rule (`.omp/rules/`) | Pre Hook | Post Hook |
|---|---|---|
| `app-native-boundary.md` | — | `check-app-native-boundary.ts` |
| `app-duplicate-blocks.md` | — | `check-app-duplicate-blocks.ts` |
| `app-macos-project.md` | — | `check-app-macos-project.ts` |
| `code-layout.md` | — | `check-code-layout.ts` |
| `tooling.md` | `strict-tooling.ts` | `check-tooling.ts` + `check-omp-types.ts` (its TypeScript type-checks) |
| `root-makefile.md` | `strict-command-routing.ts` | `check-makefiles.ts` + `check-verify.ts` (runs the gate the table documents) |
| `root-readme.md` | `strict-command-routing.ts` | `check-readme.ts` |
| `root-git-workflow.md` | `strict-verified-git.ts` + `strict-publish-consent.ts` | — |
| `release.md` | `strict-release-route.ts` + `strict-publish-consent.ts` | `check-release.ts` |
| `omp-conventions.md` | — | `check-omp-rules.ts` |
| `omp-naming-consistency.md` | — | `check-omp-rules.ts` (rule prefix↔globs) + `check-omp-hooks.ts` (hook name↔paths) |
| `omp-hooks.md` | — | `check-omp-hooks.ts` + `check-omp-probes.ts` (the pre hooks' probe table) |
| `omp-skills.md` | — | `check-omp-skills.ts` |
| `RULES.md` (sticky) | `strict-no-subagents.ts` | — |
| `RULES.md` (sticky) | `strict-additive-writes.ts` | — |
| `omp-hook-crash-guard.md` (TTSR trigger) | — | `check-omp-hooks.ts` |

**Project contract:** every rule file must appear in this table (≥1 hook), and
every hook file must appear in this table (≥1 rule). Orphans on either side are
violations.

**TTSR trigger rules** carry a regex `condition` instead of `globs`, so they are
bucketed out of the rulebook and injected at the moment a matching edit is
being streamed. They add no validation domain: each one maps to the post hook
that already owns the invariant, and that hook is therefore exempt from the
one-domain-per-hook split heuristic.

Every trigger is built the same way, and `check-omp-rules` proves it:

| Contract | Failure it prevents |
|---|---|
| `condition` is a quoted string and compiles as a regex | The runtime drops an invalid pattern with a log line nobody reads |
| `scope` is declared | The default also watches assistant prose, so *writing about* a token interrupts the turn |
| `interruptMode` is declared | The machine-global default decides whether an edit is aborted |
| Every ≥4-character identifier in `condition` appears in the body | The injected text does not explain the token that stopped the edit |
| A `## Enforcement` section names the hook that owns the invariant | A trigger becomes a second, undocumented source of truth |
| The condition matches **nothing** in the files its `scope` selects | Rewriting a legitimate line interrupts the turn |
| Every scope stream carries a `fires-on` sample that the real engine fires on | A stream the condition can never match stays registered and silent |

**Splitting workflow** (when a rule/hook grows beyond one domain):

1. Identify the new validation domain
2. Create the rule file `<scope>-<name>.md` with its own globs
3. Create the post hook `check-<scope>-<name>.ts`
4. Move shared logic into `lib/<scope>-<name>.ts` (pure functions,
   scope-prefixed)
5. Register the Makefile target + add the mapping table row
6. Run `make verify` — the split must not change behavior (all checks still pass)

## Unreadable Is a Finding, Never a Pass

A parser that answers "no match" with an empty result retires its whole check
family without a trace — the file exists, compiles, and the comparisons quietly
stop running. Measured twice in one audit of the harness this was ported from:
a reformatted declaration emptied a parser and every comparison behind it
vanished behind a PASS; a renamed constant emptied a set and the CLI crashed on
an index into it.

The rule has two halves. **Tolerate valid formatting** where cheap. **Where the
parser is still defeated, say so**: input the check cannot read is not a clean
state, and the check's own blindness is the finding.

**A parser that reads one half of a pair proves nothing about the other.**
Where two parses must agree, **compare their counts and fail on a mismatch**:
N declared and M read is a file the check misread, whichever of the two is
larger. A check's blindness is discovered by asking it what it saw, never by
watching it pass.

## Scope Equals The Claim

A check must fire on exactly what it asserts. The failure is silent in both
directions: a check that reaches further decides something nobody chose (a
scanner that reads comment prose as code forces a sentence to be reworded), and
a check that reaches less passes while applying to nothing. When writing a
check, state the construct it is about and make the pattern say so — strip
comments before matching code (`check-app-native-boundary` does), and scope by
structure rather than by indentation or line width.

## Directory Structure

```
.omp/hooks/
+-- probes.json                        # The pre hooks' verdict table: cases `{name?, hook, tool, input, cwd?, turn?, expect}` that `check-omp-probes` runs against every pre hook
+-- pre/
| +-- strict-command-routing.ts      # Cross-cutting: blocks direct tool invocations owned by a make target (tsc/eslint/jest/swiftc/pod/xcodebuild/RN CLI, the desktop bundler, electron-builder, electron, gradlew, `npm ci`) except inside a `docker run`/`docker exec` (the sanctioned local cross-build), and a gate piped into a filter (`make verify | tail`); `make verify > log 2>&1; echo EXIT=$?` passes
| +-- strict-no-subagents.ts         # Cross-cutting: blocks task (subagent) creation on an omlx (local) session model; otherwise routes every spawn to Sonnet via before_subagent_spawn
| +-- strict-additive-writes.ts      # Cross-cutting: blocks an edit only when an import/bridge/registration entry would survive nowhere in the project (dedupe, same-patch moves and cutovers that leave no reference pass; __tests__/ is exempt); judges this project's files only
| +-- strict-verified-git.ts         # Cross-cutting: runs make verify before Git commit/push; blocks a commit whose project index differs from its worktree; leaves another project's session alone
| +-- strict-publish-consent.ts      # Cross-cutting: blocks a commit/push/release the current user turn did not ask for
| +-- strict-release-route.ts        # Cross-cutting: blocks raw git tag writes, version-tag pushes and gh release writes (make release owns them)
| +-- strict-tooling.ts              # Cross-cutting: blocks writes of Python/Ruby/shell scripts, native sources outside app/macos/, Kotlin/Java outside app/android/app/src/main/java/com/uk/juice/, and root script dirs (write + edit MV) — inside this project only
+-- post/
  +-- check-app-native-boundary.ts   # Read-only: React-free Swift engine/shared/widget, no AppKit-backed control in the widget, CoreBluetooth/IOBluetooth/IOKit only in Native/Core, declaration-only bridge files, selectors agree, NativeModules only in src/native, platform swaps hold (desktop/Android), one JS implementation, Android-only wrapper imported from app/mobile/src only
  +-- check-app-duplicate-blocks.ts  # Read-only: duplicated block runs in app/ sources, the platform trees and the Android Kotlin (delete, don't renumber)
  +-- check-app-macos-project.ts     # Read-only: Xcode target membership, team signing, one App Group, one product name, menu bar residency, Bluetooth usage declared
  +-- check-code-layout.ts           # Read-only: comments, TS file layout and member order, whitespace (all code incl. the desktop/mobile trees and the Android Kotlin), no edit marker left in a file, no real Bluetooth address in code
  +-- check-tooling.ts               # Read-only: the tooling language policy (TypeScript, Swift, and Kotlin only in the Android shell's package)
  +-- check-readme.ts                # Read-only: README links, make targets and docs/ pictures resolve
  +-- check-release.ts               # Read-only: Sparkle feed URL, EdDSA key, tag-driven versions, Sparkle pod; installer entitlements when the app is sandboxed; installer workflows only add assets, desktop publish feed and RELEASE_REPO agree
  +-- check-makefiles.ts             # Read-only: Makefile ↔ root-makefile.md, verify membership, make targets the harness names
  +-- check-omp-types.ts             # Read-only: tsc --noEmit over .omp/tsconfig.json
  +-- check-omp-hooks.ts             # Read-only: omp-hooks.md directory structure sync + hook contract + project root from the hook's own location + every pre hook wrapped in recordedBlocks
  +-- check-omp-probes.ts            # Read-only: runs .omp/hooks/probes.json — every pre hook answers its cases (a mention, a dry run, a sibling path and cwd, both gate forms)
  +-- check-omp-rules.ts             # Read-only: rule frontmatter, naming, TTSR triggers, no dated history
  +-- check-omp-skills.ts            # Read-only: skills catalog ↔ SKILL.md discovery
  +-- check-verify.ts                # Runs the root make verify (the gate's own runner, outside verify)
```

## Naming Convention

|Type|Prefix|Directory|Pattern|Examples|
|---|---|---|---|---|
|**Pre hooks**|`strict-`|`.omp/hooks/pre/`|`strict-<scope>-<name>.ts`|`strict-command-routing.ts`, `strict-tooling.ts`|
|**Post hooks**|`check-`|`.omp/hooks/post/`|`check-<scope>-<name>.ts`|`check-app-native-boundary.ts`, `check-makefiles.ts` (all scopes), `check-omp-hooks.ts`|

Pre hooks use `strict-<scope>-<name>.ts` — omit `<scope>` when cross-cutting.
Post hooks use `check-<scope>-<name>.ts` — omit `<scope>` when covering all
scopes. Scopes: `app-` (`app/`), `omp-` (`.omp/`).

**The prefix is machine-checked, not stylistic.** Every post-hook contract check
in `check-omp-hooks` is keyed by `check-`, so `post/foo.ts` would be validated by
nothing: no `guarded()` wrapper, no `MUTATING_TOOLS` filter, no safe warning. A
file in `post/` that does not start with `check-` (or in `pre/` without
`strict-`) is a violation on that ground alone.

### The Measured Failure Classes — walk these before writing

Every class below retired a real check in the harness this was ported from
while the gate stayed green. A new hook answers each question **at authoring
time**; the mechanical guard catches the answer you forgot to give.

| Class | The question | Mechanical guard |
|---|---|---|
| **Vanished prerequisite** — `readIfPresent → null → return`, check family retires silently | who owns this file's existence? | `checkSilentPrerequisites` demands `// existence-ok: <reason>` or a reported absence |
| **Defeated parser** — the file exists, the marker regex misses, comparisons run on empty sets | what does my check report when it parses *nothing* from a file that exists? | no general guard — write the sentinel by hand |
| **Vacuous both-ways** — two parsed sets compared, both empty, trivially equal | can both sides of my comparison empty at once, and would I notice? | same sentinel discipline |
| **Skipped-is-passed** — a precondition gate that prints the same PASS either way | does my banner distinguish "checked and clean" from "nothing to check"? | dormancy contract (`dormant()` + `passLine()`) |
| **Silent crash** — a throw in a handler retires the hook for the session | is my body inside `guarded()`? | `checkCrashGuard`, TTSR `omp-hook-crash-guard` |

The common shape: **silence must be earned by looking.** A check may be quiet
because it looked and found nothing — never because a rename, a folder move, a
reformat or a missing file kept it from looking.

### When Adding a New Hook

1. **Determine the hook type:**
   - **Pre hook** — blocks tool execution before it runs (blocking validation)
   - **Post hook** — reports issues after tool execution (read-only check)
2. **Name the file** — `strict-<scope>-<name>.ts` or `check-<scope>-<name>.ts`,
   omitting `<scope>` when cross-cutting.
3. **Create the file** — see the patterns below. A post hook's `tool_result`
   body must run inside `guarded("<hook>", event, () => { ... })` (see *Crash
   Visibility*), or its first exception silently retires the whole check.
4. **Register the target and gate it** — add `check-<name>` to the Makefile,
   add it to the `verify:` prerequisite list, and add it to both the target's
   own row and the `make verify` row in `root-makefile.md`; run
   `make check-makefiles`.
5. **Disable its automatic execution (post hooks only)** — add
   `- hook:post:<file-without-.ts>:<file>.ts` to `disabledExtensions` in
   `.omp/config.yml` (see *Post-Hooks → Execution Model*).
6. **Map it** — add the rule row above and the hook to the directory tree and
   the contract table; run `make check-omp-hooks`.

## Pre-Hooks

Blocking hooks that listen to `tool_call` events and deny specific tool invocations.

- Location: `.omp/hooks/pre/`
- Event: `tool_call` (filtered tools)
- Behavior: denylist pattern matching — first match wins. Patterns are anchored
  to a command boundary (line start, or after `&&` / `||` / `;` / `|` / `(`,
  optional `sudo`), allowing whitespace-free relative-path prefixes (`app/`,
  `./`) but never an argument word — so `ls app/node_modules/.bin/jest` is not
  treated as an invocation.

For hooks that gate an arbitrary tool (like `task`), gate on a fact of the
session, never on a finite `agent` allowlist - omitted, default, or future
agent types bypass it. `strict-no-subagents` gates on the session model's
provider: an `omlx` (local) model blocks the spawn, any other lets it through
and `before_subagent_spawn` pins the child to Sonnet.

### Reading the edited path (`path-raw-ok`)

An anchored edit does not hand the hook a clean path: it carries a content tag,
`app/App.tsx#0D77`. A guard that matches that string against an allowlist, an
extension test or a directory prefix is matching a path that exists nowhere —
so it either refuses a legitimate edit or waves it through in silence. Strip the
tag where the path is read:

```ts
const path = String(event.input.path ?? "").replace(/#[0-9A-Fa-f]{4}$/, "");
```

The field can also be absent. A patch-form edit arrives as
`{ input: "[relative/path#TAG]\nPUT 12.:\n+..." }` with no `path` at all. When
the target matters, read the patch header as a fallback — and when neither is
there, fail open (a pre hook that throws costs the agent the whole tool call).

`check-omp-hooks` requires every `input.path` read under `pre/` to strip the tag
on the spot, or to carry `// path-raw-ok: <reason>` within the five lines above
it.

### Every execution channel (`channel-ok`)

Commands do not only arrive through `bash`. The `eval` tool carries a Python or
JS body in `input.code`, and that body reaches the same binaries through
`subprocess.run([...])` or `execSync(...)`. A guard that inspects a command
string accepts `eval` as well, reads `input.code` next to `input.command`, and
gives the same guidance on both channels. If the policy really is shell-shaped,
say so with `// channel-ok: <reason>`.

### The context parameter is not readable (`ctx-ok`)

A `tool_call` handler's second argument is the extension context. An exception
thrown inside a pre hook is promoted to a **tool failure**: the tool call dies
and the agent receives the crash instead of its result. The decision to block is
made from `event` alone and the parameter is written `_ctx: unknown`. If a hook
genuinely needs it — the one legitimate need is the session's cwd, which says where
the command or the relative path is — it reads it through `eventWithCwd(event, ctx)`
(the only place that touches `ctx.cwd`, inside a `try`) and says why with
`// ctx-ok: <reason>`.

### Project root (hooks judge their own project)

The root of the project a hook guards is the location of
`lib/hook-project-root.ts` — three directories above `.omp/hooks/lib/` —
never the session's working directory. A session is often a sibling project's
(this harness's hooks load into it, or its hooks into this one), and a root
taken from the working directory then judged that project's files by this
one's policy: native sources "outside `app/macos/`" blocked in a Swift package
that had nothing to do with `app/`, writes under `/tmp` refused, state files
created in the wrong tree. The contract:

- Every root is `projectRoot` (realpath'd); a tool's path comes from
  `toolPath(path, event)` — a relative path is relative to the **event's own cwd**
  (`event.cwd`, supplied by `eventWithCwd(event, ctx)` from the handler context when
  the event has none), never `process.cwd()`; `canonical()` resolves symlinks (`/tmp`)
  and `isInsideProject()` asks whether an absolute path is this project's.
- A pre hook that judges a file path returns without blocking when the path is
  outside the project. A hook that judges a shell or eval command returns when the
  command runs outside it (`commandRunsOutsideProject(input, event)`: the call's
  `input.cwd`, else the event's cwd) — a sibling project's `make verify` or `git tag`
  is that project's routing. `hook-scope.ts` does the same for post hooks: an
  absolute path outside the project is not this project's file (`foreign()`).
- Only `lib/hook-project-root.ts` reads the session's working directory.
  `check-omp-hooks` (`checkProjectRootDerivation`) fails any other hook, lib or
  extension that does, and the helper itself if it stops deriving the root from
  `import.meta.url`.

### Pre-hook blocks are recorded (`recordedBlocks`)

A pre hook that refuses wrongly costs more than one that fails to refuse, and used
to leave no trace: a wrong project root blocked about forty writes over two days.
Every pre hook's `tool_call` handler is wrapped in
`recordedBlocks("<file stem>", handler)` from `lib/hook-metrics.ts`, which appends
one `{"kind":"block"}` line (hook, tool, the head of the reason, milliseconds) to
`.omp/state/hook-metrics.jsonl` for every `{ block: true }` verdict. `make hook-report`
lists the blocks per hook and the most frequent reasons — a friction measure, not a
pass/fail. `check-omp-hooks` requires the wrapper on every pre hook and its name to
equal the file stem. Post hooks are measured by `guarded()`; they are listed in
`disabledExtensions` and run as CLIs, so their section of the report fills in only in a
session that enables them.

### The pre hooks' probe table (`check-omp-probes`)

`.omp/hooks/probes.json` is the pre hooks' verdicts as data: each case is
`{ name?, hook, tool, input, cwd?, turn?, expect: "block" | "allow" }`. `check-omp-probes`
imports each hook, hands it a fake `pi` that keeps the `tool_call` handler, feeds it the
call (`cwd` becomes the event's and the context's cwd, `turn` the latest user message)
and compares the verdict. The table must carry a case named for each failure class —
`mention` (a command quoted in prose does not run), `dry-run`, `sibling-path`,
`sibling-cwd`, `gate-redirect` (`make verify > log 2>&1; echo EXIT=$?` passes) and
`gate-piped` (the gate piped into a filter blocks) — and every pre hook has at least one
case. This replaces "break it once by hand" for pre hooks: change a hook, run the table.
A probe sets `OMP_HOOK_PROBE=1` so its blocks stay out of the hook-metrics log.

## Post-Hooks

Read-only hooks that listen to `tool_result` events. Never block tool calls.

- Location: `.omp/hooks/post/`
- Event: `tool_result`
- Validation: `make verify` (or the individual `make check-*` targets) runs the
  same checks on demand via CLI. Each hook file guards its CLI entry with
  `process.argv[1]` detection — the same code path runs both inline and on
  demand.

### Execution Model — the closing gate, not a per-tool-call tax

Post hooks do **not** run automatically. Every file in `.omp/hooks/post/` is
listed in `disabledExtensions` in `.omp/config.yml`, so the runtime never loads
it as a `tool_result` listener; the checks reach the tree through the root
`make verify` (every post hook but `check-verify` is a `verify:` prerequisite).

Measured in the harness this was ported from: post hooks cost 3.8s per
mutating tool call, against one gate run of ~52s — a break-even of 14 calls in
sessions that averaged ~150.

What this changes for an author:

- A new post hook needs its `hook:post:<tool>:<file>` id in `.omp/config.yml`.
  The id format is the hook capability's `toExtensionId`
  (`hook:<type>:<tool>:<name>`, `<tool>` = filename without its extension) —
  see `omp://extension-loading.md`. `check-omp-hooks` fails when a post hook is
  missing from that list, or when the list names a file that no longer exists.
- A check reports only when the gate runs, so its message must stand alone
  without the tool call that caused it — the *Warning Shape* contract is what
  keeps it readable.
- That single run happens at commit: `make commit` and `make push` depend on
  `verify`. The finish gate in `.omp/extensions/continuity/discipline.ts` only
  requires that *some* verification covering the change — `make test`,
  `make lint`, `make typecheck`, `make swift-check`, a `make check-*` —
  succeeded after the last change.
- Pre hooks (`.omp/hooks/pre/strict-*.ts`) stay loaded. They *block* destructive
  calls before they land, which no after-the-fact gate can undo.

### Post-Hook Validation Scope

Each post hook owns a single concern. `check-omp-hooks.ts` requires every post
hook to appear in this table: a hook whose checks are undocumented cannot be
reviewed.

|Hook File|Validates|Checks|
|---|---|---|
|`check-app-native-boundary.ts`|The React Native ↔ native boundary under `app/`|`Shared/`, `Native/Core/`, `JuiceWidget/`, `CoreTests/` Swift: no `import React*`, no `RCT…` symbol; `import CoreBluetooth`/`IOBluetooth`/`IOKit` only under `Native/Core/`; `Native/*.m` holds only `#import`/`RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD`/`@end` (no `@implementation`, no `{`) and pairs with `Native/<stem>.swift`; adapter `@objc` instance selectors equal the `.m`'s `RCT_EXTERN_METHOD` selectors both ways (arguments need an explicit `@objc(selector:)`; read counts compared against declared counts); no `UserDefaults(suiteName:)`; the widget draws no AppKit-backed control (`ProgressView`, `Toggle`, `Slider`, `TextField`, `Picker`); a protocol extension defines only methods its protocol declares; `NativeModules` read only in `app/src/native/*.ts` within `app/src/`, `app/desktop/src/`, `app/mobile/src/` + `App.tsx`/`index.js` (tests may mock it); claim 7 — `app/desktop/build.ts` `SWAPS` and `app/metro.config.js` `ANDROID_SWAPS` each name an existing replacement that exports every runtime name of its wrapper, a wrapper reading a macOS-provided module (`JuiceBattery`, `AppUpdates`) is swapped on both, a wrapper of an Android-only module (`JuiceBluetooth`) is imported only from `app/mobile/src/`; claim 8 — `app/desktop/src/` and `app/mobile/src/` re-declare no name `app/src/snapshot.ts`, `updates.ts` or `battery.ts` export; dormant (`absent`) without `app/macos/`|
|`check-app-duplicate-blocks.ts`|Duplicated block runs in `app/` sources (TS, Swift, Objective-C, Kotlin — `app/src`, `app/__tests__`, `app/desktop/src`, `app/mobile/src`, the entry files, the macOS native trees, `app/android/app/src/main/java`; data formats exempt)|A non-overlapping repeat of 24+ identical consecutive lines (≥8 distinct) is a duplicated block — report it and instruct deletion, not renumbering|
|`check-app-macos-project.ts`|The Xcode project for the macOS app (`app/macos/`)|Every `.swift`/`.m` under a target's tree (and `Shared/`) is in that target's Sources phase, no stale or cross-tree reference, no two sources share a file name; every configuration signing with entitlements names a `DEVELOPMENT_TEAM`; both entitlements files and both Info.plists name one `$(TeamIdentifierPrefix)…` App Group; the app's `PRODUCT_NAME` equals every `CFBundleDisplayName`; an `LSUIElement` app returns `false` from `applicationShouldTerminateAfterLastWindowClosed`; an app compiling CoreBluetooth or IOBluetooth declares `NSBluetoothAlwaysUsageDescription` and, only when its entitlements enable the sandbox, `com.apple.security.device.bluetooth`; every build lands in `app/macos/build/DerivedData.noindex`; declared-vs-resolved source counts compared so a defeated parse reports; dormant (`absent`) without the project file|
|`check-code-layout.ts`|Code layout across every code surface (`app/` TS + package-root config, `app/desktop/` and `app/mobile/src/`, `app/macos/` Swift/ObjC, the Android Kotlin, `.omp/hooks/`, `.omp/extensions/`)|No commented-out code, no work markers; JSDoc header on every hook/lib; TS/JS imports → constants → `export default` → helpers, never `let` for a module constant; TS class members fields → constructor → public → private; whitespace on every text asset (no trailing whitespace, no tab indent outside the Makefile, LF only, exactly one final newline); no edit flag left in any text asset (`EDIT_MARKER`: the marker line the write guard accepts, in `//`, `#`, `<!-- -->` or `*` form; prose that names it in backticks passes); no Bluetooth address literal in code except the documented placeholders (`AA:00:00:00:00:0n`, `00:00:00:00:00:00`)|
|`check-tooling.ts`|Tooling language policy across the project|No `.py`/`.rb`/`.sh`/`.bash`/`.zsh` anywhere; `.swift`/`.m`/`.mm`/`.h` only under `app/macos/`; `.kt`/`.java` only under `app/android/app/src/main/java/com/uk/juice/`; `.omp/hooks/` and `.omp/extensions/` TypeScript only (except `.omp/hooks/probes.json`); no project-root `scripts/`/`tools/`/`bin/`/`utils/`; scripts only under `.omp/hooks/`, `.omp/extensions/`, `app/`; every `check-*` target runs `node .omp/hooks/...`; extension `ctx.compact/shutdown/abort` rejections handled|
|`check-readme.ts`|`README.md` and its pictures (`docs/`) ↔ the code|Every relative link and image in the README names an existing file (fenced and inline code is not a link); every `make <target>` the README writes as code is a Makefile target; every file in `docs/` is shown by the README and every picture it shows is in `docs/`; the README shows `docs/demo.gif` before its first `##` section and the Makefile's `demo` recipe writes it; dormant (`absent`) without `README.md`|
|`check-release.ts`|The in-app update path (`app/macos/` plists, entitlements, Podfile) ↔ `lib/app-release.ts`|App `SUFeedURL` equals `FEED_URL` from `lib/app-release.ts`; `SUPublicEDKey` is a 32-byte base64 EdDSA key; only if the app is sandboxed (Juice's is not) it sets `SUEnableInstallerLauncherService` and holds the `$(PRODUCT_BUNDLE_IDENTIFIER)-spks`/`-spki` mach-lookup exceptions; both Info.plists read `$(MARKETING_VERSION)`/`$(CURRENT_PROJECT_VERSION)`; the Podfile declares the `Sparkle` pod; `release()` calls `requirePublicRepository()` before it tags; dormant (`absent`) without the app Info.plist|
|`check-makefiles.ts`|Makefile ↔ `root-makefile.md`|Documented targets exist and actual targets are documented; every target has `##` help; no catch-all rule; `node .omp/...` recipes point at existing files; every post hook has its `check-<name>` target; **verify membership** — every post-hook target except `check-verify` is a `verify` prerequisite and `check-verify` is not, and the prerequisite list equals the `make verify` row (both directions); every `make <target>` written as code in the harness exists; each target's `##` help text opens its row's purpose (the help's first clause — up to the first `,` `;` `:` ` (` or ` — ` — appears in the row)|
|`check-omp-types.ts`|Harness TypeScript type-checks|`tsc --noEmit` over `.omp/tsconfig.json` with `app/node_modules/typescript`; reports the first 3 `error TS` lines|
|`check-omp-hooks.ts`|`.omp/hooks/` ↔ `omp-hooks.md` + hook contract + rule↔hook mapping|Directory tree ↔ disk both ways; this contract table covers every post hook; `post/check-*` and `pre/strict-*` prefixes; lib names `app-*`/`hook-*`; **project root** — no hook, lib or extension reads the session's working directory except `lib/hook-project-root.ts`, which derives the root from `import.meta.url` (omp-hooks.md, Project root); every pre hook wraps its `tool_call` handler in `recordedBlocks("<file stem>", …)` (omp-hooks.md, Pre-hook blocks are recorded); post hooks call `buildSafeWarning(event.toolName, "<hook>", issues, fixHint)` + `wrapWarning`, never `lastWarning`, never block, route every `tool_result` body through `guarded("<hook>", event, …)`, gate on `MUTATING_TOOLS`, declare a path scope, name an anchor for existence demands, call `printRuleHint` in the CLI tail and resolve a rule; pre hooks return `{ block: true }`, strip the path tag, cover `eval`, and do not read `ctx`; scoped hook names reference their paths; only `check-verify` runs a gate binary; harness guardrails; every post hook listed in `disabledExtensions`; literal warnings name a place|
|`check-omp-rules.ts`|Dynamic rule-loading contract|`AGENTS.md` has no `@rules/` imports; no `rules/RULES.md` shadow; valid frontmatter (`description`, `globs`, `alwaysApply=false`); always-apply set ≤ 2; `app-`/`omp-`/`root-` prefix ↔ globs, prefix-less only when globs span ≥2 top-level dirs; procedure sections ordered and verified; no duplicated line in a code fence; reference snippets match their files; TTSR triggers well-formed, documented, clean against their scope, live per stream (`omp ttsr test`); no dated history under `.omp/`|
|`check-omp-skills.ts`|`.omp/rules/omp-skills.md` ↔ `.omp/skills/` catalog|Every discovered `SKILL.md` has one catalog row and every row a `SKILL.md`; `name` matches its directory; `description`, Trigger, Verification non-empty; Lifecycle `active`/`deprecated`; **skill harness contract** — `enforced-by` equals the name-derived hook set, each declared hook exists and is a `verify` prerequisite, a procedure skill references a `rule://` domain|
|`check-omp-probes.ts`|`.omp/hooks/probes.json` ↔ the pre hooks|Every case runs its pre hook with a fake `pi` and the verdict equals `expect`; every pre hook has a case; the table carries `mention`, `dry-run`, `sibling-path`, `sibling-cwd`, `gate-redirect` and `gate-piped` cases; a hook that throws or cannot be loaded is a finding|
|`check-verify.ts`|The root gate|Runs `make verify` (lint, typecheck, test, swift-check and every other harness check) and quotes the last failing lines; skips explicit `make` commands; not a `verify` prerequisite because it runs `verify`|

### Crash Visibility

The extension runner catches a `tool_result` handler's exception, hands it to
`emitError(...)` and continues: the throw never reaches the conversation and the
handler's `{ content }` override is dropped. A hook that dies on its first tool
call therefore enforces nothing for the rest of the session while `make
check-<hook>` still passes by hand — a dead check reads exactly like a passing
one.

So every post hook's handler body runs inside `guarded()` from
`lib/hook-visibility.ts`:

```ts
pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) =>
  guarded("check-omp-rules", event, () => {
    // the check itself, unchanged
  }));
```

A throw is then reported three ways: a one-line `<system-notice>` appended to
the tool result (capped at 2 per hook + message), an uncapped line in
`.omp/state/hook-crash.log` (gitignored, outlives the session), and stderr. The
original tool content is always preserved, and the crash is never rethrown —
one broken hook must not decide what the others get to report.

`check-omp-hooks` rejects a post hook that does not import `guarded`, or whose
`guarded()` name does not match its file name. Wrappers are **counted** against
`pi.on("tool_result")` registrations, so a second handler added later cannot
slip in bare.

**Pre hooks are a documented exception.** The runtime turns a `tool_call`
handler's throw into a block, so a broken pre hook announces itself by refusing
every tool call it filters — loudly, immediately, and without a wrapper.

### Rule Attribution

Every check's CLI tail calls `printRuleHint("check-<self>")` (from
`lib/hook-rule-hint.ts`) before reporting failures, so a red `make verify`
prints `Rule: rule://<name> — <description>` and the agent can read the
governing rule instead of rediscovering its requirements one failure at a
time. The check-name → rule-name mapping lives in `hook-rule-hint.ts`
(`RULE_NAME_EXCEPTIONS` for non-1:1 names, existence-verified);
`check-omp-hooks` requires the call on every CLI tail and a resolving rule for
every check not listed in `NO_RULE_CHECKS`.

### Warning Shape

An issue line names **where**, **what**, and **how**:
`app/src/screens/Home.tsx:12: reads NativeModules — import the wrapper instead`.
The line number belongs there whenever the check has it. A warning that names
no file sends the reader to grep the tree, so `check-omp-hooks` rejects any
literal `issues.push("...")` string that mentions no file or directory.

### Dormant Checks

A check that only asserts something when the feature exists must not print the
same PASS whether the code was compliant or simply absent. A feature-gated hook
returns `dormant("<hook>", <cause>, "<why>")` from `lib/hook-dormancy.ts` and
prints its banner through `passLine(...)`:

```
PASS: React Native ↔ native boundary holds (dormant — absent: no app/macos/ native tree)
```

Dormancy has exactly two causes, and `DormantCause` admits no third:

|Cause|Means|True where|
|---|---|---|
|`absent`|the feature the check guards is not in the code|every environment — nothing to fix|
|`service`|the check compares the code with a running service this environment lacks|a clean clone; the same check runs in full wherever the service is up|

**Anything else is a failure, not dormancy.** A check that could not read the
code it guards is broken, and says so as an issue. `check-omp-hooks` rejects a
hook whose header claims "Optional feature" while it never calls `dormant()`.

### Scope Resolution

Scoped hooks must reference their scope through a direct path (`app/`,
`.omp/`) or delegate through a matching scope-prefixed lib module. Prefix-less
hooks are cross-cutting.

**Never construct notices or deduplication inline** — direct `lastWarning` state
and manual `return { content: [...] }` paths bypass the shared content-length
protection and can hide the tool result, causing an infinite loop.

**Context economy** — three guards keep post hooks from wasting context when
they do run per tool call:

1. **Tool filter**: read-only tools cannot change files, so the check is skipped
   after them. Only mutating tools (`write`, `edit`, `bash`, `eval`,
   `ast_edit`, `lsp`, `browser`, `hub`, `task`) trigger the check.
2. **Shared warning guard**: at most three issue lines; long tool output gets a
   one-line notice; the same hook/issue warning is injected at most twice
   across tools and resets only when the issue set resolves.
3. **Path gate**: a hook runs only when the event touched its domain. Import
   `touchesPath` (path-bearing events only; shells pass) or `touchesStrict`
   (also reads the shell command) from `lib/hook-scope.ts` and gate right after
   the tool filter; a hook that must see everything says so with a
   `// hook-scope: global — <reason>` comment.

```ts
const warning = buildSafeWarning(
  event.toolName,
  "check-omp-rules",
  issues,
  "run make check-omp-rules for details",
);
if (warning === null) return;
console.error(warning);
return { content: wrapWarning(warning, event.content, "check-omp-rules") };
```

### Demand direction (요구는 의존 방향으로)

검사는 **존재하는 하류가 상류를 요구**한다. 작업의 첫 걸음에서 마지막 걸음을 요구하지 않는다.
이 지적들이 도구 결과에 주입되면 작성자는 그 목록을 작업 큐로 읽는다 — 한 계층만 손보려던
작업이 기능 전체로 번지는 경로가 이것이다.

파일이나 등록의 **부재**를 지적하는 문장은 둘 중 하나여야 한다 — `check-omp-hooks` 가 강제한다:

- **앵커 명시**: 무엇 때문에 요구가 생겼는지 메시지가 밝힌다
  (`Native/X.m: exists but Native/X.swift is missing`).
- **`// premature-ok: <사유>`**: 어느 단계에서든 참인 요구다(예: 프로젝트 기반 파일의 부재는
  작업 순서가 아니라 설정 결함이다).

내용 검사(선언·메서드 부재)는 대상이 아니다 — 이미 존재하는 파일의 속성이기 때문이다.

## Break It Once, Before You Trust It

A check that passes proves nothing about a dirty tree; it may be asleep.

**When you add or change a claim, violate it once and paste the failure into the
commit message.** Plant the smallest violation (edit and revert), run the owning
check, and read *which* message fired. Reading the message matters more than the
exit code: a falsification that also trips a neighbouring claim can read as a
pass of the one under test.

For a **pre hook** the break-once is a case in `.omp/hooks/probes.json`
(`check-omp-probes`): flip one `expect`, see which case fails, restore it — the table
keeps the verdict afterwards, which a one-off edit does not.

A standing mutation suite was built and removed in the harness this was ported
from: its finds were mostly its own bugs, and every real parser defect was found
by an ad-hoc probe written for one question while the check was being written.

## Harness Construction Guardrails

These are correctness constraints, not style preferences. `check-omp-hooks.ts`
enforces the machine-checkable parts.

1. **One policy decision source.** A pre hook and its post checker import the
   same helper for a decision. Do not duplicate path, tag or command parsing in
   each hook (`lib/hook-tool-paths.ts`, `lib/hook-scope.ts`).
2. **Post results preserve evidence.** Post hooks never block. Every warning
   uses `buildSafeWarning()` and `wrapWarning(warning, event.content, ...)`;
   the wrapper appends the original result before its notice.
3. **Suppress by violation, not tool.** A warning's repeat limit is keyed by
   hook and issue set. Changing from `edit` to `bash` must not restart a loop.
4. **Do not nest explicit verification.** `check-verify` detects
   `event.input.command` starting with `make` and returns without nesting.
5. **Accept valid formatting.** Harness validators match syntax flexibly;
   formatting a handler across lines must not turn a working hook into a
   false failure.
6. **A crash is a finding, not silence.** Every post hook's `tool_result` body
   runs inside `guarded()` from `lib/hook-visibility.ts`.

## Rule Update Workflow

When adding/updating rule files in `.omp/rules/`:

1. Edit the rule file (any tool — no pre hook restricts `.omp/rules/`)
2. Run `make check-omp-rules` and `make check-omp-hooks` to validate the
   dynamic-loading contract and the mapping
3. Resolve any discrepancies

## Authoring Invariants (enforced by `check-omp-hooks`)

| Invariant | Why |
|---|---|
| Every post hook gates on `MUTATING_TOOLS` | a check that runs after a read spends context on a turn that changed nothing |
| Every post hook declares a path scope (`touchesPath`/`touchesStrict`) or a `// hook-scope: global — <reason>` | a check that runs on events outside its domain spends the agent's wall clock, not just context |
| Only `post/check-verify.ts` may execute a gate binary (`make`, `npm`, `npx`, `jest`, `tsc`, `eslint`, `swiftc`, `xcodebuild`, `pod`) | the gate is the dominant hook cost, and a second runner races the agent's own `make` |

## Never Do These

- Run the project gate (`make verify`, `make test`, `npx jest`, `swiftc`) from
  any post hook except `check-verify` — read files instead
- Put blocking logic in post hooks — they can't block tool calls
- Mix pre and post hooks in the same directory
- Forget to keep `.omp/hooks/` and `omp-hooks.md` in sync
- Register a `tool_result` handler whose body is not wrapped in `guarded()` — the
  runner swallows the throw and the hook goes quiet for the rest of the session
- Match a raw `input.path` in a pre hook — strip the anchored-edit content tag
  (`#0D77`) first, or the guard judges a path that exists nowhere
- Gate a command policy on `bash` alone — `eval` carries the same command in
  `input.code`
- Read a pre hook's context parameter — a throw there is promoted to a tool
  failure and the agent loses the call
