/**
 * Check-App-Native-Boundary Post Hook
 *
 * Holds the line between React Native and the native code (app-native-boundary.md):
 *
 *   1. React-free Swift — `app/macos/Shared/`, `Native/Core/` and
 *      `app/macos/JuiceWidget/` import no React module and name no `RCT`
 *      symbol. They are what `make swift-check` type-checks without CocoaPods,
 *      and the widget extension never links React at all.
 *   2. CoreBluetooth, IOBluetooth and IOKit are imported only under
 *      `Native/Core/`. The adapters stay thin translations; a device read in an
 *      adapter is logic `swift-check` cannot reach, and one in the widget is a
 *      second reader beside the app's. (Core may also import AppKit,
 *      UserNotifications and WidgetKit.)
 *   3. Every `Native/*.m` is declarations only — `#import`, comments,
 *      `RCT_EXTERN_MODULE`, `RCT_EXTERN_METHOD` and `@end`, no
 *      `@implementation` and no `{` body — and is paired with the Swift
 *      adapter of the same stem that it exposes. The selectors agree both
 *      ways: an adapter method the `.m` does not declare is unreachable from
 *      JavaScript, and a declared selector the adapter lacks crashes at call
 *      time — and neither side compiles on a machine without Xcode.
 *   4. `NativeModules` is read only in `app/src/native/*.ts`, so every screen
 *      reaches native code through one typed wrapper per module. Tests under
 *      `app/__tests__/` are outside the claim: mocking `NativeModules` is how a
 *      wrapper is tested without a native runtime.
 *   5. App and widget share state as files, never through
 *      `UserDefaults(suiteName:)`: cfprefsd refuses a suite shared between two
 *      processes, one of them sandboxed ("only allowed for System Containers") and its KVO
 *      never fires for the other process's writes — both measured here, both
 *      silent.
 *   6. A protocol extension defines only methods the protocol declares. A
 *      method that exists only in the extension is statically dispatched: a
 *      conformer's own implementation is never called through the protocol,
 *      and nothing fails — measured here as a delegate callback that dropped
 *      every value it was given.
 *   7. Platform swaps hold. The desktop bundle (`app/desktop/build.ts`) and
 *      Metro on Android (`app/metro.config.js`) replace `app/src/native/*`
 *      modules; each replacement exists and exports every runtime name of
 *      the module it replaces, and a wrapper that reads a module only macOS
 *      provides (`JuiceBattery`, `AppUpdates`) is replaced on both — else that
 *      platform crashes at launch, and neither bundle is built by `make
 *      verify`. A wrapper whose module only Android provides (`JuiceBluetooth`)
 *      has no swap and is imported only from `app/mobile/src/`.
 *   8. One implementation per language. The platform files under
 *      `app/desktop/src/` and `app/mobile/src/` are sources and surfaces:
 *      none declares a function or constant that `app/src/snapshot.ts`,
 *      `app/src/updates.ts` or `app/src/battery.ts` exports — a second
 *      threshold clamp, alert rule or version compare drifts from the shared
 *      one, which the tests then no longer cover.
 *   9. The widget draws no AppKit-backed control — `ProgressView`, `Toggle`,
 *      `Slider`, `TextField`, `Picker`. WidgetKit and `ImageRenderer` cannot
 *      render them: the widget gallery and the README's snapshots show a
 *      placeholder where the control should be (measured here with a
 *      `ProgressView`); shapes (`Capsule`, `Circle`) draw everywhere.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { dormant, passLine } from "../lib/hook-dormancy.ts";
import { projectRoot, WALK_EXCLUDES } from "../lib/hook-project-root.ts";

// ============================================================
// Constants
// ============================================================


const MACOS_DIR = "app/macos";
const NATIVE_DIR = "app/macos/Juice-macOS/Native";
const CORE_DIR = "app/macos/Juice-macOS/Native/Core";

/** Swift trees that must compile without React: the shared snapshot, the battery engine, the widget, their tests. */
const REACT_FREE_DIRS = ["app/macos/Shared", CORE_DIR, "app/macos/JuiceWidget", "app/macos/CoreTests"];

