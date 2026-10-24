/**
 * What the app remembers between runs: the low-battery threshold and the
 * devices already alerted for. One small JSON file in the user-data folder; a
 * missing or damaged file is a first run, never an error.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { clampThreshold, DEFAULT_THRESHOLD } from '../../src/snapshot';

export interface Settings {
  threshold: number;
  /** Identifiers of the devices that have alerted and not yet been charged clear of the threshold. */
  alerted: string[];
}

export function loadSettings(file: string): Settings {
  try {
    const stored: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const { threshold, alerted } = (stored ?? {}) as { threshold?: unknown; alerted?: unknown };
    return {
      threshold: typeof threshold === 'number' ? clampThreshold(threshold) : DEFAULT_THRESHOLD,
      alerted: Array.isArray(alerted) ? alerted.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return { threshold: DEFAULT_THRESHOLD, alerted: [] };
  }
}

/** Writes beside the file and renames over it, so a crash never leaves half a file. */
export function saveSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  const pending = `${file}.tmp`;
  writeFileSync(pending, JSON.stringify(settings));
  renameSync(pending, file);
}
