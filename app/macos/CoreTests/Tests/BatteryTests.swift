import Foundation
import Testing

@testable import JuiceCore

// Made-up names and addresses throughout — no real device belongs in the tree.

// MARK: - The system's record

private let record = Data(
  """
  {"SPBluetoothDataType":[{
    "device_connected":[
      {"Board":{"device_address":"aa-00-00-00-00-01","device_minorType":"Keyboard","device_services":"0x800020 < HID ACL >"}},
      {"Buds":{"device_address":"AA:00:00:00:00:02","device_minorType":"Headphones",
               "device_batteryLevelLeft":"90%","device_batteryLevelRight":"88%","device_batteryLevelCase":"40 %"}},
      {"Speaker [LE]":{"device_address":"AA:00:00:00:00:03","device_services":"0x400000 < BLE >"}}],
    "device_not_connected":[
      {"Mouse":{"device_address":"AA:00:00:00:00:04","device_minorType":"Mouse"}}]
  }]}
  """.utf8)

@Test func theRecordGivesEveryIdentityWithItsTransportAndBatteries() throws {
  let records = SystemRecord.parse(record)
  #expect(records.count == 4)
  let byName = Dictionary(uniqueKeysWithValues: records.map { ($0.name, $0) })
  #expect(byName["Board"]?.address == "AA:00:00:00:00:01")
  #expect(byName["Board"]?.isHID == true)
  #expect(byName["Buds"]?.battery == ["left": 90, "right": 88, "case": 40])
  #expect(byName["Speaker [LE]"]?.transport == "LE")
  #expect(byName["Mouse"]?.isConnected == false)
  #expect(SystemRecord.parse(Data("{}".utf8)).isEmpty)
}

@Test func aBatteryFieldThatIsNotAPercentageIsDropped() {
  #expect(Battery.systemLevels(["device_batteryLevelMain": "unknown", "device_batteryLevelLeft": "140%"]).isEmpty)
}

@Test func anLEBatteryLevelIsOneByteUpToAHundred() {
  #expect(Battery.levelCharacteristic(Data([0x4B])) == 75)
  #expect(Battery.levelCharacteristic(Data([0x65])) == nil)
  #expect(Battery.levelCharacteristic(Data()) == nil)
}

@Test(arguments: [
  ("Keyboard", "Board", "keyboard"), (nil, "Magic Trackpad", "trackpad"), ("Headphones", "Buds", "headphones"),
  (nil, "my AirPods", "headphones"), (nil, "Pat's gadget", "other"), (nil, "iPhone", "phone"),
])
func aDeviceIsClassifiedByItsLabelThenItsName(label: String?, name: String, kind: String) {
  #expect(Battery.kind(label: label, name: name) == kind)
}

// MARK: - LE notifications

@Test func anLELevelNeverOverridesWhatTheSystemOrAHIDReportGave() {
  let devices = [DeviceBattery(name: "Board", identifier: "a", kind: "keyboard", readings: [BatteryReading(part: nil, percent: 40, source: "HID report")])]
  #expect(Battery.mergingLE(identifier: "x", name: "Board", percent: 90, into: devices) == devices)
}

@Test func aNewerLELevelReplacesTheOlderOne() {
  let devices = [DeviceBattery(name: "Phone", identifier: "p", kind: "phone", readings: [BatteryReading(part: nil, percent: 90, source: "LE")])]
  let merged = Battery.mergingLE(identifier: "p", name: "Phone", percent: 88, into: devices)
  #expect(merged.map(\.readings) == [[BatteryReading(part: nil, percent: 88, source: "LE")]])
}

@Test func anLELevelFillsAListedDeviceWithoutOneAndAddsAnUnlistedOne() {
  let devices = [DeviceBattery(name: "Mouse", identifier: "m", kind: "mouse", notes: ["reports no battery to this Mac"])]
  let filled = Battery.mergingLE(identifier: "uuid", name: "Mouse", percent: 33, into: devices)
  #expect(filled.count == 1 && filled[0].readings.first?.percent == 33 && filled[0].notes.isEmpty)
  let added = Battery.mergingLE(identifier: "uuid-2", name: "Pen", percent: 70, into: devices)
  #expect(added.map(\.name) == ["Mouse", "Pen"])
}

