import CoreBluetooth
import Foundation
import IOBluetooth
import IOKit
import IOKit.hid
import IOKit.ps

/// Reads every connected device's battery by every path macOS offers, in order:
/// the system's record, the accessory power sources macOS publishes, the level
/// the system keeps in the I/O Registry, the HID battery report a Classic
/// device's descriptor declares, and LE Battery Level (2A19). Each device notes
/// why a path that gave nothing gave nothing.
///
/// Blocking work (`system_profiler`, HID reports) runs on the caller's queue;
/// call it off the main thread. The LE reads finish on their own queue.
final class BatteryReader {
  private let le = LEBatteryReader()

  /// An LE device announced a new level on its own (reader's queue).
  var onLEPush: (_ identifier: String, _ name: String, _ percent: Int) -> Void = { _, _, _ in } {
    didSet { le.onPush = { [onLEPush] in onLEPush($0.identifier, $0.name, $0.percent) } }
  }
  /// A subscribed LE device went away (reader's queue).
  var onLEDisconnect: () -> Void = {} {
    didSet { le.onDisconnect = onLEDisconnect }
  }

  func read(completion: @escaping ([DeviceBattery]) -> Void) {
    let records = Self.systemRecords().filter(\.isConnected)
    let registry = Self.registryLevels()
    let accessories = Battery.accessorySources(Self.powerSourceDescriptions())
    var devices: [DeviceBattery] = records.map { record in
      var device = DeviceBattery(
        name: record.name, identifier: record.address, kind: Battery.kind(label: record.kind, name: record.name))
      for (part, percent) in record.battery.sorted(by: { $0.key < $1.key }) {
        device.readings.append(BatteryReading(part: part == "main" ? nil : part, percent: percent, source: "system"))
      }
      if device.readings.isEmpty {
        device.readings = Battery.accessoryReadings(for: record, in: accessories)
      }
      if device.readings.isEmpty, let percent = registry[record.address] {
        device.readings.append(BatteryReading(part: nil, percent: percent, source: "system"))
      }
      if device.readings.isEmpty, record.isHID {
        switch Self.hidBattery(address: record.address) {
        case .success(let percent): device.readings.append(BatteryReading(part: nil, percent: percent, source: "HID report"))
        case .failure(let note): device.notes.append(note.text)
        }
      } else if device.readings.isEmpty {
        device.notes.append("reports no battery to this Mac")
      }
      return device
    }
    le.read { levels in
      for level in levels {
        devices = Battery.mergingLE(identifier: level.identifier, name: level.name, percent: level.percent, into: devices)
      }
      completion(devices)
    }
  }

  // MARK: - The system's record

