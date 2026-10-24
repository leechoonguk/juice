import SwiftUI
import WidgetKit

/// Timeline entry: the snapshot to draw, and whether it is the built-in sample.
struct BatteryEntry: TimelineEntry {
  let date: Date
  let snapshot: BatterySnapshot
  let isSample: Bool
}

/// Reads the snapshot the app published; falls back to the sample until there is one.
///
/// The app calls `WidgetCenter.reloadAllTimelines()` after every read, so the
/// timeline holds one entry and never schedules its own refresh.
struct BatteryProvider: TimelineProvider {
  func placeholder(in context: Context) -> BatteryEntry {
    BatteryEntry(date: Date(), snapshot: .sample, isSample: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (BatteryEntry) -> Void) {
    completion(currentEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<BatteryEntry>) -> Void) {
    completion(Timeline(entries: [currentEntry()], policy: .never))
  }

  private func currentEntry() -> BatteryEntry {
    if let store = SharedStore(), let snapshot = SnapshotStore.load(from: store) {
      return BatteryEntry(date: Date(), snapshot: snapshot, isSample: false)
    }
    return BatteryEntry(date: Date(), snapshot: .sample, isSample: true)
  }
}

/// Every connected device's battery, lowest first, laid out the way Apple's
/// Batteries widget lays it out: a ring per device — a track and a charge arc
/// around the device's symbol — in a grid (small), a row (medium) or a list (large).
///
/// On the macOS desktop a widget is drawn `vibrant` or `accented` whenever its
/// space is not focused, and colour is gone. So the arc is green, or red when
/// low, only in full colour; otherwise it takes the primary style, and a low
/// device also carries a warning symbol beside its level.
struct JuiceWidgetView: View {
  @Environment(\.widgetFamily) private var hostFamily
  let entry: BatteryEntry
  /// The size to draw when no widget host supplies one; the host's family is read-only.
  var family: WidgetFamily?

  private var drawnFamily: WidgetFamily { family ?? hostFamily }
  /// Only devices with a level: a ring with nothing to fill only takes a place
  /// from one that has a battery. The menu and the window still list the rest.
  private var devices: [DeviceLevel] { entry.snapshot.devices.filter { $0.percent != nil } }
  private var threshold: Int { entry.snapshot.threshold }

