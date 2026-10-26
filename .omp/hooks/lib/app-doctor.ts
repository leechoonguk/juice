/**
 * `make doctor` — the environment Juice runs and signs in (rule://app-macos-project),
 * read without changing it. Every fact below once cost a session of log forensics:
 *
 *   1. one registered copy: every bundle Launch Services registers under the bundle
 *      id is listed with its path and version; a copy besides `/Applications` and the
 *      Debug build is a finding (a second menu bar icon, a second widget provider)
 *   2. the widget: the registration pluginkit chose must belong to the app that
 *      runs, and no registration may belong to a stray copy
 *   3. signing: a valid code-signing identity whose team equals the project's
 *      `DEVELOPMENT_TEAM` (an ad-hoc build loses the App Group prefix, and macOS
 *      then denies the shared container without ever prompting), and Apple's
 *      WWDR G3 intermediate certificate (without it a fresh identity never validates)
 *   4. the toolchain: `xcode-select -p` is Xcode, not the Command Line Tools, when
 *      Xcode is installed
 *   5. battery coverage: every Bluetooth accessory macOS has a level for
 *      (`pmset -g accps`, the app's own source for headsets, trackpads and earbuds)
 *      has that level in the snapshot the app last published to the App Group
 *      container — matched by name, the earbuds' case as `<name> Case`; one the
 *      snapshot lists without a level, or not at all, is a finding (a reader that
 *      lost a device the Mac still knows the battery of); a container macOS keeps
 *      from this shell (EPERM) is reported as skipped, not as a finding —
 *      `make battery-probe` makes the comparison through the app's own reader
 *
 * Metro's port is reported too; `requireMetro` is what `make run` calls first,
 * because Debug loads its JavaScript from Metro and an empty window is the symptom
 * of its absence.
 *
 *   node app-doctor.ts           print the report, exit 1 when there is a finding
 *   node app-doctor.ts metro     exit 1 unless Metro answers on 8081
 *
 * Run through `make doctor` and `make run`. Reads Launch Services, pluginkit, the
 * keychain, the power sources, the published snapshot and the process table;
 * registers, unregisters and installs nothing.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { homedir } from "node:os";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { DEBUG_APP, INSTALLED_APP, registeredCopies, runningApps, widgetRegistrations } from "./app-launch-services.ts";
import { projectRoot } from "./hook-project-root.ts";

// ============================================================
// Constants
// ============================================================

const PROJECT_FILE = "app/macos/Juice.xcodeproj/project.pbxproj";
const METRO_STATUS_URL = "http://localhost:8081/status";
const XCODE_APP = "/Applications/Xcode.app";
const WWDR_NAME = "Apple Worldwide Developer Relations Certification Authority";
/** Said by `make run` and by the doctor alike: the one fix for a Debug app with no Metro. */
export const METRO_MESSAGE = "Debug loads its JS from Metro — run `make start` first (or install a Release with `make app-install`)";

/** What `SnapshotStore` writes (app/macos/Shared/BatterySnapshot.swift), under `<App Group>/Juice/`. */
const SNAPSHOT_FILE = "batteries.json";
/** The App Group is `$(TeamIdentifierPrefix)juice` (the `AppGroupIdentifier` of both Info.plists). */
const APP_GROUP_SUFFIX = "juice";

interface Section {
  title: string;
  lines: string[];
}

// ============================================================
// Commands
// ============================================================

/** Prints the report; the exit code is 1 when any section reports a finding. */
export function doctor(): number {
  const findings: string[] = [];
  const sections = [copies(findings), widget(findings), accessories(findings), signing(findings), toolchain(findings), metro()];
  console.log("==> doctor (read-only: Launch Services, pluginkit, power sources, published snapshot, keychain, processes)");
  for (const section of sections) {
    console.log(`${section.title}:`);
    for (const line of section.lines) console.log(`  ${line}`);
  }
  if (findings.length === 0) {
    console.log("==> doctor: no findings");
    return 0;
  }
  console.log(`==> doctor: ${findings.length} finding(s)`);
  for (const finding of findings) console.log(`  - ${finding}`);
  return 1;
}