  static func systemRecords() -> [PairedRecord] {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/system_profiler")
    process.arguments = ["SPBluetoothDataType", "-json"]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return [] }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return SystemRecord.parse(data)
  }

  /// Every registry entry's `BatteryPercent`, keyed by the Bluetooth address it
  /// carries (`DeviceAddress`) — where Apple's own accessories report.
  static func registryLevels() -> [String: Int] {
    var iterator: io_iterator_t = 0
    guard
      IORegistryCreateIterator(kIOMainPortDefault, kIOServicePlane, IOOptionBits(kIORegistryIterateRecursively), &iterator)
        == KERN_SUCCESS
    else { return [:] }
    defer { IOObjectRelease(iterator) }
    var levels: [String: Int] = [:]
    var entry = IOIteratorNext(iterator)
    while entry != 0 {
      if let percent = property(entry, "BatteryPercent") as? Int, let address = property(entry, "DeviceAddress") as? String {
        levels[SystemRecord.normalizeAddress(address)] = percent
      }
      IOObjectRelease(entry)
      entry = IOIteratorNext(iterator)
    }
    return levels
  }

  /// Every power source description macOS publishes, accessories included —
  /// what `pmset -g accps` lists. A headset that reports its level over the
  /// hands-free profile has it here only. `IOPSCopyPowerSourcesInfo` returns the
  /// Mac's own battery alone, so the call is `IOPSCopyPowerSourcesByType` with
  /// type 0 (all sources), which IOKit exports but does not declare; looked up
  /// at run time, a macOS without it simply gives no accessory levels.
  static func powerSourceDescriptions() -> [[String: Any]] {
    typealias CopyByType = @convention(c) (Int32) -> Unmanaged<CFTypeRef>?
    guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "IOPSCopyPowerSourcesByType"),
      let blob = unsafeBitCast(symbol, to: CopyByType.self)(0)?.takeRetainedValue()
    else { return [] }
    let sources = IOPSCopyPowerSourcesList(blob)?.takeRetainedValue() as? [CFTypeRef] ?? []
    return sources.compactMap { IOPSGetPowerSourceDescription(blob, $0)?.takeUnretainedValue() as? [String: Any] }
  }

  private static func property(_ entry: io_registry_entry_t, _ key: String) -> Any? {
    IORegistryEntryCreateCFProperty(entry, key as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
  }

  // MARK: - A HID battery report

  struct Note: Error {
    let text: String
  }

  /// The battery field the device's HID report descriptor declares, read by
  /// asking the device for that report. The descriptor comes from the SDP
  /// records the system keeps for a paired device; when it has none yet, a
  /// query is started and the next read finds them.
  static func hidBattery(address: String) -> Result<Int, Note> {
    guard let device = IOBluetoothDevice(addressString: address) else { return .failure(Note(text: "unknown address")) }
    guard let services = device.services as? [IOBluetoothSDPServiceRecord], !services.isEmpty else {
      device.performSDPQuery(nil)
      return .failure(Note(text: "reading its HID description — next refresh"))
    }
    let descriptors = services.compactMap { reportDescriptor($0.getAttributeDataElement(0x0206)) }
    guard let bytes = descriptors.first else { return .failure(Note(text: "publishes no HID description")) }
    let hid = HIDReportDescriptor.parse(Array(bytes))
    guard let field = hid.battery.first(where: { $0.report == "input" || $0.report == "feature" }), let kind = field.report
    else { return .failure(Note(text: "does not report its battery")) }
    // The field's own end, plus the report-ID byte when it has one: the least a report can hold.
    let minimumLength = (field.reportID == nil ? 0 : 1) + ((field.bitOffset ?? 0) + (field.bits ?? 8) + 7) / 8
    let (report, status) = hidReport(address: address, kind: kind, id: field.reportID ?? 0, minimumLength: minimumLength)
    if status == kIOReturnSuccess, let percent = field.percent(in: report) { return .success(percent) }
    if IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) != kIOHIDAccessTypeGranted {
      return .failure(Note(text: "needs Input Monitoring to read its battery"))
    }
    return .failure(Note(text: String(format: "did not answer its battery report (0x%08X)", UInt32(bitPattern: status ?? -1))))
  }

  /// The report descriptor in a HIDDescriptorList: a sequence of (type, bytes)
  /// pairs where type 0x22 marks a report descriptor — or one pair unwrapped.
  static func reportDescriptor(_ element: IOBluetoothSDPDataElement?) -> Data? {
    guard let element else { return nil }
    let parts = element.getArrayValue() as? [IOBluetoothSDPDataElement] ?? []
    if parts.count == 2, parts[0].getNumberValue()?.intValue == 0x22, let data = parts[1].getDataValue() {
      return data
    }
    return parts.lazy.compactMap { reportDescriptor($0) }.first
  }

  /// Asks the Bluetooth HID device at `address` for one report. A device appears
  /// once per interface; each is asked until one answers.
  static func hidReport(address: String, kind: String, id: UInt8, minimumLength: Int) -> (bytes: [UInt8], status: Int32?) {
    let manager = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
    IOHIDManagerSetDeviceMatching(manager, [kIOHIDTransportKey: "Bluetooth"] as CFDictionary)
    let opened = IOHIDManagerOpen(manager, IOOptionBits(kIOHIDOptionsTypeNone))
    guard opened == kIOReturnSuccess else { return ([], opened) }
    defer { IOHIDManagerClose(manager, IOOptionBits(kIOHIDOptionsTypeNone)) }
    let devices = (IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>) ?? []
    var status: Int32?
    for device in devices {
      guard let serial = IOHIDDeviceGetProperty(device, kIOHIDSerialNumberKey as CFString) as? String,
        SystemRecord.normalizeAddress(serial) == address
      else { continue }
      // The buffer is as long as the device's own largest report of that type.
      let type = kind == "feature" ? kIOHIDReportTypeFeature : kIOHIDReportTypeInput
      let sizeKey = kind == "feature" ? kIOHIDMaxFeatureReportSizeKey : kIOHIDMaxInputReportSizeKey
      let declared = (IOHIDDeviceGetProperty(device, sizeKey as CFString) as? Int).flatMap { $0 > 0 ? $0 : nil }
      let size = max(declared ?? 0, minimumLength)
      var buffer = [UInt8](repeating: 0, count: size)
      var length = buffer.count
      let result = IOHIDDeviceGetReport(device, type, CFIndex(id), &buffer, &length)
      status = result
      if result == kIOReturnSuccess { return (Array(buffer.prefix(length)), result) }
    }
    return ([], status)
  }
}

