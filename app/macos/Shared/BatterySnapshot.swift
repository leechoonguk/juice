import Foundation

/// One connected device's battery as the widget and the menu draw it.
struct DeviceLevel: Codable, Equatable, Identifiable {
  let name: String
  /// The real Bluetooth address, or this Mac's identifier for an LE-only device.
  let identifier: String
  /// The lowest level among the device's batteries (AirPods: left, right, case), or nil when none was read.
  let percent: Int?
  /// `left 90%, right 88%` when a device has several batteries.
  let parts: [String: Int]
  /// How the level was read: `system`, `HID report`, `LE`.
  let source: String?
  /// Why there is no level, when there is none.
  let note: String?
  /// What it is, for the icon: `keyboard`, `mouse`, `trackpad`, `headphones`, `phone`, `speaker`, `other`.
  let kind: String

  var id: String { identifier }
}

/// What the app publishes after each read: the app writes it, the widget and
/// the menu bar item read it.
///
/// Compiled into both the app and the widget extension. They are separate
/// processes with separate sandboxes, so the only channel between them is the
/// App Group container.
struct BatterySnapshot: Codable, Equatable {
  /// Devices with a level first, lowest level first; then those without one.
  let devices: [DeviceLevel]
  /// The level at or below which a device counts as low.
  let threshold: Int
  let updatedAt: Date

  /// The devices that are at or below the threshold.
  var low: [DeviceLevel] {
    devices.filter { ($0.percent ?? 101) <= threshold }
  }

  /// Shown in the widget gallery and before the app has published anything.
  static let sample = BatterySnapshot(
    devices: [
      DeviceLevel(
        name: "Keyboard", identifier: "sample-1", percent: 18, parts: [:], source: "HID report", note: nil,
        kind: "keyboard"),
      DeviceLevel(
        name: "Trackpad", identifier: "sample-2", percent: 64, parts: [:], source: "system", note: nil,
        kind: "trackpad"),
      DeviceLevel(
        name: "Headphones", identifier: "sample-3", percent: 90, parts: [:], source: "system", note: nil,
        kind: "headphones"),
    ],
    threshold: 20, updatedAt: Date(timeIntervalSince1970: 0))
}

/// The App Group container both processes can read and write.
///
/// Files, not `UserDefaults`: with an ad-hoc signature the group has no team
/// prefix, and cfprefsd then refuses to share a suite between the app and the
/// widget ("only allowed for System Containers") while the container directory
/// itself works for both. Writes are atomic, so a reader never sees a torn file.
struct SharedStore {
  /// Info.plist key holding the App Group identifier.
  ///
  /// The value is `$(TeamIdentifierPrefix)juice`, expanded at build time, so
  /// both targets read the same group without hardcoding a team.
  static let appGroupInfoKey = "AppGroupIdentifier"

  let directory: URL

  /// The store for this process's App Group, or nil when the bundle names none.
  init?(bundle: Bundle = .main) {
    guard let group = bundle.object(forInfoDictionaryKey: Self.appGroupInfoKey) as? String,
      !group.isEmpty,
      let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    directory = container.appendingPathComponent("Juice", isDirectory: true)
  }

  init(directory: URL) {
    self.directory = directory
  }

  func write<Value: Encodable>(_ value: Value, as name: String) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try JSONEncoder().encode(value).write(to: directory.appendingPathComponent(name), options: .atomic)
  }

  func read<Value: Decodable>(_ type: Value.Type, from name: String) -> Value? {
    guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }
}

/// The single published snapshot.
enum SnapshotStore {
  static let file = "batteries.json"

  static func save(_ snapshot: BatterySnapshot, to store: SharedStore) throws {
    try store.write(snapshot, as: file)
  }

  static func load(from store: SharedStore) -> BatterySnapshot? {
    store.read(BatterySnapshot.self, from: file)
  }
}
