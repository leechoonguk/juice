import AppKit
import Foundation
import IOKit.hid
import UserNotifications
import os
import WidgetKit

/// Reads every device's battery when something says it may have changed —
/// the system's accessory power-source events, a Bluetooth connection, wake,
/// an LE device's own notification — and otherwise only on a backstop poll
/// (`RefreshPolicy`); publishes the snapshot to the App Group (the widget and
/// the menu read it) and notifies about each device that runs low.
final class BatteryMonitor {
  static let shared = BatteryMonitor()
  /// Posted on the main queue after each new snapshot.
  static let didUpdate = Notification.Name("com.uk.juice.batteriesDidUpdate")
  static let defaultThreshold = 20

  private let reader = BatteryReader()
  private let events = BluetoothEvents()
  private let queue = DispatchQueue(label: "juice.monitor")
  private let defaults: UserDefaults
  private var poll: Timer?
  private var scheduled: DispatchWorkItem?
  private var reading = false
  /// An event arrived while a read ran; that read may have missed it.
  private var readAgain = false
  private var waiting: [(BatterySnapshot) -> Void] = []
  /// What the last read found, kept so an LE notification patches one device without a read.
  private var devices: [DeviceBattery] = []
  private var lastRead: Date?
  /// The last snapshot, read back from the App Group at launch.
  private(set) var latest: BatterySnapshot?

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    latest = SharedStore().flatMap(SnapshotStore.load)
  }

  /// The level at or below which a device is low, 5–95.
  var threshold: Int {
    let stored = defaults.integer(forKey: "threshold")
    return stored == 0 ? Self.defaultThreshold : stored
  }

  /// Whether Input Monitoring is granted — a keyboard's battery report needs it.
  var mayReadHIDReports: Bool {
    IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) == kIOHIDAccessTypeGranted
  }

  /// Asks for notifications and Input Monitoring, then reads on every event that may change a level.
  func start() {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    if !mayReadHIDReports { _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent) }
    reader.onLEPush = { [weak self] identifier, name, percent in
      DispatchQueue.main.async { self?.apply(identifier: identifier, name: name, percent: percent) }
    }
    reader.onLEDisconnect = { [weak self] in DispatchQueue.main.async { self?.request(.connectionChanged) } }
    events.start { [weak self] trigger in self?.request(trigger) }
    NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.request(.wake) }
    request(.launch)
  }

  /// Reads for `trigger` when the policy says so, after its burst settles. Main queue.
  func request(_ trigger: RefreshPolicy.Trigger) {
    guard RefreshPolicy.shouldRead(trigger, lastRead: lastRead, now: Date()) else {
      Self.log.notice("\(String(describing: trigger), privacy: .public): last read is fresh, not reading")
      return
    }
    Self.log.notice("\(String(describing: trigger), privacy: .public): reading in \(RefreshPolicy.delay(for: trigger))s")
    scheduled?.cancel()
    let work = DispatchWorkItem { [weak self] in self?.refresh() }
    scheduled = work
    DispatchQueue.main.asyncAfter(deadline: .now() + RefreshPolicy.delay(for: trigger), execute: work)
  }

  /// Reads now. `completion` runs on the main queue with the new snapshot; a
  /// call while a read is running waits for that read instead of starting another.
  func refresh(completion: ((BatterySnapshot) -> Void)? = nil) {
    if let completion { waiting.append(completion) }
    guard !reading else {
      if completion == nil { readAgain = true }
      return
    }
    reading = true
    scheduled?.cancel()
    queue.async { [reader] in
      reader.read { devices in
        DispatchQueue.main.async {
          self.devices = devices
          self.lastRead = Date()
          Self.log.notice("read \(devices.count) devices")
          self.armPoll()
          self.publish(Battery.snapshot(devices, threshold: self.threshold, now: Date()))
          if self.readAgain {
            self.readAgain = false
            self.request(.connectionChanged)
          }
        }
      }
    }
  }

  /// The backstop poll restarts after every read, so it fires only after a
  /// quiet quarter-hour — never on top of an event that just read.
  private func armPoll() {
    poll?.invalidate()
    let timer = Timer.scheduledTimer(withTimeInterval: RefreshPolicy.pollInterval, repeats: false) { [weak self] _ in
      self?.request(.poll)
    }
    timer.tolerance = RefreshPolicy.pollTolerance
    poll = timer
  }

  /// An LE device's own notification: patch that device, no read.
  private func apply(identifier: String, name: String, percent: Int) {
    let patched = Battery.mergingLE(identifier: identifier, name: name, percent: percent, into: devices)
    guard patched != devices else { return }
    devices = patched
    Self.log.notice("LE notification: \(percent)% without a read")
    publish(Battery.snapshot(devices, threshold: threshold, now: Date()), reading: false)
  }

  /// Stores the threshold and republishes the last snapshot under it; no new read is needed.
  func setThreshold(_ value: Int) -> BatterySnapshot? {
    defaults.set(min(max(value, 5), 95), forKey: "threshold")
    guard let latest else { return nil }
    let updated = BatterySnapshot(devices: latest.devices, threshold: threshold, updatedAt: latest.updatedAt)
    publish(updated, reading: false)
    return updated
  }

  /// Kept by the system (notice level), so `log show` answers "why did it read then?" afterwards; `make app-logs` follows them live.
  private static let log = Logger(subsystem: "com.uk.juice", category: "monitor")

  private func publish(_ snapshot: BatterySnapshot, reading finishedRead: Bool = true) {
    if finishedRead { reading = false }
    latest = snapshot
    if let store = SharedStore() { try? SnapshotStore.save(snapshot, to: store) }
    WidgetCenter.shared.reloadAllTimelines()
    NotificationCenter.default.post(name: Self.didUpdate, object: nil)
    alert(snapshot)
    let callbacks = finishedRead ? waiting : []
    if finishedRead { waiting = [] }
    callbacks.forEach { $0(snapshot) }
  }

  private func alert(_ snapshot: BatterySnapshot) {
    var alerts = LowBatteryAlerts(alerted: Set(defaults.stringArray(forKey: "alerted") ?? []))
    let due = alerts.evaluate(snapshot)
    defaults.set(alerts.alerted.sorted(), forKey: "alerted")
    for device in due {
      let content = UNMutableNotificationContent()
      content.title = "\(device.name) battery is low"
      content.body = "\(device.percent ?? 0)% left"
      content.sound = .default
      UNUserNotificationCenter.current().add(
        UNNotificationRequest(identifier: "low-\(device.identifier)", content: content, trigger: nil))
    }
  }
}
