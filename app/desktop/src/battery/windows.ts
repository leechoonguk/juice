/**
 * Windows: the Bluetooth devices Plug and Play knows (`BTHENUM` for classic,
 * `BTHLE` for LE) and the battery level Windows stores on each in
 * DEVPKEY_Bluetooth_Battery. PowerShell answers as JSON; `parseWindowsDevices`
 * turns that into one entry per device.
 */
import { execFile } from 'node:child_process';

import { type DeviceBattery, deviceKind, normalizeAddress, percentage } from '../../../src/snapshot';

const SOURCE = 'Windows';
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const NO_LEVEL = 'Windows reports no battery level for this device';

/** The device node of a Bluetooth device: `BTHENUM\DEV_<address>\…` or `BTHLE\DEV_<address>\…`. */
const DEVICE_NODE = /^BTH(?:ENUM|LE)\\DEV_([0-9A-F]{12})(?:\\|$)/i;

/**
 * Output is forced to UTF-8 so a device name with accents survives the pipe.
 * Only a device's own nodes are asked for properties, as `DEVICE_NODE` keeps
 * only those: each service node would cost two more property calls.
 */
export const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$battery = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$connection = '{83DA6326-97A6-4088-9453-A1923F573B29} 15'
$found = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'BTHENUM\\DEV_*' -or $_.InstanceId -like 'BTHLE\\DEV_*' } | ForEach-Object {
  $level = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $battery -ErrorAction SilentlyContinue
  $state = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $connection -ErrorAction SilentlyContinue
  [pscustomobject]@{
    FriendlyName = $_.FriendlyName
    InstanceId = $_.InstanceId
    Status = [string]$_.Status
    Class = $_.Class
    Battery = $level.Data
    Connected = $state.Data
  }
})
ConvertTo-Json -InputObject $found -Compress
`;

interface PnpRecord {
  FriendlyName?: unknown;
  InstanceId?: unknown;
  Status?: unknown;
  Class?: unknown;
  Battery?: unknown;
  Connected?: unknown;
}

interface Accumulated {
  name: string | null;
  classes: string[];
  levels: number[];
  /** Nodes seen, and how many of them say the device is not connected. */
  nodes: number;
  disconnected: number;
}

export function readWindows(): Promise<DeviceBattery[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', SCRIPT],
      { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`PowerShell could not list the Bluetooth devices: ${stderr.trim() || error.message}`));
          return;
        }
        try {
          resolve(parseWindowsDevices(stdout));
        } catch (cause) {
          reject(new Error(`PowerShell answered something other than JSON: ${String(cause)}`));
        }
      },
    );
  });
}

/**
 * One device per address, whichever of its `BTHENUM` and `BTHLE` nodes carry the
 * name and the level. Present nodes that are not a device's own (services, a
 * node that is not `OK`) are left out, and so is a device every node of which
 * says it is not connected; a node that says nothing about it counts as unknown
 * and keeps the device. With several levels the lowest counts.
 */
export function parseWindowsDevices(json: string): DeviceBattery[] {
  const text = json.replace(/^\uFEFF/, '').trim();
  if (text === '') {
    return [];
  }
  const parsed: unknown = JSON.parse(text);
  const records = (Array.isArray(parsed) ? parsed : [parsed]) as PnpRecord[];
  const byAddress = new Map<string, Accumulated>();
  for (const record of records) {
    const match = typeof record.InstanceId === 'string' ? DEVICE_NODE.exec(record.InstanceId) : null;
    if (match === null || (typeof record.Status === 'string' && record.Status !== 'OK')) {
      continue;
    }
    const address = normalizeAddress(match[1]);
    const entry = byAddress.get(address) ?? { name: null, classes: [], levels: [], nodes: 0, disconnected: 0 };
    entry.nodes += 1;
    entry.disconnected += record.Connected === false ? 1 : 0;
    const name = typeof record.FriendlyName === 'string' ? record.FriendlyName.trim() : '';
    entry.name ??= name === '' ? null : name;
    if (typeof record.Class === 'string') {
      entry.classes.push(record.Class);
    }
    const level = percentage(record.Battery);
    if (level !== null) {
      entry.levels.push(level);
    }
    byAddress.set(address, entry);
  }
  return [...byAddress]
    .filter(([, { nodes, disconnected }]) => disconnected < nodes)
    .map(([address, { name, classes, levels }]): DeviceBattery => {
      const label = name ?? address;
      return {
        name: label,
        identifier: address,
        kind: deviceKind(classes.join(' '), label),
        readings: levels.length === 0 ? [] : [{ part: null, percent: Math.min(...levels), source: SOURCE }],
        notes: levels.length === 0 ? [NO_LEVEL] : [],
      };
    });
}