// MARK: - When to read

@Test func everyTriggerButOpeningTheMenuReads() {
  let justNow = Date()
  for trigger: RefreshPolicy.Trigger in [.launch, .wake, .powerSourceChanged, .connectionChanged, .requested, .poll] {
    #expect(RefreshPolicy.shouldRead(trigger, lastRead: justNow, now: justNow))
  }
}

@Test func openingTheMenuReadsOnlyWhatHasGoneStale() {
  let read = Date(timeIntervalSince1970: 1000)
  #expect(!RefreshPolicy.shouldRead(.menuOpened, lastRead: read, now: read.addingTimeInterval(RefreshPolicy.freshness - 1)))
  #expect(RefreshPolicy.shouldRead(.menuOpened, lastRead: read, now: read.addingTimeInterval(RefreshPolicy.freshness)))
  #expect(RefreshPolicy.shouldRead(.menuOpened, lastRead: nil, now: read))
}

@Test func aPersonReadsAtOnceWhileSystemEventsWaitOutTheirBurst() {
  #expect(RefreshPolicy.delay(for: .requested) == 0)
  #expect(RefreshPolicy.delay(for: .menuOpened) == 0)
  for trigger: RefreshPolicy.Trigger in [.launch, .wake, .powerSourceChanged, .connectionChanged, .poll] {
    #expect(RefreshPolicy.delay(for: trigger) == RefreshPolicy.coalescing)
  }
}

// MARK: - The published snapshot

@Test func theSnapshotListsTheLowestReadingOfEachDeviceLowestFirst() {
  let devices = [
    DeviceBattery(name: "Speaker", identifier: "a", kind: "speaker", notes: ["reports no battery to this Mac"]),
    DeviceBattery(
      name: "Buds", identifier: "b", kind: "headphones",
      readings: [BatteryReading(part: "left", percent: 90, source: "system"), BatteryReading(part: "case", percent: 40, source: "system")]),
    DeviceBattery(name: "Board", identifier: "c", kind: "keyboard", readings: [BatteryReading(part: nil, percent: 15, source: "HID report")]),
  ]
  let snapshot = Battery.snapshot(devices, threshold: 20, now: Date(timeIntervalSince1970: 0))
  #expect(snapshot.devices.map(\.name) == ["Board", "Buds", "Speaker"])
  #expect(snapshot.devices[1].percent == 40)
  #expect(snapshot.devices[1].parts == ["left": 90, "case": 40])
  #expect(snapshot.devices[2].percent == nil)
  #expect(snapshot.devices[2].note == "reports no battery to this Mac")
  #expect(snapshot.low.map(\.name) == ["Board"])
}

@Test func theJavaScriptPayloadCarriesPlainValuesAndMilliseconds() throws {
  let snapshot = Battery.snapshot(
    [DeviceBattery(name: "Board", identifier: "c", kind: "keyboard", readings: [BatteryReading(part: nil, percent: 15, source: "HID report")])],
    threshold: 20, now: Date(timeIntervalSince1970: 1.5))
  let payload = Battery.payload(snapshot)
  #expect(payload["threshold"] as? Int == 20)
  #expect(payload["updatedAt"] as? Double == 1500)
  let device = try #require((payload["devices"] as? [[String: Any]])?.first)
  #expect(device["percent"] as? Int == 15)
  #expect(device["source"] as? String == "HID report")
  #expect(device["kind"] as? String == "keyboard")
}

@Test func aDeviceWithoutALevelReachesJavaScriptAsNullsNotMissingKeys() throws {
  let snapshot = Battery.snapshot(
    [DeviceBattery(name: "Speaker", identifier: "a", kind: "speaker", notes: ["reports no battery to this Mac"])],
    threshold: 20, now: Date())
  let device = try #require((Battery.payload(snapshot)["devices"] as? [[String: Any]])?.first)
  #expect(device["percent"] is NSNull)
  #expect(device["source"] is NSNull)
  #expect(device["note"] as? String == "reports no battery to this Mac")
}