/** Every native tree whose device-framework imports are policed. */
const NATIVE_SWIFT_DIRS = [
  "app/macos/Shared",
  "app/macos/Juice-macOS",
  "app/macos/JuiceWidget",
  "app/macos/CoreTests",
];

/** JS/TS trees whose `NativeModules` reads are policed; the wrapper directory is the one exemption. */
const SCRIPT_DIRS = ["app/src", "app/desktop/src", "app/mobile/src"];
const SCRIPT_FILES = ["app/App.tsx", "app/index.js"];
const WRAPPER_DIR = "app/src/native/";
const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/** The files that swap a wrapper per platform, and how each names its target directory. */
const SWAP_FILES = [
  { file: "app/desktop/build.ts", platform: "Windows/Linux", base: "app/desktop" },
  { file: "app/metro.config.js", platform: "Android", base: "app" },
];

/** Which platform ships each native module a wrapper reads: macOS in Swift, Android in Kotlin; Windows and Linux read the batteries in the Electron main process instead. */
const MODULE_PROVIDERS: Record<string, "macOS" | "Android"> = {
  JuiceBattery: "macOS",
  AppUpdates: "macOS",
  JuiceBluetooth: "Android",
};

/** The one tree bundled for Android alone (Metro `ANDROID_SWAPS` target directory). */
const MOBILE_DIR = "app/mobile/src/";

/** The platform trees held to the shared implementation (claim 8). */
const PLATFORM_DIRS = ["app/desktop/src", "app/mobile/src"];
const SHARED_MODULES = ["app/src/snapshot.ts", "app/src/updates.ts", "app/src/battery.ts"];
const RUNTIME_EXPORT = /^export\s+(?:async\s+)?(?:const|function|class|let)\s+(\w+)/gm;

