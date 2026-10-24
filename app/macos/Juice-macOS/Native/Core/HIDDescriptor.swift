import Foundation

/// One place a HID descriptor puts a battery level: which usage, in which kind
/// of report, under which report ID, where in it and over what range — what
/// reading it takes.
public struct HIDBatteryField: Equatable, Sendable, Encodable {
  public let usage: String
  /// `input` (the device sends it), `feature` (the host asks for it), `output`;
  /// nil when the usage only names a collection.
  public let report: String?
  public let reportID: UInt8?
  public let bits: Int?
  /// Bit position in the report's data, after its report-ID byte.
  public let bitOffset: Int?
  public let logicalMin: Int?
  public let logicalMax: Int?

  /// `Generic Device Controls · Battery Strength in input report 3 at bit 24, 8 bits, 0–100`.
  public var description: String {
    guard let report else { return usage }
    var text = "\(usage) in \(report) report" + (reportID.map { " \($0)" } ?? "")
    if let bitOffset { text += " at bit \(bitOffset)" }
    if let bits { text += ", \(bits) bits" }
    if let logicalMin, let logicalMax { text += ", \(logicalMin)–\(logicalMax)" }
    return text
  }

  /// The field's raw value in a report as the device sent it, report-ID byte
  /// first when the descriptor uses report IDs; nil when the report is too short
  /// or carries another ID.
  public func value(in report: [UInt8]) -> Int? {
    guard let bitOffset, let bits, bits > 0, bits <= 32 else { return nil }
    var data = report[...]
    if let reportID {
      guard data.first == reportID else { return nil }
      data = data.dropFirst()
    }
    let bytes = Array(data)
    guard (bitOffset + bits + 7) / 8 <= bytes.count else { return nil }
    var value = 0
    for bit in 0..<bits {
      let at = bitOffset + bit
      if bytes[at / 8] & (1 << (at % 8)) != 0 { value |= 1 << bit }
    }
    return value
  }

  /// The value as a percentage of its logical range, when the range is known.
  public func percent(in report: [UInt8]) -> Int? {
    guard let raw = value(in: report), let logicalMin, let logicalMax, logicalMax > logicalMin,
      (logicalMin...logicalMax).contains(raw)
    else { return nil }
    return (raw - logicalMin) * 100 / (logicalMax - logicalMin)
  }
}

/// What a HID report descriptor declares — the complete list of what a Classic
/// HID device (keyboard, mouse, remote) can ever send or accept. A battery the
/// descriptor does not declare is a battery the device cannot report over HID.
public struct HIDReportDescriptor: Equatable, Sendable, Encodable {
  /// Top-level application collections: `Generic Desktop · Keyboard`.
  public let applications: [String]
  public let reportIDs: [UInt8]
  /// Every usage page the descriptor names, in first-seen order.
  public let usagePages: [String]
  /// Where a battery level is declared, or empty when none is.
  public let battery: [HIDBatteryField]
  public let length: Int