// MARK: - Low-battery alerts

private func snapshot(_ levels: [String: Int], threshold: Int = 20) -> BatterySnapshot {
  BatterySnapshot(
    devices: levels.map {
      DeviceLevel(name: $0.key, identifier: $0.key, percent: $0.value, parts: [:], source: "system", note: nil, kind: "other")
    },
    threshold: threshold, updatedAt: Date())
}

@Test func aDeviceAlertsOnceWhenItReachesTheThreshold() {
  var alerts = LowBatteryAlerts()
  #expect(alerts.evaluate(snapshot(["Board": 30, "Buds": 20])).map(\.name) == ["Buds"])
  #expect(alerts.evaluate(snapshot(["Board": 30, "Buds": 18])).isEmpty)
}

@Test func aDeviceAlertsAgainOnlyAfterItRoseClearOfTheThreshold() {
  var alerts = LowBatteryAlerts()
  _ = alerts.evaluate(snapshot(["Board": 19]))
  // A reading that wobbles just above the threshold does not re-arm it.
  #expect(alerts.evaluate(snapshot(["Board": 22])).isEmpty)
  #expect(alerts.evaluate(snapshot(["Board": 19])).isEmpty)
  // A charge does.
  #expect(alerts.evaluate(snapshot(["Board": 60])).isEmpty)
  #expect(alerts.evaluate(snapshot(["Board": 18])).map(\.name) == ["Board"])
}

@Test func aDeviceThatLeavesKeepsItsAlertState() {
  var alerts = LowBatteryAlerts()
  _ = alerts.evaluate(snapshot(["Board": 15]))
  _ = alerts.evaluate(snapshot([:]))
  #expect(alerts.evaluate(snapshot(["Board": 15])).isEmpty)
}

// MARK: - HID report descriptors

/// A keyboard application (report 1) and a consumer application whose report 3
/// carries a one-byte Battery Strength, 0–255 written as `25 FF` (signed -1).
private let keyboardWithBattery: [UInt8] = [
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, 0x01,
  0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
  0x75, 0x08, 0x95, 0x01, 0x81, 0x00,
  0xC0,
  0x05, 0x0C, 0x09, 0x01, 0xA1, 0x01, 0x85, 0x03,
  0x05, 0x06, 0x09, 0x20, 0x15, 0x00, 0x25, 0xFF, 0x75, 0x08, 0x95, 0x01, 0x81, 0x02,
  0xC0,
]

@Test func theDescriptorSaysWhereTheBatteryIsAndHowToReadIt() throws {
  let battery = try #require(HIDReportDescriptor.parse(keyboardWithBattery).battery.first)
  #expect(battery.report == "input")
  #expect(battery.reportID == 3)
  #expect(battery.bitOffset == 0)
  #expect(battery.logicalMax == 255)
  #expect(battery.percent(in: [0x03, 0x83]) == 51)
  #expect(battery.value(in: [0x01, 0x83]) == nil)
}

@Test func aFieldAfterOthersInTheSameReportIsOffsetByThem() throws {
  let descriptor: [UInt8] = [
    0x05, 0x0C, 0x09, 0x01, 0xA1, 0x01, 0x85, 0x04,
    0x09, 0xE9, 0x75, 0x04, 0x95, 0x01, 0x81, 0x02,
    0x75, 0x04, 0x95, 0x01, 0x81, 0x03,
    0x05, 0x06, 0x09, 0x20, 0x15, 0x00, 0x25, 0x14, 0x75, 0x05, 0x95, 0x01, 0x81, 0x02,
    0xC0,
  ]
  let battery = try #require(HIDReportDescriptor.parse(descriptor).battery.first)
  #expect(battery.bitOffset == 8)
  #expect(battery.percent(in: [0x04, 0x00, 0x0F]) == 75)
}

@Test func aDescriptorWithoutABatteryDeclaresNone() {
  #expect(HIDReportDescriptor.parse(Array(keyboardWithBattery.prefix(31))).battery.isEmpty)
}
