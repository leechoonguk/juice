/**
 * The window's only door to the main process: a handful of named channels,
 * with no `ipcRenderer` handed to page code.
 */
import { contextBridge, ipcRenderer } from 'electron';

import type { BatterySnapshot } from '../../src/native/juiceBattery';
import { CHANNELS, type JuiceBridge } from './bridge';

const bridge: JuiceBridge = {
  snapshot: () => ipcRenderer.invoke(CHANNELS.snapshot),
  refresh: () => ipcRenderer.invoke(CHANNELS.refresh),
  setThreshold: value => ipcRenderer.invoke(CHANNELS.setThreshold, value),
  onSnapshot: listener => {
    ipcRenderer.on(CHANNELS.snapshotChanged, (_event, snapshot: BatterySnapshot) => listener(snapshot));
  },
  updateInfo: () => ipcRenderer.invoke(CHANNELS.updateInfo),
  checkForUpdates: () => ipcRenderer.send(CHANNELS.checkForUpdates),
};

contextBridge.exposeInMainWorld('juice', bridge);
