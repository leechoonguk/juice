import Foundation

/// When Juice reads batteries, after Apple's own Batteries widget.
///
/// Apple's BatteryCenter keeps no timer: it re-reads its power sources when the
/// system posts `com.apple.system.accpowersources.source` or `.attach`. Juice
/// listens for the same notifications, for Bluetooth connections, for wake, and
/// for LE Battery Level notifications, and reads on those. What never posts — a
/// keyboard whose battery sits in a HID report it does not send on its own — is
/// read by a backstop poll that each read pushes back.
enum RefreshPolicy {
  enum Trigger: Equatable {
    case launch, wake, powerSourceChanged, connectionChanged, menuOpened, requested, poll
  }

  /// The Darwin notifications BatteryCenter subscribes to for accessory batteries.
  static let powerSourceNotifications = [
    "com.apple.system.accpowersources.source",
    "com.apple.system.accpowersources.attach",
  ]

  /// The backstop for devices that never announce a change. A keyboard loses
  /// about a point an hour, so a quarter-hour keeps the level within one.
  static let pollInterval: TimeInterval = 15 * 60
  /// Slack the system may add to the poll, so it can batch wake-ups.
  static let pollTolerance: TimeInterval = 60
  /// Events arrive in bursts (attach, then source, then a connection); one read answers them all.
  static let coalescing: TimeInterval = 2
  /// Opening the menu reads again only when what it would show is older than this.
  static let freshness: TimeInterval = 60

  /// Whether `trigger` should start a read, given when the last one finished.
  static func shouldRead(_ trigger: Trigger, lastRead: Date?, now: Date) -> Bool {
    guard trigger == .menuOpened, let lastRead else { return true }
    return now.timeIntervalSince(lastRead) >= freshness
  }
  /// How long to wait before reading for `trigger`: a person's request reads at
  /// once; anything the system posts waits for the rest of its burst — launch
  /// too, as IOBluetooth reports every connected device the moment it is asked.
  static func delay(for trigger: Trigger) -> TimeInterval {
    switch trigger {
    case .requested, .menuOpened: return 0
    case .launch, .wake, .powerSourceChanged, .connectionChanged, .poll: return coalescing
    }
  }
}
