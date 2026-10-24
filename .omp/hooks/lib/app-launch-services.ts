/**
 * What macOS knows about Juice (rule://app-macos-project): the copies Launch
 * Services has registered, the widget extension pluginkit chose, and the
 * processes that run. Everything is read from the registries themselves, not
 * from Spotlight — the build directory is `.noindex`, so Spotlight never sees a
 * build copy, yet Launchpad, `open -b` and the widget gallery still choose from it.
 *
 * One copy must be registered: `/Applications/Juice.app`, plus the Debug build
 * `make run` launches. Any other registered copy (a Release `make dist` left, a
 * build from a moved or cloned checkout) is a second menu bar icon, a second
 * widget provider and a widget host that prefers the higher version.
 *
 *   node app-launch-services.ts unregister-others [keep…]   drop every registered copy except
 *                                                           /Applications and the kept paths
 *
 * Run through `make run` and `make app-install`; `lib/app-doctor.ts` reads the
 * same facts without changing any of them.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync } from "node:fs";
import { projectRoot } from "./hook-project-root.ts";

// ============================================================
// Constants
// ============================================================

export const BUNDLE_ID = "com.uk.juice";
export const WIDGET_ID = "com.uk.juice.widget";
/** Where the one installed copy lives; Sparkle replaces this bundle in place. */
export const INSTALLED_APP = "/Applications/Juice.app";
/** The Debug build `make run` launches — the other copy that may stay registered. */
export const DEBUG_APP = `${projectRoot}/app/macos/build/DerivedData.noindex/Build/Products/Debug/Juice.app`;
export const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

export interface RegisteredCopy {
  path: string;
  version: string;
  exists: boolean;
}

export interface WidgetRegistration {
  path: string;
  version: string;
  parent: string;
}

export interface RunningApp {
  pid: number;
  path: string;
}

// ============================================================
// Reading
// ============================================================

/**
 * Every bundle Launch Services registers under Juice's bundle id, by path. A dump
 * with no bundle records at all is unreadable, not empty: reporting "no copies" from
 * it would pass the doctor on a format change.
 */
export function registeredCopies(): RegisteredCopy[] {
  const dump = capture(LSREGISTER, ["-dump"]);
  if (!/^bundle id:/m.test(dump)) {
    throw new Error("the Launch Services dump holds no bundle records — its format changed or the registry is unreadable");
  }
  const identifier = new RegExp(`^identifier:\\s+${BUNDLE_ID.replace(/\./g, "\\.")}\\s*$`, "m");
  const copies = new Map<string, RegisteredCopy>();
  for (const block of dump.split(/^-{20,}$/m)) {
    if (!identifier.test(block)) continue;
    const path = /^path:\s+(.+?)\s+\(0x[0-9a-f]+\)\s*$/m.exec(block)?.[1];
    if (path === undefined) throw new Error(`a Launch Services record of ${BUNDLE_ID} names no path`);
    const version = /^versionString:\s+(.+)$/m.exec(block)?.[1]?.trim() ?? "unknown";
    copies.set(path, { path, version, exists: existsSync(path) });
  }
  return [...copies.values()];
}

/** The widget extension registrations: the one pluginkit elected, or every registered one. */
export function widgetRegistrations(all: boolean): WidgetRegistration[] {
  const text = capture("pluginkit", [all ? "-mA" : "-m", "-i", WIDGET_ID, "-vvv"]);
  const header = new RegExp(`^\\s*${WIDGET_ID.replace(/\./g, "\\.")}\\((.*)\\)\\s*$`);
  const found: WidgetRegistration[] = [];
  let current: WidgetRegistration | null = null;
  for (const line of text.split("\n")) {
    const start = header.exec(line);
    if (start !== null) {
      current = { path: "", version: start[1], parent: "" };
      found.push(current);
      continue;
    }
    const field = /^\s*(Path|Parent Bundle)\s*=\s*(.+?)\s*$/.exec(line);
    if (current === null || field === null) continue;
    if (field[1] === "Path") current.path = field[2];
    else current.parent = field[2];
  }
  return found;
}

/** The Juice processes that run, with the bundle each was started from. */
export function runningApps(): RunningApp[] {
  const apps: RunningApp[] = [];
  for (const line of capture("ps", ["-axo", "pid=,command="]).split("\n")) {
    const match = /^\s*(\d+)\s+(\/.+?\.app)\/Contents\/MacOS\/Juice(?:\s|$)/.exec(line);
    if (match !== null) apps.push({ pid: Number(match[1]), path: match[2] });
  }
  return apps;
}

// ============================================================
// Unregistering
// ============================================================

/**
 * Drops every registered copy and widget registration except the kept bundles
 * (always including `/Applications/Juice.app`), by absolute path. Returns one
 * line per registration removed.
 */
export function unregisterOthers(keep: string[]): string[] {
  const kept = [INSTALLED_APP, ...keep];
  const removed: string[] = [];
  for (const copy of registeredCopies()) {
    if (kept.includes(copy.path)) continue;
    spawnSync("pluginkit", ["-r", `${copy.path}/Contents/PlugIns/JuiceWidget.appex`], { stdio: "ignore" });
    // The copy's embedded Sparkle updater is registered beside it, and outlives it otherwise.
    for (const bundle of [copy.path, `${copy.path}/Contents/Frameworks/Sparkle.framework/Versions/B/Updater.app`]) {
      spawnSync(LSREGISTER, ["-u", bundle], { stdio: "ignore" });
    }
    removed.push(`unregistered ${copy.path} (${copy.version})`);
  }
  for (const widget of widgetRegistrations(true)) {
    if (kept.includes(widget.parent)) continue;
    spawnSync("pluginkit", ["-r", widget.path], { stdio: "ignore" });
    removed.push(`removed the widget registration of ${widget.parent}`);
  }
  return removed;
}

// ============================================================
// Helpers
// ============================================================

/** A command's stdout; a nonzero exit is an error. The buffer holds the Launch Services dump (several MB). */
function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} … exited ${result.status ?? result.signal}`);
  return String(result.stdout);
}

// ============================================================
// CLI
// ============================================================

if (typeof process !== "undefined" && process.argv[1]?.endsWith("app-launch-services.ts")) {
  const [command, ...keep] = process.argv.slice(2);
  if (command !== "unregister-others") {
    console.error("usage: app-launch-services.ts unregister-others [keep…]");
    process.exit(2);
  }
  try {
    for (const line of unregisterOthers(keep)) console.log(`==> ${line}`);
  } catch (error) {
    console.error(`app-launch-services: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