const REACT_IMPORT = /^\s*(?:@testable\s+)?import\s+(?:class\s+|struct\s+|func\s+)?React\w*\b/;
const RCT_SYMBOL = /\bRCT[A-Z_]\w*/;
const DEVICE_IMPORT = /^\s*import\s+(?:class\s+|struct\s+)?(CoreBluetooth|IOBluetooth|IOKit)\b/;
const NATIVE_MODULES = /\bNativeModules\b/;
const SUITE_DEFAULTS = /\bUserDefaults\s*\(\s*suiteName\s*:/;
const SWIFT_FUNC = /\bfunc\s+(\w+)\s*(?:<[^>{]*>)?\s*\(/g;

/** The widget extension: what WidgetKit and `ImageRenderer` draw, so what claim 9 polices. */
const WIDGET_DIR = "app/macos/JuiceWidget";
const APPKIT_CONTROL = /\b(ProgressView|Toggle|Slider|TextField|Picker)\b\s*[({<]/;

/** The only line shapes a bridge declaration file may hold, outside comments. */
const BRIDGE_LINE = /^(?:#import\s+[<"][^>"]+[>"]|@interface\s+RCT_EXTERN_(?:REMAP_)?MODULE\(.*|RCT_EXTERN_(?:REMAP_)?METHOD\(.*|@end)$/;

/** An `@objc` function head up to its name; group 1 is the explicit selector, group 2 the modifiers. */
const OBJC_FUNC = /@objc\b(?:\(([^)]*)\))?((?:\s+\w+)*?)\s+func\s+(\w+)\s*\(/g;
const BRIDGE_METHOD = /RCT_EXTERN_(REMAP_)?METHOD\(/g;

// ============================================================
// Functions
// ============================================================

export default function checkAppNativeBoundary(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-app-native-boundary", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["app/"])) return;

    const issues = checkAppNativeBoundarySync();
    if (issues.length === 0) {
      resetSuppression("check-app-native-boundary");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-app-native-boundary",
      issues,
      "move React-free logic into Native/Core or Shared, keep adapters and .m files thin",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-app-native-boundary") };
  }));
}

export function checkAppNativeBoundarySync(): string[] {
  if (!existsSync(join(projectRoot, MACOS_DIR))) {
    return dormant("check-app-native-boundary", "absent", "no app/macos/ native tree");
  }
  const issues: string[] = [];

  for (const dir of REACT_FREE_DIRS) {
    for (const path of walk(dir, [".swift"])) {
      eachCodeLine(path, (line, number) => {
        if (REACT_IMPORT.test(line)) {
          issues.push(
            `${path}:${number}: imports React — ${dir}/ must compile without React ` +
              "(make swift-check and the widget extension have no Pods)",
          );
        } else if (RCT_SYMBOL.test(line)) {
          issues.push(
            `${path}:${number}: names ${RCT_SYMBOL.exec(line)?.[0]} — React Native types belong ` +
              `in the adapters under ${NATIVE_DIR}/, not in ${dir}/`,
          );
        }
      });
    }
  }

  for (const dir of NATIVE_SWIFT_DIRS) {
    for (const path of walk(dir, [".swift"])) {
      if (path.startsWith(`${CORE_DIR}/`)) continue;
      eachCodeLine(path, (line, number) => {
        const framework = DEVICE_IMPORT.exec(line)?.[1];
        if (framework === undefined) return;
        issues.push(
          `${path}:${number}: imports ${framework} — device reads live in ${CORE_DIR}/ ` +
            "where make swift-check covers it; adapters translate, the widget only reads the shared snapshot",
        );
      });
    }
  }

  for (const dir of NATIVE_SWIFT_DIRS) {
    for (const path of walk(dir, [".swift"])) {
      eachCodeLine(path, (line, number) => {
        if (!SUITE_DEFAULTS.test(line)) return;
        issues.push(
          `${path}:${number}: shares state through UserDefaults(suiteName:) — cfprefsd refuses a suite shared ` +
            "between the app and the sandboxed widget and never notifies the other process; use SharedStore (files in the App Group container)",
        );
      });
    }
  }

  for (const path of walk(WIDGET_DIR, [".swift"])) {
    eachCodeLine(path, (line, number) => {
      const control = APPKIT_CONTROL.exec(line)?.[1];
      if (control === undefined) return;
      issues.push(
        `${path}:${number}: draws ${control} — an AppKit-backed control that WidgetKit and ImageRenderer cannot render ` +
          "(a placeholder in the widget gallery and the README snapshots); draw it with shapes (Capsule, Circle)",
      );
    });
  }

  issues.push(...checkProtocolExtensionMethods());
  issues.push(...checkBridgeFiles());
  issues.push(...checkPlatformSwaps());
  issues.push(...checkSingleImplementation());

  for (const path of scriptFiles()) {
    if (path.startsWith(WRAPPER_DIR)) continue;
    eachCodeLine(path, (line, number) => {
      if (!NATIVE_MODULES.test(line)) return;
      issues.push(
        `${path}:${number}: reads NativeModules — only the typed wrappers in ${WRAPPER_DIR} ` +
          "touch native modules; import the wrapper instead",
      );
    });
  }

  return issues;
}

/**
 * Claim 6: every method a protocol extension defines is a requirement of that
 * protocol, matched by name and argument labels. Protocols are collected across
 * every native tree first, so an extension in one file meets its protocol in another.
 */
function checkProtocolExtensionMethods(): string[] {
  const issues: string[] = [];
  const files = NATIVE_SWIFT_DIRS.flatMap((dir) => walk(dir, [".swift"]));
  const texts = new Map(files.map((path) => [path, codeText(path)]));

  const requirements = new Map<string, Set<string>>();
  for (const [path, text] of texts) {
    for (const m of text.matchAll(/\bprotocol\s+(\w+)[^{\n]*\{/g)) {
      const body = braced(text, (m.index ?? 0) + m[0].length - 1);
      if (body === null) {
        issues.push(`${path}:${lineOf(text, m.index ?? 0)}: cannot read the body of protocol ${m[1]} — the extension check is blind to it`);
        continue;
      }
      requirements.set(m[1], new Set(functionKeys(body)));
    }
  }

  for (const [path, text] of texts) {
    for (const m of text.matchAll(/\bextension\s+(\w+)\s*(?:where[^{]*)?\{/g)) {
      const declared = requirements.get(m[1]);
      if (declared === undefined) continue;
      const start = (m.index ?? 0) + m[0].length - 1;
      const body = braced(text, start);
      if (body === null) {
        issues.push(`${path}:${lineOf(text, m.index ?? 0)}: cannot read the body of extension ${m[1]} — the extension check is blind to it`);
        continue;
      }
      for (const key of functionKeys(body)) {
        if (declared.has(key)) continue;
        issues.push(
          `${path}:${lineOf(text, m.index ?? 0)}: extension ${m[1]} defines ${key}, which protocol ${m[1]} does not declare — ` +
            "it is statically dispatched, so a conformer's own implementation is never called through the protocol; declare it in the protocol",
        );
      }
    }
  }
  return issues;
}

/** `name(label:label:)` for every function in `body`, Swift's own selector spelling. */
function functionKeys(body: string): string[] {
  const keys: string[] = [];
  for (const m of body.matchAll(SWIFT_FUNC)) {
    const params = balanced(body, (m.index ?? 0) + m[0].length - 1);
    if (params === null) continue;
    const labels = splitTopLevel(params)
      .map((param) => param.trim().replace(/^@\w+\s+/, ""))
      .filter((param) => param.length > 0)
      .map((param) => /^(\w+)/.exec(param)?.[1] ?? "_");
    keys.push(`${m[1]}(${labels.map((label) => `${label}:`).join("")})`);
  }
  return keys;
}

/** Splits on commas outside (), [] and <>. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if ("([<".includes(char)) depth++;
    else if (")]>".includes(char)) depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** The text between the `{` at `open` and its matching `}`, or null when it never closes. */
function braced(text: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}" && --depth === 0) return text.slice(open + 1, index);
  }
  return null;
}

/** `Native/*.m`: declarations only, each paired with the Swift adapter it exposes. */
function checkBridgeFiles(): string[] {
  const issues: string[] = [];
  const dir = join(projectRoot, NATIVE_DIR);
  if (!existsSync(dir)) return issues;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".m")) continue;
    const path = `${NATIVE_DIR}/${name}`;
    const swift = name.replace(/\.m$/, ".swift");
    if (!existsSync(join(dir, swift))) {
      issues.push(`${path}: exists but ${NATIVE_DIR}/${swift} is missing — a bridge file declares the Swift adapter of the same stem`);
    }
    let continuation = false;
    eachCodeLine(path, (line, number) => {
      const text = line.trim();
      if (text === "") return;
      // An RCT_EXTERN_METHOD signature wraps across lines until its `)`.
      if (continuation) {
        continuation = !/\)\s*$/.test(text);
        return;
      }
      if (/\{/.test(text) || /^@implementation\b/.test(text)) {
        issues.push(
          `${path}:${number}: holds an implementation — a bridge file only declares; ` +
            `the logic belongs in ${CORE_DIR}/ and the translation in ${swift}`,
        );
        return;
      }
      if (!BRIDGE_LINE.test(text)) {
        issues.push(
          `${path}:${number}: "${text.slice(0, 50)}" is not a bridge declaration — ` +
            "only #import, RCT_EXTERN_MODULE, RCT_EXTERN_METHOD and @end belong here",
        );
        return;
      }
      continuation = /^RCT_EXTERN_(?:REMAP_)?METHOD\(/.test(text) && !/\)\s*$/.test(text);
    });
    if (existsSync(join(dir, swift))) {
      issues.push(...checkSelectors(path, `${NATIVE_DIR}/${swift}`));
    }
  }
  return issues;
}

/**
 * The adapter's `@objc` instance methods and the bridge's `RCT_EXTERN_METHOD`
 * selectors must be the same set. Class methods (`requiresMainQueueSetup`) are
 * module configuration, not JS-callable, and are left out.
 */
function checkSelectors(bridgePath: string, adapterPath: string): string[] {
  const issues: string[] = [];
  const adapter = codeText(adapterPath);
  const bridge = codeText(bridgePath);

  const exported = new Map<string, number>();
  let heads = 0;
  for (const match of adapter.matchAll(OBJC_FUNC)) {
    heads++;
    const [, selector, modifiers, name] = match;
    if (/\b(?:static|class)\b/.test(modifiers)) continue;
    const line = lineOf(adapter, match.index ?? 0);
    const params = balanced(adapter, (match.index ?? 0) + match[0].length - 1);
    if (params === null) {
      issues.push(`${adapterPath}:${line}: cannot read the parameter list of ${name} — the selector check is blind to it`);
      continue;
    }
    if (selector !== undefined) {
      exported.set(selector.trim(), line);
    } else if (params.trim() === "") {
      exported.set(name, line);
    } else {
      issues.push(
        `${adapterPath}:${line}: ${name} takes arguments without an explicit @objc(selector:) — ` +
          "name the selector so it can be matched against its RCT_EXTERN_METHOD",
      );
    }
  }
  const objcTokens = (adapter.match(/@objc\b(?:\([^)]*\))?(?:\s+\w+)*?\s+func\b/g) ?? []).length;
  if (heads !== objcTokens) {
    issues.push(`${adapterPath}: read ${heads} of ${objcTokens} @objc functions — the selector check is blind to the rest`);
  }

  const declared = new Map<string, number>();
  const macros = (bridge.match(BRIDGE_METHOD) ?? []).length;
  for (const match of bridge.matchAll(BRIDGE_METHOD)) {
    const line = lineOf(bridge, match.index ?? 0);
    const inner = balanced(bridge, (match.index ?? 0) + match[0].length - 1);
    if (inner === null) continue;
    const signature = match[1] === undefined ? inner : inner.slice(inner.indexOf(",") + 1);
    const labels = [...signature.matchAll(/(\w+)\s*:/g)].map((label) => label[1]);
    declared.set(labels.length === 0 ? signature.trim() : `${labels.join(":")}:`, line);
  }
  if (declared.size !== macros) {
    issues.push(`${bridgePath}: read ${declared.size} of ${macros} RCT_EXTERN_METHOD declarations — the selector check is blind to the rest`);
  }

  for (const [selector, line] of exported) {
    if (declared.has(selector)) continue;
    issues.push(
      `${adapterPath}:${line}: @objc ${selector} is not declared in ${bridgePath} — ` +
        "add its RCT_EXTERN_METHOD or JavaScript cannot call it",
    );
  }
  for (const [selector, line] of declared) {
    if (exported.has(selector)) continue;
    issues.push(
      `${bridgePath}:${line}: RCT_EXTERN_METHOD ${selector} has no @objc(${selector}) method in ${adapterPath} — ` +
        "the call crashes at runtime",
    );
  }
  return issues;
}

/**
 * Claim 7: every swap names an existing file that exports what it replaces, a wrapper of a
 * macOS-provided module is swapped on both platforms, and a wrapper of an Android-only module is
 * imported only from `app/mobile/src/` — the one tree that bundles for Android alone.
 */
function checkPlatformSwaps(): string[] {
  const wrappers = walk(WRAPPER_DIR.slice(0, -1), [".ts"]);
  if (wrappers.length === 0) {
    return [`${WRAPPER_DIR}: holds no wrapper — the swap check has nothing to hold the platforms to`];
  }
  const issues: string[] = [];
  const modulesOf = new Map<string, string[]>();
  for (const wrapper of wrappers) {
    const modules = nativeModulesRead(wrapper);
    modulesOf.set(wrapper, modules);
    if (modules.length === 0 && NATIVE_MODULES.test(codeText(wrapper))) {
      issues.push(`${wrapper}: reads NativeModules in a shape the check cannot attribute to a module — read one named module (NativeModules.Name)`);
    }
    for (const module of modules) {
      if (MODULE_PROVIDERS[module] === undefined) {
        issues.push(`${wrapper}: reads NativeModules.${module}, which no platform in the provider table is known to provide — add it to MODULE_PROVIDERS with its platform`);
      }
    }
  }

  for (const { file, platform, base } of SWAP_FILES) {
    if (!existsSync(join(projectRoot, file))) {
      issues.push(`${file}: missing — the ${platform} build swaps no wrapper, so it would bundle the macOS native modules`);
      continue;
    }
    // Each swap entry is one line: a pattern naming `native/<module>`, then the replacement's path segments.
    const swapped = new Map<string, string>();
    for (const line of readFileSync(join(projectRoot, file), "utf-8").split("\n")) {
      const module = /\\\/native\\\/(\w+)\$/.exec(line)?.[1];
      const segments = [...line.matchAll(/'([\w.]+)'/g)].map((m) => m[1]);
      if (module === undefined || segments.length === 0) continue;
      const target = `${base}/${line.includes("MOBILE") ? "mobile/src/" : ""}${segments.join("/")}`;
      swapped.set(`${WRAPPER_DIR}${module}.ts`, target);
    }
    if (swapped.size === 0) {
      issues.push(`${file}: read no swap of ${WRAPPER_DIR}* — the parser is blind or the swaps moved, and every claim below would pass on nothing`);
      continue;
    }
    for (const [wrapper, target] of swapped) {
      if (!existsSync(join(projectRoot, wrapper))) {
        issues.push(`${file}: swaps ${wrapper}, which does not exist — a stale swap`);
        continue;
      }
      if (!existsSync(join(projectRoot, target))) {
        issues.push(`${file}: swaps ${wrapper} for ${target}, which does not exist — the ${platform} bundle fails to resolve it`);
        continue;
      }
      const provided = runtimeExports(target);
      for (const name of runtimeExports(wrapper)) {
        if (!provided.has(name)) {
          issues.push(`${target}: replaces ${wrapper} on ${platform} but does not export ${name} — every import of it is undefined there`);
        }
      }
    }
    for (const wrapper of wrappers) {
      const macOsModule = (modulesOf.get(wrapper) ?? []).find((module) => MODULE_PROVIDERS[module] === "macOS");
      if (macOsModule === undefined || swapped.has(wrapper)) continue;
      issues.push(`${wrapper}: reads NativeModules.${macOsModule}, which only macOS provides, but ${file} does not swap it — on ${platform} it finds no native module and the app fails at launch`);
    }
  }

  for (const wrapper of wrappers) {
    const modules = modulesOf.get(wrapper) ?? [];
    if (modules.length === 0 || !modules.every((module) => MODULE_PROVIDERS[module] === "Android")) continue;
    issues.push(...checkAndroidOnlyImports(wrapper));
  }
  return issues;
}

/** A wrapper whose module only Android provides has no swap: nothing but `app/mobile/src/` may import it. */
function checkAndroidOnlyImports(wrapper: string): string[] {
  const stem = wrapper.slice(WRAPPER_DIR.length).replace(/\.ts$/, "");
  const importsIt = new RegExp(String.raw`['"][^'"]*\/native\/${stem}['"]`);
  const issues: string[] = [];
  for (const path of scriptFiles()) {
    if (path.startsWith(WRAPPER_DIR) || path.startsWith(MOBILE_DIR)) continue;
    eachCodeLine(path, (line, number) => {
      if (!importsIt.test(line)) return;
      issues.push(`${path}:${number}: imports ${wrapper}, which reads a module only Android provides — import it from ${MOBILE_DIR} only; elsewhere it is undefined at launch`);
    });
  }
  return issues;
}

/** Claim 8: no platform file re-declares a name the shared modules export. */
function checkSingleImplementation(): string[] {
  const shared = new Map<string, string>();
  for (const path of SHARED_MODULES) {
    if (!existsSync(join(projectRoot, path))) {
      return [`${path}: missing — the shared implementation the platform files are held to is gone`];
    }
    for (const name of runtimeExports(path)) shared.set(name, path);
  }
  const issues: string[] = [];
  for (const dir of PLATFORM_DIRS) {
    for (const path of walk(dir, JS_EXTENSIONS)) {
      eachCodeLine(path, (line, number) => {
        const declared = /^\s*(?:export\s+)?(?:async\s+)?(?:function|const|let)\s+(\w+)/.exec(line)?.[1];
        const owner = declared === undefined ? undefined : shared.get(declared);
        if (owner === undefined) return;
        issues.push(`${path}:${number}: declares ${declared}, which ${owner} already exports — import the shared one; a second copy drifts from it untested`);
      });
    }
  }
  return issues;
}

/** The runtime names a module exports (types excluded): what a swap must keep. */
function runtimeExports(path: string): Set<string> {
  return new Set([...codeText(path).matchAll(RUNTIME_EXPORT)].map((m) => m[1]));
}

/** The native modules a wrapper reads: `NativeModules.Name`, `NativeModules['Name']` or `{ Name } = NativeModules`. */
function nativeModulesRead(path: string): string[] {
  const text = codeText(path);
  const named = [...text.matchAll(/\bNativeModules\s*(?:\.\s*(\w+)|\[\s*['"](\w+)['"]\s*\])/g)].map((m) => m[1] ?? m[2]);
  const destructured = [...text.matchAll(/\{([^}]*)\}\s*=\s*NativeModules\b/g)].flatMap((m) =>
    m[1].split(",").map((part: string) => part.split(":")[0].trim()).filter((name: string) => name !== ""),
  );
  return [...new Set([...named, ...destructured])];
}

// ============================================================
// Helpers
// ============================================================

/** Project-relative files under `dir` with one of the extensions. */
function walk(dir: string, extensions: string[]): string[] {
  const abs = join(projectRoot, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (WALK_EXCLUDES.has(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...walk(path, extensions));
      continue;
    }
    if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
}

/** Every JS/TS file the `NativeModules` and import policing covers, project-relative and present on disk. */
function scriptFiles(): string[] {
  return [...SCRIPT_DIRS.flatMap((dir) => walk(dir, JS_EXTENSIONS)), ...SCRIPT_FILES].filter((path) =>
    existsSync(join(projectRoot, path)),
  );
}

/**
 * Every line outside comments, with its 1-based number. Comments explain the
 * boundary and therefore name the very symbols it forbids; only code counts.
 */
function eachCodeLine(path: string, visit: (line: string, number: number) => void): void {
  let inBlock = false;
  readFileSync(join(projectRoot, path), "utf-8").split("\n").forEach((raw: string, index: number) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      line = line.slice(0, open);
      inBlock = true;
    }
    line = line.replace(/\/\/.*$/, "");
    visit(line, index + 1);
  });
}

/** The file's code lines (comments blanked, line count preserved) joined back into one text. */
function codeText(path: string): string {
  const lines: string[] = [];
  eachCodeLine(path, (line) => lines.push(line));
  return lines.join("\n");
}

/** 1-based line of a character offset. */
function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** The text between the `(` at `open` and its matching `)`, or null when it never closes. */
function balanced(text: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")" && --depth === 0) return text.slice(open + 1, index);
  }
  return null;
}

// Direct execution (make check-app-native-boundary): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-app-native-boundary.ts")) {
  const issues = checkAppNativeBoundarySync();
  console.log("==> check-app-native-boundary");
  if (issues.length === 0) {
    console.log(passLine("check-app-native-boundary", "React Native ↔ native boundary holds"));
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-app-native-boundary");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
