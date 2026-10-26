/**
 * Stands in for `../updates` in the demo bundle (and nowhere else — `build.ts`
 * swaps it in under `JUICE_DEMO=1`): the window's footer shows the latest
 * release's version, which `build.ts` reads from git, and nothing ever checks
 * for an update.
 */
import type { UpdateInfo } from '../../../src/native/appUpdates';

/** Defined by `build.ts` in the demo bundle. */
declare const __DEMO_VERSION__: string;

export function updatesSupported(): boolean {
  return false;
}

export function updateInfo(): UpdateInfo {
  return { version: __DEMO_VERSION__, canCheck: false };
}

export function startUpdates(): void {}

export async function checkForUpdates(): Promise<void> {}
