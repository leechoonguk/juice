import Foundation

/// One paired identity from the system's own Bluetooth record.
struct PairedRecord: Equatable {
  let name: String
  /// `AA:00:00:00:00:01` — upper-case, colon-separated, whatever the source spelled.
  let address: String
  let isConnected: Bool
  /// `Classic`, `LE` or `?` — the record says LE through its `BLE` service only.
  let transport: String
  /// The system's own label (`Keyboard`, `Headphones`).
  let kind: String?
  let services: [String]
  /// Battery levels the record keeps, by part (`main`, `left`, `case`).
  let battery: [String: Int]

  /// Whether a HID battery report is worth asking for.
  var isHID: Bool {
    services.contains("HID") || ["Keyboard", "Mouse", "Trackpad", "Gamepad"].contains(kind ?? "")
  }
}

/// One battery level and the path it came by.
struct BatteryReading: Equatable {
  /// Which battery of a device that has several (`left`, `right`, `case`); nil for one.
  let part: String?
  let percent: Int
  /// `system`, `HID report`, `LE`.
  let source: String
}

/// Every reading for one connected device, and why each path that gave nothing gave nothing.
struct DeviceBattery: Equatable {
  let name: String
  let identifier: String
  let kind: String
  var readings: [BatteryReading] = []
  var notes: [String] = []
}

enum SystemRecord {
  /// The paired identities in `system_profiler SPBluetoothDataType -json`.
  static func parse(_ json: Data) -> [PairedRecord] {
    guard let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
      let section = (root["SPBluetoothDataType"] as? [[String: Any]])?.first
    else { return [] }
    var records: [PairedRecord] = []
    for (key, connected) in [("device_connected", true), ("device_not_connected", false)] {
      for entry in section[key] as? [[String: Any]] ?? [] {
        for (name, value) in entry {
          guard let fields = value as? [String: Any], let address = fields["device_address"] as? String else { continue }
          let services = (fields["device_services"] as? String).map(serviceList) ?? []
          let kind = fields["device_minorType"] as? String
          records.append(
            PairedRecord(
              name: name, address: normalizeAddress(address), isConnected: connected,
              transport: services.contains("BLE") ? "LE" : (kind != nil ? "Classic" : "?"), kind: kind,
              services: services, battery: Battery.systemLevels(fields)))
        }
      }
    }
    return records
  }

  /// `aa-00-00-00-00-01` and `AA:00:00:00:00:01` are the same address.
  static func normalizeAddress(_ address: String) -> String {
    address.uppercased().replacingOccurrences(of: "-", with: ":")
  }

  /// `0x400000 < BLE >` → `["BLE"]`.
  static func serviceList(_ text: String) -> [String] {
    guard let open = text.firstIndex(of: "<"), let close = text.lastIndex(of: ">"), open < close else { return [] }
    return text[text.index(after: open)..<close].split(separator: " ").map(String.init)
  }
}

enum Battery {
  /// The battery fields the system record keeps for a device:
  /// `device_batteryLevelLeft: "100%"` → `left: 100`. AirPods carry left, right
  /// and case; most others one `main`.
  static func systemLevels(_ fields: [String: Any]) -> [String: Int] {
    let prefix = "device_batteryLevel"
    var levels: [String: Int] = [:]
    for (key, value) in fields where key.hasPrefix(prefix) {
      let text = "\(value)".trimmingCharacters(in: CharacterSet(charactersIn: "% "))
      guard let percent = Int(text), (0...100).contains(percent) else { continue }
      levels[String(key.dropFirst(prefix.count)).lowercased()] = percent
    }
    return levels
  }

  /// An LE Battery Level (2A19) value: one byte, 0–100.
  static func levelCharacteristic(_ value: Data) -> Int? {
    guard let byte = value.first, byte <= 100 else { return nil }
    return Int(byte)
  }

  /// `devices` with an LE Battery Level for the device `name` or `identifier`
  /// names. A level the system or a HID report gave wins; an older LE level is
  /// replaced; a device nobody else listed is added.
  static func mergingLE(identifier: String, name: String, percent: Int, into devices: [DeviceBattery]) -> [DeviceBattery] {
    var devices = devices
    let reading = BatteryReading(part: nil, percent: percent, source: "LE")
    guard let at = devices.firstIndex(where: { $0.identifier == identifier || $0.name == name }) else {
      devices.append(
        DeviceBattery(name: name, identifier: identifier, kind: kind(label: nil, name: name), readings: [reading]))
      return devices
    }
    guard devices[at].readings.allSatisfy({ $0.source == "LE" }) else { return devices }
    devices[at].readings = [reading]
    devices[at].notes = []
    return devices
  }

  /// What a device is, for its icon: the system's label first, then its name.
  static func kind(label: String?, name: String) -> String {
    let text = "\(label ?? "") \(name)".lowercased()
    let kinds: [(String, [String])] = [
      ("trackpad", ["trackpad"]), ("mouse", ["mouse"]), ("keyboard", ["keyboard"]),
      ("headphones", ["headphone", "headset", "airpods", "buds"]), ("phone", ["phone"]), ("speaker", ["speaker"]),
    ]
    return kinds.first { _, words in words.contains { text.contains($0) } }?.0 ?? "other"
  }

  /// The snapshot the app publishes: each device's lowest reading, devices
  /// with a level first and lowest first, then the rest by name.
  static func snapshot(_ devices: [DeviceBattery], threshold: Int, now: Date) -> BatterySnapshot {
    let levels = devices.map { device -> DeviceLevel in
      let lowest = device.readings.min { $0.percent < $1.percent }
      let parts = device.readings.reduce(into: [String: Int]()) { parts, reading in
        if let part = reading.part { parts[part] = reading.percent }
      }
      return DeviceLevel(
        name: device.name, identifier: device.identifier, percent: lowest?.percent, parts: parts,
        source: lowest?.source, note: lowest == nil ? device.notes.first : nil, kind: device.kind)
    }
    let ordered = levels.sorted { left, right in
      switch (left.percent, right.percent) {
      case let (l?, r?): return l != r ? l < r : left.name < right.name
      case (.some, .none): return true
      case (.none, .some): return false
      case (.none, .none): return left.name < right.name
      }
    }
    return BatterySnapshot(devices: ordered, threshold: threshold, updatedAt: now)
  }

  /// The snapshot as React Native receives it: plain JSON values, the time in
  /// milliseconds since 1970, which is what JavaScript's `Date` takes. A device
  /// without a level carries explicit nulls: the synthesized encoder omits nil
  /// keys, and an omitted key reaches JavaScript as `undefined`, not `null`.
  static func payload(_ snapshot: BatterySnapshot) -> [String: Any] {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    guard let data = try? encoder.encode(snapshot),
      var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [:] }
    object["devices"] = (object["devices"] as? [[String: Any]] ?? []).map { device in
      var device = device
      for key in ["percent", "source", "note"] where device[key] == nil {
        device[key] = NSNull()
      }
      return device
    }
    return object
  }
}
