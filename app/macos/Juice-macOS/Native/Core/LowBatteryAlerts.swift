import Foundation

/// Which devices deserve a low-battery notification: one when a level falls to
/// the threshold or below, and none again for that device until its level has
/// risen clear of the threshold — a charge, not a reading that wobbles by one.
struct LowBatteryAlerts: Equatable {
  /// How far above the threshold a level must climb before the device may alert again.
  static let rearmMargin = 5

  /// Devices already alerted about, by identifier.
  private(set) var alerted: Set<String>

  init(alerted: Set<String> = []) {
    self.alerted = alerted
  }

  /// The devices to notify about now. A device that disappears keeps its state:
  /// a keyboard switched off at 15% does not alert again when it comes back at 15%.
  mutating func evaluate(_ snapshot: BatterySnapshot) -> [DeviceLevel] {
    var due: [DeviceLevel] = []
    for device in snapshot.devices {
      guard let percent = device.percent else { continue }
      if percent <= snapshot.threshold {
        if alerted.insert(device.identifier).inserted { due.append(device) }
      } else if percent >= snapshot.threshold + Self.rearmMargin {
        alerted.remove(device.identifier)
      }
    }
    return due
  }
}