  /// Short items only carry the meaning; a long item (0xFE) is skipped whole.
  /// A descriptor cut short ends the parse at the last complete item.
  public static func parse(_ bytes: [UInt8]) -> HIDReportDescriptor {
    var applications: [String] = []
    var reportIDs: [UInt8] = []
    var pages: [UInt32] = []
    var battery: [HIDBatteryField] = []
    var usagePage: UInt32 = 0
    var reportID: UInt8?
    var reportSize = 0
    var reportCount = 0
    var logical: (min: Int?, max: Int?, unsignedMax: Int?) = (nil, nil, nil)
    /// The next free bit in each report, keyed by kind and ID.
    var offsets: [String: Int] = [:]
    var usages: [(page: UInt32, usage: UInt32)] = []
    var range: (min: UInt32?, max: UInt32?) = (nil, nil)
    var depth = 0

    func note(page: UInt32) {
      if !pages.contains(page) { pages.append(page) }
    }
    func checkBattery(_ page: UInt32, _ usage: UInt32, in report: String?, field: Int = 0, start: Int = 0) {
      guard HIDNames.isBattery(page: page, usage: usage) else { return }
      let entry = HIDBatteryField(
        usage: HIDNames.label(page: page, usage: usage), report: report, reportID: report == nil ? nil : reportID,
        bits: report == nil ? nil : reportSize, bitOffset: report == nil ? nil : start + field * reportSize,
        logicalMin: report == nil ? nil : logical.min,
        // A one-byte 255 reads as -1 signed; a maximum below the minimum meant the unsigned value.
        logicalMax: report == nil ? nil : ((logical.max ?? 0) < (logical.min ?? 0) ? logical.unsignedMax : logical.max))
      if !battery.contains(entry) { battery.append(entry) }
    }
    /// A short item's data as a signed number, the way logical bounds are encoded.
    func signed(_ value: UInt32, _ size: Int) -> Int {
      switch size {
      case 1: return Int(Int8(truncatingIfNeeded: value))
      case 2: return Int(Int16(truncatingIfNeeded: value))
      case 4: return Int(Int32(truncatingIfNeeded: value))
      default: return 0
      }
    }

    var index = 0
    while index < bytes.count {
      let prefix = bytes[index]
      if prefix == 0xFE {
        guard index + 1 < bytes.count else { break }
        index += 3 + Int(bytes[index + 1])
        continue
      }
      let size = [0, 1, 2, 4][Int(prefix & 0x03)]
      // An item whose data runs past the end is a truncated descriptor: stop there.
      guard index + 1 + size <= bytes.count else { break }
      var value: UInt32 = 0
      for offset in 0..<size { value |= UInt32(bytes[index + 1 + offset]) << (8 * offset) }
      let type = (prefix >> 2) & 0x03
      let tag = prefix >> 4
      index += 1 + size

      switch (type, tag) {
      case (1, 0x0):  // Usage Page
        usagePage = value
        note(page: value)
      case (1, 0x8):  // Report ID
        let id = UInt8(truncatingIfNeeded: value)
        reportID = id
        if !reportIDs.contains(id) { reportIDs.append(id) }
      case (1, 0x7):  // Report Size, in bits per field
        reportSize = Int(value)
      case (1, 0x9):  // Report Count, fields per main item
        reportCount = Int(value)
      case (1, 0x1):  // Logical Minimum
        logical.min = signed(value, size)
      case (1, 0x2):  // Logical Maximum
        logical.max = signed(value, size)
        logical.unsignedMax = Int(value)
      case (2, 0x0):  // Usage — a 4-byte usage carries its own page in the high half
        let page = size == 4 ? value >> 16 : usagePage
        usages.append((page, size == 4 ? value & 0xFFFF : value))
        if size == 4 { note(page: page) }
      case (2, 0x1):  // Usage Minimum
        range.min = value
      case (2, 0x2):  // Usage Maximum
        range.max = value
      case (0, 0xA):  // Collection
        if depth == 0, value == 0x01, let first = usages.first {
          let label = HIDNames.label(page: first.page, usage: first.usage)
          if !applications.contains(label) { applications.append(label) }
        }
        for usage in usages { checkBattery(usage.page, usage.usage, in: nil) }
        depth += 1
        usages = []
        range = (nil, nil)
      case (0, 0xC):  // End Collection
        depth = max(0, depth - 1)
      case (0, 0x8), (0, 0x9), (0, 0xB):  // Input, Output, Feature
        let report = tag == 0x8 ? "input" : tag == 0x9 ? "output" : "feature"
        let key = "\(report)/\(reportID.map(String.init) ?? "-")"
        let start = offsets[key] ?? 0
        // Usages pair with fields in order; the last usage covers any fields left.
        for (field, usage) in usages.enumerated() {
          checkBattery(usage.page, usage.usage, in: report, field: field, start: start)
        }
        if let low = range.min, let high = range.max, high >= low, high - low < 0x1000 {
          for (field, usage) in (low...high).enumerated() {
            checkBattery(usagePage, usage, in: report, field: field, start: start)
          }
        }
        offsets[key] = start + reportSize * reportCount
        usages = []
        range = (nil, nil)
      default:
        continue
      }
    }
    return HIDReportDescriptor(
      applications: applications, reportIDs: reportIDs, usagePages: pages.map(HIDNames.page),
      battery: battery, length: bytes.count)
  }

  /// `Generic Desktop · Keyboard, Consumer · Consumer Control; reports 1, 2; battery: none declared`.
  public var summary: String {
    var parts = [applications.isEmpty ? "no application collection" : applications.joined(separator: ", ")]
    if !reportIDs.isEmpty { parts.append("reports " + reportIDs.map(String.init).joined(separator: ", ")) }
    parts.append(
      battery.isEmpty ? "battery: none declared" : "battery: " + battery.map(\.description).joined(separator: ", "))
    return parts.joined(separator: "; ")
  }
}

/// HID Usage Tables names for the pages and usages a descriptor summary needs.
public enum HIDNames {
  public static func page(_ page: UInt32) -> String {
    if page >= 0xFF00 { return String(format: "Vendor 0x%04X", page) }
    return pages[page] ?? String(format: "Page 0x%02X", page)
  }

  public static func label(page: UInt32, usage: UInt32) -> String {
    let name = usages[page]?[usage] ?? String(format: "0x%02X", usage)
    return "\(Self.page(page)) · \(name)"
  }

  /// Battery System and Power Device pages entirely, and Battery Strength in
  /// Generic Device Controls — where the HID Usage Tables put a battery level.
  public static func isBattery(page: UInt32, usage: UInt32) -> Bool {
    page == 0x85 || page == 0x84 || (page == 0x06 && usage == 0x20)
  }

  private static let pages: [UInt32: String] = [
    0x01: "Generic Desktop", 0x02: "Simulation", 0x06: "Generic Device Controls", 0x07: "Keyboard/Keypad",
    0x08: "LED", 0x09: "Button", 0x0C: "Consumer", 0x0D: "Digitizers", 0x0F: "Physical Input Device",
    0x84: "Power Device", 0x85: "Battery System",
  ]

  private static let usages: [UInt32: [UInt32: String]] = [
    0x01: [
      0x01: "Pointer", 0x02: "Mouse", 0x04: "Joystick", 0x05: "Gamepad", 0x06: "Keyboard", 0x07: "Keypad",
      0x80: "System Control",
    ],
    0x06: [0x20: "Battery Strength"],
    0x0C: [0x01: "Consumer Control"],
    0x0D: [0x04: "Touch Screen", 0x05: "Touch Pad"],
    0x85: [0x65: "Absolute State Of Charge", 0x66: "Remaining Capacity", 0x44: "Charging", 0x45: "Discharging"],
  ]
}