/** Fails unless Metro answers — before the minutes of an Xcode build that would launch an empty window. */
export function requireMetro(): void {
  const answer = spawnSync("curl", ["-fsS", "--max-time", "2", METRO_STATUS_URL], { encoding: "utf8" });
  if (answer.status !== 0) {
    console.error(`run: nothing answers on 8081. ${METRO_MESSAGE}`);
    process.exit(1);
  }
  if (!String(answer.stdout).includes("packager-status:running")) {
    console.error(`run: 8081 answers, but not as Metro. ${METRO_MESSAGE}`);
    process.exit(1);
  }
}

// ============================================================
// Sections
// ============================================================

/** Every registered copy; the allowed ones are `/Applications` and the Debug build. */
function copies(findings: string[]): Section {
  const section: Section = { title: "copies registered for com.uk.juice", lines: [] };
  try {
    const registered = registeredCopies();
    for (const copy of registered) {
      const role = copy.path === INSTALLED_APP ? "installed" : copy.path === DEBUG_APP ? "debug build" : "STRAY";
      section.lines.push(`${copy.path}  ${copy.version}  ${role}${copy.exists ? "" : " (missing on disk)"}`);
    }
    if (registered.length === 0) section.lines.push("none");
    const stray = registered.filter((copy) => copy.path !== INSTALLED_APP && copy.path !== DEBUG_APP);
    if (stray.length > 0) {
      findings.push(
        `${stray.length} registered ${stray.length === 1 ? "copy is" : "copies are"} neither ${INSTALLED_APP} nor the Debug build ` +
          `(${stray.map((copy) => copy.path).join(", ")}) — \`make run\` unregisters them, \`make app-install\` too`,
      );
    }
  } catch (error) {
    findings.push(`Launch Services is unreadable: ${message(error)}`);
  }
  return section;
}

/** The widget pluginkit chose against the app that runs. */
function widget(findings: string[]): Section {
  const section: Section = { title: "widget com.uk.juice.widget and running processes", lines: [] };
  try {
    const chosen = widgetRegistrations(false)[0];
    const all = widgetRegistrations(true);
    const running = runningApps();
    section.lines.push(chosen === undefined ? "chosen: none" : `chosen: ${chosen.path}  ${chosen.version}`);
    section.lines.push(`registered: ${all.map((registration) => registration.parent).join(", ") || "none"}`);
    section.lines.push(running.length === 0 ? "running: Juice is not running" : `running: ${running.map((app) => `${app.path} (pid ${app.pid})`).join(", ")}`);

    for (const registration of all.filter((one) => one.parent !== INSTALLED_APP && one.parent !== DEBUG_APP)) {
      findings.push(`the widget is registered from ${registration.parent}, a copy that is neither installed nor the Debug build`);
    }
    if (chosen === undefined && all.length === 0) findings.push("no widget extension is registered — the widget gallery has no Juice");
    if (running.length > 1) findings.push(`${running.length} Juice processes run — the menu bar shows ${running.length} icons`);
    if (chosen !== undefined && running.length > 0 && !running.some((app) => app.path === chosen.parent)) {
      findings.push(
        `the widget points at ${chosen.parent}, but ${running.map((app) => app.path).join(", ")} runs — ` +
          "its buttons talk to an app that is not the one on screen",
      );
    }
  } catch (error) {
    findings.push(`pluginkit or the process table is unreadable: ${message(error)}`);
  }
  return section;
}

