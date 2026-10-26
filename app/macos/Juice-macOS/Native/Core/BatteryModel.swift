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
  /// The Bluetooth vendor and product IDs the record gives (`0x009E`), when it gives them.
  var vendorID: Int? = nil
  var productID: Int? = nil

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

/// One accessory battery macOS publishes as a power source (`pmset -g accps`):
/// where it keeps the level of a headset that reports it over the hands-free
/// profile, which the system record does not carry.
struct AccessorySource: Equatable {
  let name: String
  let vendorID: Int?
  let productID: Int?
  /// `left`, `right`, `case` for a device with several batteries; nil for one.
  let part: String?
  let percent: Int
  /// The Bluetooth address when the source's `Accessory Identifier` is one (a
  /// trackpad's is, measured); earbuds give a UUID instead, so this is nil.
  var address: String? = nil
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
          var record = PairedRecord(
            name: name, address: normalizeAddress(address), isConnected: connected,
            transport: services.contains("BLE") ? "LE" : (kind != nil ? "Classic" : "?"), kind: kind,
            services: services, battery: Battery.systemLevels(fields))
          record.vendorID = hexNumber(fields["device_vendorID"])
          record.productID = hexNumber(fields["device_productID"])
          records.append(record)
        }
      }
    }
    return records
  }

  /// `0x009E` → 158; nil for anything else.
  static func hexNumber(_ value: Any?) -> Int? {
    guard let text = value as? String, text.lowercased().hasPrefix("0x") else { return nil }
    return Int(text.dropFirst(2), radix: 16)
  }

  /// `aa-00-00-00-00-01` and `AA:00:00:00:00:01` are the same address.
  static func normalizeAddress(_ address: String) -> String {
    address.uppercased().replacingOccurrences(of: "-", with: ":")
  }

  /// `text` as a normalized Bluetooth address when it is one — six hex pairs —
  /// and nil for anything else, such as a UUID.
  static func address(_ text: String) -> String? {
    let normalized = normalizeAddress(text)
    let pairs = normalized.split(separator: ":", omittingEmptySubsequences: false)
    guard pairs.count == 6, pairs.allSatisfy({ $0.count == 2 && $0.allSatisfy(\.isHexDigit) }) else { return nil }
    return normalized
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

  /// The Bluetooth accessory batteries among the power source descriptions
  /// `IOPSCopyPowerSourcesByType` returns, over Classic (`Bluetooth`) or LE
  /// (`Bluetooth LE`). A `Part Identifier` of `Single` is one battery. Earbuds
  /// come as one `Combined` source whose `Combined Parts` hold each part
  /// (`Left`, `Right`, `Case`); the parts are read and the combined figure, which
  /// would hide them, is not.
  static func accessorySources(_ descriptions: [[String: Any]]) -> [AccessorySource] {
    descriptions.flatMap { description -> [AccessorySource] in
      guard description["Type"] as? String == "Accessory Source",
        (description["Transport Type"] as? String)?.hasPrefix("Bluetooth") == true
      else { return [] }
      if let parts = description["Combined Parts"] as? [[String: Any]] {
        return accessorySources(parts)
      }
      guard let name = description["Name"] as? String,
        let current = description["Current Capacity"] as? Int,
        let maximum = description["Max Capacity"] as? Int, maximum > 0
      else { return [] }
      let percent = Int((Double(current) * 100 / Double(maximum)).rounded())
      let part = (description["Part Identifier"] as? String).map { $0.lowercased() }
      guard (0...100).contains(percent), part != "combined" else { return [] }
      var source = AccessorySource(
        name: name, vendorID: description["Vendor ID"] as? Int, productID: description["Product ID"] as? Int,
        part: part == nil || part == "single" ? nil : part, percent: percent)
      source.address = (description["Accessory Identifier"] as? String).flatMap(SystemRecord.address)
      return [source]
    }
  }

  /// The power-source readings that belong to `record`. A source that carries an
  /// address belongs to the device with that address and no other. Without one,
  /// it needs the same name — or, for earbuds' case, the name macOS gives it
  /// (`AirPods Pro Case`, measured) — and the same vendor and product where both
  /// sides give them.
  static func accessoryReadings(for record: PairedRecord, in sources: [AccessorySource]) -> [BatteryReading] {
    sources.filter { source in
      if let address = source.address { return address == record.address }
      return (source.name == record.name || (source.part == "case" && source.name == "\(record.name) Case"))
        && (source.vendorID == nil || record.vendorID == nil || source.vendorID == record.vendorID)
        && (source.productID == nil || record.productID == nil || source.productID == record.productID)
    }
    .map { BatteryReading(part: $0.part, percent: $0.percent, source: "system") }
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
