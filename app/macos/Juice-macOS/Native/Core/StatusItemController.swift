import AppKit

/// The menu bar presence of a Dock-less app (`LSUIElement`).
///
/// The item is a battery icon only — a number beside it read as one device's
/// level when it was the lowest of several. The icon's fill follows the lowest
/// level and turns red when a device is low; the menu names every device with
/// its own level, and leads back to the window once it is closed.
final class StatusItemController: NSObject, NSMenuDelegate {
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  private let menu = NSMenu()
  private let openWindow: () -> Void
  private let updateItem: NSMenuItem?
  private let monitor: BatteryMonitor

  /// - Parameter updateItem: "Check for Updates…", built by the app target where
  ///   Sparkle is linked; this core file compiles without it (`make swift-check`).
  init(monitor: BatteryMonitor, openWindow: @escaping () -> Void, updateItem: NSMenuItem? = nil) {
    self.monitor = monitor
    self.openWindow = openWindow
    self.updateItem = updateItem
    super.init()
    menu.delegate = self
    item.menu = menu
    NotificationCenter.default.addObserver(
      self, selector: #selector(refresh), name: BatteryMonitor.didUpdate, object: nil)
    refresh()
  }

  @objc private func refresh() {
    let snapshot = monitor.latest
    let lowest = snapshot?.devices.compactMap(\.percent).min()
    let isLow = snapshot.map { !$0.low.isEmpty } ?? false
    item.button?.image = NSImage(
      systemSymbolName: Self.symbol(for: lowest), accessibilityDescription: "Battery")
    item.button?.image?.isTemplate = !isLow
    item.button?.contentTintColor = isLow ? .systemRed : nil
    item.button?.title = ""
    item.button?.imagePosition = .imageOnly
    rebuild(snapshot)
  }

  /// Opening the menu reads again when what it would show has gone stale, as
  /// the system's own Bluetooth menu shows current levels when it opens.
  func menuWillOpen(_ menu: NSMenu) {
    rebuild(monitor.latest)
    monitor.request(.menuOpened)
  }

  private func rebuild(_ snapshot: BatterySnapshot?) {
    menu.removeAllItems()
    let devices = snapshot?.devices ?? []
    if devices.isEmpty {
      let none = NSMenuItem(title: "No connected devices", action: nil, keyEquivalent: "")
      none.isEnabled = false
      menu.addItem(none)
    }
    for device in devices {
      let level = device.percent.map { "\($0)%" } ?? "—"
      let line = NSMenuItem(title: "\(device.name)    \(level)", action: nil, keyEquivalent: "")
      line.image = NSImage(systemSymbolName: Self.symbol(for: device.percent), accessibilityDescription: nil)
      line.toolTip = device.note ?? device.source.map { "read from \($0)" }
      line.isEnabled = false
      menu.addItem(line)
    }
    menu.addItem(.separator())
    menu.addItem(withTitle: "Refresh", action: #selector(refreshNow), keyEquivalent: "r").target = self
    menu.addItem(withTitle: "Open Juice", action: #selector(open), keyEquivalent: "o").target = self
    if let updateItem { menu.addItem(updateItem) }
    menu.addItem(.separator())
    menu.addItem(withTitle: "Quit Juice", action: #selector(quit), keyEquivalent: "q").target = self
  }

  /// The SF Symbol for a level: a quarter-step battery, or a plain one when unknown.
  static func symbol(for percent: Int?) -> String {
    guard let percent else { return "battery.0percent" }
    switch percent {
    case ..<13: return "battery.0percent"
    case ..<38: return "battery.25percent"
    case ..<63: return "battery.50percent"
    case ..<88: return "battery.75percent"
    default: return "battery.100percent"
    }
  }

  @objc private func refreshNow() {
    monitor.refresh()
  }

  @objc private func open() {
    NSApp.activate(ignoringOtherApps: true)
    openWindow()
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }
}