/** Every Bluetooth accessory macOS has a level for, against the snapshot the app last published. */
function accessories(findings: string[]): Section {
  const section: Section = { title: "accessory batteries (macOS power sources against the published snapshot)", lines: [] };
  try {
    const published = readSnapshot();
    if (published === null) {
      section.lines.push("battery coverage: skipped — macOS keeps Juice's container from this shell; `make battery-probe` compares instead");
      return section;
    }
    const coverage = accessoryCoverage(accessorySources(powerSourceDescriptions()), published.devices);
    const ageMinutes = Math.round((Date.now() - published.updatedAt) / 60_000);
    section.lines.push(`snapshot: ${published.path.replace(homedir(), "~")}, published ${ageMinutes} min ago, ${published.devices.length} device(s)`);
    if (coverage.length === 0) section.lines.push("macOS lists no Bluetooth accessory with a level");
    for (const { source, status } of coverage) {
      section.lines.push(`${accessoryLabel(source)}  ${source.percent}%  ${status}`);
      if (status === "covered") continue;
      findings.push(
        `macOS has a level for ${accessoryLabel(source)} (${source.percent}%) but the snapshot ` +
          `${status === "no level" ? "lists it without one" : "does not list it"} — the app's reader lost a battery the system still reports ` +
          "(`make battery-probe` shows what the reader sees; `make app-logs` follows the refresh)",
      );
    }
  } catch (error) {
    findings.push(`accessory battery coverage is unverifiable: ${message(error)}`);
  }
  return section;
}

/** The signing chain: a valid identity of the project's team, and the WWDR G3 intermediate. */
function signing(findings: string[]): Section {
  const section: Section = { title: "signing", lines: [] };
  try {
    const teams = projectTeams();
    section.lines.push(`project DEVELOPMENT_TEAM: ${teams.join(", ") || "none"}`);
    if (teams.length !== 1) findings.push(`${PROJECT_FILE} names ${teams.length} development teams — it must name exactly one`);

    const identities = [...run("security", ["find-identity", "-v", "-p", "codesigning"]).matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+)"\s*$/gm)];
    if (identities.length === 0) {
      section.lines.push("identity: none valid");
      findings.push(
        "no valid code-signing identity in the keychain — builds sign ad-hoc, the App Group loses its team prefix and " +
          "macOS denies the shared container without prompting (sign in to Xcode > Settings > Accounts and create an Apple Development certificate)",
      );
    }
    const identityTeams: string[] = [];
    for (const [, hash, name] of identities) {
      const team = certificateFields(certificatePem(name, hash)).unit ?? "unknown";
      identityTeams.push(team);
      section.lines.push(`identity: ${name}  team ${team}`);
    }
    if (identities.length > 0 && teams.length === 1 && !identityTeams.includes(teams[0])) {
      findings.push(`no valid identity belongs to team ${teams[0]} (identities: ${identityTeams.join(", ")}) — the build would sign with another team's App Group prefix`);
    }

    const intermediates = wwdrCertificates().filter((pem) => {
      const fields = certificateFields(pem);
      return fields.unit === "G3" && fields.valid;
    });
    section.lines.push(`WWDR G3 intermediate: ${intermediates.length > 0 ? "present" : "missing"}`);
    if (intermediates.length === 0) {
      findings.push(
        "Apple's WWDR G3 intermediate certificate is not in the keychain — a new development certificate never validates; " +
          "download AppleWWDRCAG3.cer from apple.com/certificateauthority and add it to the login keychain",
      );
    }
  } catch (error) {
    findings.push(`the signing chain is unreadable: ${message(error)}`);
  }
  return section;
}

/** Xcode, not the Command Line Tools, when Xcode exists: `xcodebuild` and the widget gallery need it. */
function toolchain(findings: string[]): Section {
  const section: Section = { title: "toolchain", lines: [] };
  try {
    const developer = run("xcode-select", ["-p"]).trim();
    section.lines.push(`xcode-select -p: ${developer}`);
    if (existsSync(XCODE_APP) && developer.includes("CommandLineTools")) {
      findings.push(`xcode-select points at the Command Line Tools while ${XCODE_APP} exists — sudo xcode-select -s ${XCODE_APP}/Contents/Developer`);
    }
  } catch (error) {
    findings.push(`xcode-select is unreadable: ${message(error)}`);
  }
  return section;
}

/** Whether Metro answers; informational, because a Release build does not need it. */
function metro(): Section {
  const answer = spawnSync("curl", ["-fsS", "--max-time", "2", METRO_STATUS_URL], { encoding: "utf8" });
  const running = answer.status === 0 && String(answer.stdout).includes("packager-status:running");
  return { title: "metro", lines: [running ? "answers on 8081" : "nothing answers on 8081 (Debug needs `make start`)"] };
}

// ============================================================
// Helpers
// ============================================================