  var body: some View {
    Group {
      if devices.isEmpty {
        empty
      } else {
        switch drawnFamily {
        case .systemSmall: small
        case .systemMedium: medium
        default: large
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .containerBackground(.fill.tertiary, for: .widget)
  }

  /// One device: its ring large, with its name and level. More: a 2×2 grid.
  @ViewBuilder private var small: some View {
    if devices.count == 1, let device = devices.first {
      VStack(spacing: 8) {
        DeviceRing(device: device, threshold: threshold, diameter: 78, lineWidth: 8)
        VStack(spacing: 1) {
          Text(device.name).font(.caption).lineLimit(1)
          LevelText(device: device, threshold: threshold, font: .title3.weight(.semibold))
        }
      }
    } else {
      let shown = Array(devices.prefix(4))
      Grid(horizontalSpacing: 12, verticalSpacing: 10) {
        ForEach(Array(stride(from: 0, to: shown.count, by: 2)), id: \.self) { start in
          GridRow {
            ForEach(shown[start..<min(start + 2, shown.count)]) { device in
              RingWithLevel(device: device, threshold: threshold, diameter: 44, lineWidth: 5)
            }
          }
        }
      }
    }
  }

  /// Up to four rings in a row, each with its level and the device's name beneath.
  private var medium: some View {
    HStack(alignment: .top, spacing: 6) {
      ForEach(devices.prefix(4)) { device in
        RingWithLevel(device: device, threshold: threshold, diameter: 56, lineWidth: 6, showsName: true)
          .frame(maxWidth: .infinity)
      }
    }
  }

  /// Up to six rows: ring, name, level.
  private var large: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(devices.prefix(6)) { device in
        HStack(spacing: 12) {
          DeviceRing(device: device, threshold: threshold, diameter: 40, lineWidth: 4.5)
          Text(device.name).font(.body).lineLimit(1)
          Spacer(minLength: 8)
          LevelText(device: device, threshold: threshold, font: .body.weight(.medium))
        }
        .accessibilityElement(children: .combine)
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var empty: some View {
    VStack(spacing: 6) {
      Image(systemName: "battery.0percent").font(.title2).foregroundStyle(.secondary)
      Text(entry.isSample ? "Open Juice to read your devices" : "No connected device reports a battery")
        .font(.caption)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
  }
}

/// A device's ring with its level underneath — and its name, where there is room.
private struct RingWithLevel: View {
  let device: DeviceLevel
  let threshold: Int
  let diameter: CGFloat
  let lineWidth: CGFloat
  var showsName = false

  var body: some View {
    VStack(spacing: 3) {
      DeviceRing(device: device, threshold: threshold, diameter: diameter, lineWidth: lineWidth)
      LevelText(device: device, threshold: threshold, font: .callout.weight(.semibold))
      if showsName {
        Text(device.name)
          .font(.caption2)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.tail)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// The track, the charge arc from twelve o'clock, and the device's symbol inside.
private struct DeviceRing: View {
  @Environment(\.widgetRenderingMode) private var renderingMode
  let device: DeviceLevel
  let threshold: Int
  let diameter: CGFloat
  let lineWidth: CGFloat

  private var fraction: Double { Double(device.percent ?? 0) / 100 }
  private var isLow: Bool { (device.percent ?? 101) <= threshold }

  private var arcStyle: AnyShapeStyle {
    guard renderingMode == .fullColor else { return AnyShapeStyle(.primary) }
    return AnyShapeStyle(isLow ? Color.red : Color.green)
  }

  /// As Apple's Batteries widget draws it: a plate holding the device's
  /// symbol, a track around it, and the charge arc from twelve o'clock.
  var body: some View {
    ZStack {
      Circle().inset(by: lineWidth).fill(.fill.secondary)
      Circle().stroke(.quaternary, lineWidth: lineWidth)
      Circle()
        .trim(from: 0, to: min(max(fraction, 0), 1))
        .stroke(arcStyle, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .widgetAccentable()
      Image(systemName: deviceSymbol(device.kind))
        .font(.system(size: diameter * 0.34, weight: .medium))
        .foregroundStyle(.primary)
    }
    .frame(width: diameter, height: diameter)
    .padding(lineWidth / 2)
    .accessibilityHidden(true)
  }
}

/// `51%`, `—` without a reading, with a warning symbol when low.
private struct LevelText: View {
  let device: DeviceLevel
  let threshold: Int
  let font: Font

  private var isLow: Bool { (device.percent ?? 101) <= threshold }

  var body: some View {
    HStack(spacing: 3) {
      if isLow {
        Image(systemName: "exclamationmark.triangle.fill").font(.caption2).widgetAccentable()
      }
      Text(device.percent.map { "\($0)%" } ?? "—").font(font.monospacedDigit())
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      "\(device.name), \(device.percent.map { "\($0) percent" } ?? "no battery reading")\(isLow ? ", low" : "")")
  }
}

/// The SF Symbol for a device kind (`Battery.kind`).
private func deviceSymbol(_ kind: String) -> String {
  switch kind {
  case "keyboard": return "keyboard"
  case "mouse": return "computermouse"
  case "trackpad": return "rectangle.and.hand.point.up.left"
  case "headphones": return "headphones"
  case "phone": return "iphone"
  case "speaker": return "hifispeaker"
  default: return "dot.radiowaves.left.and.right"
  }
}

struct BatteryWidget: Widget {
  let kind = "JuiceBatteryWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: BatteryProvider()) { entry in
      JuiceWidgetView(entry: entry)
    }
    .configurationDisplayName("Juice")
    .description("Battery levels of your Bluetooth devices, lowest first.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
