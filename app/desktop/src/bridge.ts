/**
 * The contract between the main process, which reads the batteries, and the
 * window: channel names both sides import, so they cannot diverge, and the
 * shape `preload.ts` exposes as `window.juice`.
 */
import type { UpdateInfo } from '../../src/native/appUpdates';
import type { BatterySnapshot } from '../../src/native/juiceBattery';

export const CHANNELS = {
  /** window → main (invoke): the last snapshot, or null before the first read has finished. */
  snapshot: 'juice:snapshot',
  /** window → main (invoke): read every device now. */
  refresh: 'juice:refresh',
  /** window → main (invoke): store the threshold, answer the snapshot judged by it. */
  setThreshold: 'juice:set-threshold',
  /** main → window: a snapshot was published. */
  snapshotChanged: 'juice:snapshot-changed',
  /** window → main (invoke): the running version and whether this build can update. */
  updateInfo: 'juice:update-info',
  /** window → main: run an update check the user asked for. */
  checkForUpdates: 'juice:check-for-updates',
};

/** What the window may ask of the main process, and nothing else. */
export interface JuiceBridge {
  snapshot(): Promise<BatterySnapshot | null>;
  refresh(): Promise<BatterySnapshot>;
  setThreshold(value: number): Promise<BatterySnapshot | null>;
  onSnapshot(listener: (snapshot: BatterySnapshot) => void): void;
  updateInfo(): Promise<UpdateInfo>;
  checkForUpdates(): void;
}