/** The distinct `DEVELOPMENT_TEAM` values of the Xcode project. */
function projectTeams(): string[] {
  const path = join(projectRoot, PROJECT_FILE);
  if (!existsSync(path)) return [];
  return [...new Set([...readFileSync(path, "utf-8").matchAll(/DEVELOPMENT_TEAM = "?([A-Z0-9]+)"?;/g)].map((match) => match[1]))];
}

/** One Bluetooth accessory battery macOS publishes as a power source; `part` is `left`, `right` or `case` for earbuds, absent for one battery. */
export interface AccessorySource {
  name: string;
  /** The Bluetooth address when `Accessory Identifier` is one; earbuds give a UUID. */
  address?: string;
  part?: string;
  percent: number;
}

/** The device fields of the published snapshot (`DeviceLevel`) the coverage compares; the encoder omits a nil `percent`. */
export interface SnapshotDevice {
  name: string;
  identifier: string;
  percent?: number;
  parts: Record<string, number>;
}

/** The power source fields `pmset -g accps -xml` carries that the coverage reads. */
export interface PowerSource {
  Type?: string;
  Name?: string;
  "Transport Type"?: string;
  "Accessory Identifier"?: string;
  "Current Capacity"?: number;
  "Max Capacity"?: number;
  "Part Identifier"?: string;
  "Combined Parts"?: PowerSource[];
}

export interface AccessoryCoverage {
  source: AccessorySource;
  /** `covered`; `no level` when the snapshot lists the device without this level; `not listed` when it lists no such device. */
  status: "covered" | "no level" | "not listed";
}

/**
 * The Bluetooth accessory batteries among the power source descriptions
 * `pmset -g accps -xml` prints — the rule `Battery.accessorySources` applies in
 * the app: `Accessory Source`, transport `Bluetooth…`, earbuds as `Combined Parts`
 * of which the `Combined` figure itself is not one.
 */
export function accessorySources(descriptions: PowerSource[]): AccessorySource[] {
  return descriptions.flatMap((description): AccessorySource[] => {
    const transport = description["Transport Type"];
    if (description.Type !== "Accessory Source" || transport === undefined || !transport.startsWith("Bluetooth")) return [];
    const combined = description["Combined Parts"];
    if (combined !== undefined) return accessorySources(combined);
    const current = description["Current Capacity"];
    const maximum = description["Max Capacity"];
    if (description.Name === undefined || current === undefined || maximum === undefined || maximum <= 0) return [];
    const percent = Math.round((current * 100) / maximum);
    const part = description["Part Identifier"]?.toLowerCase();
    if (percent < 0 || percent > 100 || part === "combined") return [];
    const identifier = description["Accessory Identifier"] ?? "";
    return [
      {
        name: description.Name,
        address: /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(identifier) ? identifier.toUpperCase().replace(/-/g, ":") : undefined,
        part: part === undefined || part === "single" ? undefined : part,
        percent,
      },
    ];
  });
}

/**
 * Each source against the snapshot's devices: a device is the source's own when
 * its identifier is the source's address or its name is the source's name (the
 * earbuds' case: `<device name> Case`), apostrophes alike. It has the level when
 * it carries the part (`parts.left`, `parts.case`), or, for a single battery, a percent.
 */
export function accessoryCoverage(sources: AccessorySource[], devices: SnapshotDevice[]): AccessoryCoverage[] {
  const plain = (name: string): string => name.replace(/[\u2018\u2019]/g, "'").trim();
  return sources.map((source) => {
    const own = devices.filter(
      (device) =>
        (source.address !== undefined && device.identifier.toUpperCase() === source.address) ||
        plain(device.name) === plain(source.name) ||
        (source.part === "case" && `${plain(device.name)} Case` === plain(source.name)),
    );
    const hasLevel = own.some((device) =>
      source.part === undefined ? device.percent !== undefined : device.parts[source.part] !== undefined,
    );
    return { source, status: hasLevel ? "covered" : own.length > 0 ? "no level" : "not listed" };
  });
}

/** `name` or `name (case)`. */
function accessoryLabel(source: AccessorySource): string {
  return source.part === undefined ? source.name : `${source.name} (${source.part})`;
}

