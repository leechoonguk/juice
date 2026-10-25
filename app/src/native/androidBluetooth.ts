import { NativeEventEmitter, NativeModules } from 'react-native';

/** One bonded device as `JuiceBluetooth.kt` reports it. */
export interface BluetoothDevice {
  name: string;
  address: string;
  /** `BluetoothClass.getDeviceClass()`, or null when the device has none. */
  deviceClass: number | null;
  /** The battery percentage Android knows, or null when it knows none. */
  level: number | null;
  connected: boolean;
}

/** A level or connection change the system broadcast while the app ran. */
export interface BluetoothChange {
  address: string;
  level: number | null;
}

/** The rejection code when Bluetooth permission has not been granted. */
export const PERMISSION_ERROR = 'E_PERMISSION';

interface JuiceBluetoothNative {
  connectedDevices(): Promise<BluetoothDevice[]>;
  readLeBattery(address: string): Promise<number | null>;
  notify(id: string, title: string, body: string): void;
}

function native(): JuiceBluetoothNative {
  const module = NativeModules.JuiceBluetooth as JuiceBluetoothNative | undefined;
  if (module === undefined) {
    throw new Error('JuiceBluetooth native module is not linked');
  }
  return module;
}

/** Every bonded device with its connection state and battery level. */
export function connectedDevices(): Promise<BluetoothDevice[]> {
  return native().connectedDevices();
}

/**
 * The level an LE device keeps in its own Battery Service, read over a short GATT
 * connection; null for a Classic device, one without the service, or no answer.
 */
export function readLeBattery(address: string): Promise<number | null> {
  return native().readLeBattery(address);
}

/** Shows a low-battery notification on the `low-battery` channel. */
export function notify(id: string, title: string, body: string): void {
  native().notify(id, title, body);
}

/** Calls `listener` for every level or connection change; the returned function stops it. */
export function onBluetoothChanged(listener: (change: BluetoothChange) => void): () => void {
  const subscription = new NativeEventEmitter(NativeModules.JuiceBluetooth).addListener(
    'JuiceBluetoothChanged',
    listener,
  );
  return () => subscription.remove();
}
