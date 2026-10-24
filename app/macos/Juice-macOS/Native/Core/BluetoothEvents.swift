import Foundation
import IOBluetooth
import notify

/// The system events that mean a battery may have changed: the accessory
/// power-source notifications Apple's Batteries widget reads on, and Classic
/// Bluetooth connections and disconnections. Each calls `changed` on the main queue.
final class BluetoothEvents: NSObject {
  private var changed: (RefreshPolicy.Trigger) -> Void = { _ in }
  private var tokens: [Int32] = []
  private var connections: IOBluetoothUserNotification?
  private var disconnections: [IOBluetoothUserNotification] = []

  func start(_ changed: @escaping (RefreshPolicy.Trigger) -> Void) {
    self.changed = changed
    for name in RefreshPolicy.powerSourceNotifications {
      var token: Int32 = 0
      let status = notify_register_dispatch(name, &token, .main) { [weak self] _ in
        self?.changed(.powerSourceChanged)
      }
      if status == UInt32(NOTIFY_STATUS_OK) { tokens.append(token) }
    }
    // Fires once for every device already connected, then for each new connection.
    connections = IOBluetoothDevice.register(forConnectNotifications: self, selector: #selector(connected(_:device:)))
  }

  deinit {
    tokens.forEach { notify_cancel($0) }
    connections?.unregister()
    disconnections.forEach { $0.unregister() }
  }

  @objc private func connected(_ notification: IOBluetoothUserNotification, device: IOBluetoothDevice) {
    if let watch = device.register(forDisconnectNotification: self, selector: #selector(disconnected(_:device:))) {
      disconnections.append(watch)
    }
    changed(.connectionChanged)
  }

  @objc private func disconnected(_ notification: IOBluetoothUserNotification, device: IOBluetoothDevice) {
    notification.unregister()
    disconnections.removeAll { $0 === notification }
    changed(.connectionChanged)
  }
}