/** `pmset -g accps -xml` — the text form is not UTF-8 and has no transport — one plist per source, each converted through `plutil`. */
export function powerSourceDescriptions(): PowerSource[] {
  const documents = run("pmset", ["-g", "accps", "-xml"]).split(/(?=<\?xml )/).filter((document) => document.trim() !== "");
  return documents.flatMap((document) => {
    const converted = spawnSync("plutil", ["-convert", "json", "-o", "-", "-"], { input: document, encoding: "utf8" });
    if (converted.status !== 0) throw new Error(`plutil cannot read the power sources: ${String(converted.stderr).trim()}`);
    const parsed: PowerSource | PowerSource[] = JSON.parse(String(converted.stdout));
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

/**
 * The snapshot the app last published into its App Group container (`SnapshotStore`), with
 * its path and time; null when macOS keeps the container from this shell, which protects
 * another app's data and says nothing about the setup.
 */
function readSnapshot(): { path: string; devices: SnapshotDevice[]; updatedAt: number } | null {
  const teams = projectTeams();
  if (teams.length === 0) throw new Error("the Xcode project names no DEVELOPMENT_TEAM, so the App Group container is unknown");
  for (const team of teams) {
    const path = join(homedir(), "Library", "Group Containers", `${team}.${APP_GROUP_SUFFIX}`, "Juice", SNAPSHOT_FILE);
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") continue;
      if (code === "EPERM" || code === "EACCES") return null;
      throw error;
    }
    const snapshot: { devices: SnapshotDevice[]; updatedAt: number } = JSON.parse(text);
    if (!Array.isArray(snapshot.devices) || typeof snapshot.updatedAt !== "number") {
      throw new Error(`${path.replace(homedir(), "~")} is not a BatterySnapshot (devices, updatedAt) — the snapshot format changed`);
    }
    // Foundation's default date encoding is seconds since its reference date, 978_307_200 s after the Unix epoch.
    return { path, devices: snapshot.devices, updatedAt: (snapshot.updatedAt + 978_307_200) * 1000 };
  }
  throw new Error(`no snapshot at ~/Library/Group Containers/<team>.${APP_GROUP_SUFFIX}/Juice/${SNAPSHOT_FILE} — the app has not published one yet (is Juice running?)`);
}

/** The PEM of the certificate behind an identity: the keychain entry named `name` whose SHA-1 is `hash`. */
function certificatePem(name: string, hash: string): string {
  const listing = run("security", ["find-certificate", "-a", "-Z", "-p", "-c", name]);
  for (const chunk of listing.split(/^SHA-256 hash: .*$/m)) {
    if (chunk.includes(`SHA-1 hash: ${hash}`)) return /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/.exec(chunk)?.[0] ?? "";
  }
  return "";
}

/** Every WWDR intermediate certificate in the keychains, as PEM. */
function wwdrCertificates(): string[] {
  const listing = run("security", ["find-certificate", "-a", "-p", "-c", WWDR_NAME]);
  return [...listing.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map((match) => match[0]);
}

/** The certificate's organizational unit — the team of a development certificate, the generation of an Apple CA — and whether it has not expired. */
function certificateFields(pem: string): { unit?: string; valid: boolean } {
  const subject = spawnSync("openssl", ["x509", "-noout", "-subject", "-nameopt", "RFC2253"], { input: pem, encoding: "utf8" });
  const alive = spawnSync("openssl", ["x509", "-noout", "-checkend", "0"], { input: pem, encoding: "utf8" });
  const unit = /(?:^|,)OU=([^,\n]+)/.exec(String(subject.stdout))?.[1];
  return { unit, valid: alive.status === 0 };
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(" ")} … exited ${result.status ?? result.signal}`);
  return String(result.stdout);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================
// CLI
// ============================================================

if (typeof process !== "undefined" && process.argv[1]?.endsWith("app-doctor.ts")) {
  const command = process.argv[2];
  if (command === "metro") requireMetro();
  else if (command === undefined) process.exit(doctor());
  else {
    console.error("usage: app-doctor.ts [metro]");
    process.exit(2);
  }
}
