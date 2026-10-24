/**
 * Check-Readme Post Hook
 *
 * The README is the project's front page (root-readme.md). It goes stale in
 * ways no test notices: a renamed target, a moved file, a picture nobody
 * regenerates. This check holds it to the code:
 *
 *   1. Every relative link and image in `README.md` resolves to a file.
 *   2. Every `make <target>` the README writes as code is a Makefile target.
 *   3. `docs/` holds only what the README shows, and the README shows pictures
 *      only from `docs/` — a picture elsewhere has no command that regenerates it.
 *   4. The README opens with the moving demo: `docs/demo.gif` is shown before its
 *      first `##` section, and the Makefile's `demo` target is what writes it. A
 *      still alone tells a visitor what the widget looks like, not what it does —
 *      levels falling, a device turning red at the threshold, one connecting.
 *
 * Reads files only; dormant (`absent`) without `README.md`.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join, normalize } from "node:path";
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


const README = "README.md";
const DOCS = "docs";
const DEMO = `${DOCS}/demo.gif`;
const SCOPE = [README, `${DOCS}/`, "Makefile", ".github/workflows/"];

const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const HTML_SOURCE = /\b(?:src|srcset|href)="([^"]+)"/g;
const PICTURE = /\.(?:png|gif|jpe?g|svg|webp|mp4)$/i;

// ============================================================
// Functions
// ============================================================

export default function checkReadme(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-readme", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, SCOPE)) return;

    const issues = checkReadmeSync();
    if (issues.length === 0) {
      resetSuppression("check-readme");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-readme",
      issues,
      "fix the README's reference, or regenerate its pictures with `make widget-snapshots`",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-readme") };
  }));
}

export function checkReadmeSync(): string[] {
  if (!existsSync(join(projectRoot, README))) {
    return dormant("check-readme", "absent", `no ${README} — no front page to hold to the code`);
  }
  const readme = readFileSync(join(projectRoot, README), "utf-8");
  const references = referencesOf(readme);

  const issues: string[] = [];
  issues.push(...checkReferences(references));
  issues.push(...checkMakeTargets(readme));
  issues.push(...checkDocs(references));
  issues.push(...checkDemo(readme));
  return issues;
}

/** Claim 4: the front page moves, and one command makes it move. */
function checkDemo(readme: string): string[] {
  const issues: string[] = [];
  const firstSection = readme.search(/^##\s/m);
  const opening = firstSection === -1 ? readme : readme.slice(0, firstSection);
  if (!referencesOf(opening).includes(DEMO)) {
    issues.push(`${README}: does not show ${DEMO} before its first section — the front page opens with the moving demo \`make demo\` records`);
  }
  const makefile = existsSync(join(projectRoot, "Makefile")) ? readFileSync(join(projectRoot, "Makefile"), "utf-8") : "";
  const recipe = /^demo:[^\n]*\n((?:\t[^\n]*\n?)+)/m.exec(makefile)?.[1] ?? null;
  if (recipe === null) {
    issues.push(`Makefile: no \`demo\` target — ${DEMO} needs one command that re-records it from the app's own views`);
  } else if (!recipe.includes(DEMO)) {
    issues.push(`Makefile: the \`demo\` recipe does not write ${DEMO} — the README would show a recording no command makes`);
  }
  return issues;
}

/** Every relative target the README links or shows, without its `#fragment`; prose in code is not a link. */
function referencesOf(readme: string): string[] {
  const prose = readme.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const targets = [...prose.matchAll(MARKDOWN_LINK), ...prose.matchAll(HTML_SOURCE)].map((m) => m[1]);
  return [...new Set(targets)]
    .filter((target) => !/^(?:[a-z]+:|#|\/\/)/i.test(target))
    .map((target) => target.split("#")[0])
    .filter((target) => target !== "");
}

/** Claim 1. */
function checkReferences(references: string[]): string[] {
  return references
    .filter((target) => !existsSync(join(projectRoot, decodeURIComponent(target))))
    .map((target) => `${README}: links ${target}, which does not exist — a reader follows it to a 404`);
}

/** Claim 2: the same reading `check-makefiles` gives the harness docs — only code is a command. */
function checkMakeTargets(readme: string): string[] {
  const makefile = join(projectRoot, "Makefile");
  if (!existsSync(makefile)) return [];
  const targets = new Set([...readFileSync(makefile, "utf-8").matchAll(/^([a-z][\w-]*):/gm)].map((m) => m[1]));
  const code = [...readme.matchAll(/```[\s\S]*?```/g), ...readme.matchAll(/`[^`\n]+`/g)].map((m) => m[0]).join("\n");
  const named = new Set([...code.matchAll(/\bmake\s+([a-z][\w-]{2,})/g)].map((m) => m[1]));
  return [...named]
    .filter((target) => !targets.has(target))
    .map((target) => `${README}: tells the reader to run \`make ${target}\`, which is not a Makefile target`);
}

/** Claim 3. */
function checkDocs(references: string[]): string[] {
  const issues: string[] = [];
  const shown = new Set(references.map((target) => normalize(decodeURIComponent(target))));
  for (const file of walk(DOCS, null)) {
    if (!shown.has(file)) {
      issues.push(`${file}: in ${DOCS}/ but not shown by ${README} — delete it, or show it`);
    }
  }
  for (const target of shown) {
    if (PICTURE.test(target) && !target.startsWith(`${DOCS}/`)) {
      issues.push(`${README}: shows ${target} from outside ${DOCS}/ — keep its pictures in ${DOCS}/, made by \`make widget-snapshots\``);
    }
  }
  return issues;
}

/** Project-relative files under `dir`; `extensions` null takes every file. */
function walk(dir: string, extensions: string[] | null): string[] {
  const abs = join(projectRoot, dir);
  if (!existsSync(abs)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (WALK_EXCLUDES.has(entry.name) || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walk(rel, extensions));
    else if (extensions === null || extensions.some((extension) => entry.name.endsWith(extension))) files.push(normalize(rel));
  }
  return files;
}

// Direct execution (make check-readme): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-readme.ts")) {
  const issues = checkReadmeSync();
  console.log("==> check-readme");
  if (issues.length === 0) {
    console.log(passLine("check-readme", "README links, make targets and pictures resolve"));
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-readme");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