// MARK: - LE Battery Level

/// Reads Battery Level (2A19) from every LE device the system already holds a
/// link to that has a Battery service (180F). A device the system holds stops
/// advertising, so it is found by service, not by a scan.
///
/// A device whose 2A19 can notify stays subscribed after its first read: it
/// then announces each change itself (`onPush`), and announces leaving
/// (`onDisconnect`) — the LE counterpart of the system's power-source events.
/// Callbacks run on this reader's own queue.
final class LEBatteryReader: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  struct Level: Equatable {
    let identifier: String
    let name: String
    let percent: Int
  }

  var onPush: (Level) -> Void = { _ in }
  var onDisconnect: () -> Void = {}

  private static let battery = CBUUID(string: "180F")
  private static let level = CBUUID(string: "2A19")
  private let queue = DispatchQueue(label: "juice.le-battery")
  private var manager: CBCentralManager?
  private var pending: [UUID: CBPeripheral] = [:]
  /// Devices that notify, kept connected with their Battery Level characteristic.
  private var subscribed: [UUID: (peripheral: CBPeripheral, characteristic: CBCharacteristic)] = [:]
  private var levels: [Level] = []
  private var completion: (([Level]) -> Void)?

  /// Calls back once, after every device answered or four seconds passed.
  func read(completion: @escaping ([Level]) -> Void) {
    queue.async {
      guard self.completion == nil else { return completion([]) }
      self.completion = completion
      self.levels = []
      if let manager = self.manager {
        self.start(manager)
      } else {
        self.manager = CBCentralManager(delegate: self, queue: self.queue)
      }
      self.queue.asyncAfter(deadline: .now() + 4) { self.finish() }
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state != .poweredOn { subscribed = [:] }
    guard completion != nil else { return }
    if central.state == .poweredOn { start(central) } else if central.state != .unknown && central.state != .resetting {
      finish()
    }
  }

  private func start(_ central: CBCentralManager) {
    guard central.state == .poweredOn else { return }
    let linked = central.retrieveConnectedPeripherals(withServices: [Self.battery])
    guard !linked.isEmpty else { return finish() }
    for peripheral in linked {
      pending[peripheral.identifier] = peripheral
      if let held = subscribed[peripheral.identifier] {
        held.peripheral.readValue(for: held.characteristic)
      } else {
        peripheral.delegate = self
        central.connect(peripheral)
      }
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([Self.battery])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    done(peripheral)
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    // Only a subscribed device's link going away is news; a read's own cancel is not.
    guard subscribed.removeValue(forKey: peripheral.identifier) != nil else { return }
    onDisconnect()
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let service = peripheral.services?.first(where: { $0.uuid == Self.battery }) else { return done(peripheral) }
    peripheral.discoverCharacteristics([Self.level], for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard let characteristic = service.characteristics?.first(where: { $0.uuid == Self.level }) else {
      return done(peripheral)
    }
    if characteristic.properties.contains(.notify) {
      subscribed[peripheral.identifier] = (peripheral, characteristic)
      peripheral.setNotifyValue(true, for: characteristic)
    }
    peripheral.readValue(for: characteristic)
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    let level = (error == nil ? characteristic.value : nil).flatMap(Battery.levelCharacteristic).map {
      Level(identifier: peripheral.identifier.uuidString, name: peripheral.name ?? "Device", percent: $0)
    }
    if pending[peripheral.identifier] != nil {
      if let level { levels.append(level) }
      done(peripheral)
    } else if let level {
      onPush(level)
    }
  }

  private func done(_ peripheral: CBPeripheral) {
    // Cancelling ends this app's connection only; the link the system held stays.
    // A subscribed device stays connected, or its notifications would stop.
    if subscribed[peripheral.identifier] == nil { manager?.cancelPeripheralConnection(peripheral) }
    pending.removeValue(forKey: peripheral.identifier)
    if pending.isEmpty { finish() }
  }

  private func finish() {
    guard let completion else { return }
    self.completion = nil
    for peripheral in pending.values where subscribed[peripheral.identifier] == nil {
      manager?.cancelPeripheralConnection(peripheral)
    }
    pending = [:]
    completion(levels)
  }
}
