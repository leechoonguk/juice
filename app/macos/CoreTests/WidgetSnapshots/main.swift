import AppKit
import SwiftUI
import WidgetKit

// Renders the README's widget pictures: the real `JuiceWidgetView`, in all
// three sizes, once light and once dark, each set on one backdrop. The widget
// sources are compiled in through the `Widget` symlink, so a changed widget is
// re-rendered with `make widget-snapshots`, never redrawn by hand.
//
//   juice-widget-snapshots <output directory>

/// WidgetKit's point sizes for each family on a Mac desktop.
let families: [(family: WidgetFamily, size: CGSize)] = [
  (.systemSmall, CGSize(width: 170, height: 170)),
  (.systemMedium, CGSize(width: 364, height: 170)),
  (.systemLarge, CGSize(width: 364, height: 382)),
]
let gap: CGFloat = 20

/// A desk of devices, one of them low, ordered the way the app publishes them.
let entry = BatteryEntry(
  date: Date(),
  snapshot: Battery.snapshot(
    [
      DeviceBattery(name: "Keyboard", identifier: "readme-1", kind: "keyboard", readings: [BatteryReading(part: nil, percent: 14, source: "HID report")]),
      DeviceBattery(name: "Mouse", identifier: "readme-2", kind: "mouse", readings: [BatteryReading(part: nil, percent: 52, source: "HID report")]),
      DeviceBattery(name: "Trackpad", identifier: "readme-3", kind: "trackpad", readings: [BatteryReading(part: nil, percent: 75, source: "system")]),
      DeviceBattery(
        name: "Headphones", identifier: "readme-4", kind: "headphones",
        readings: [BatteryReading(part: "left", percent: 90, source: "system"), BatteryReading(part: "right", percent: 88, source: "system")]),
      DeviceBattery(name: "Phone", identifier: "readme-5", kind: "phone", readings: [BatteryReading(part: nil, percent: 97, source: "LE")]),
      // Reports no battery: listed in the menu, never drawn by the widget.
      DeviceBattery(name: "Speaker", identifier: "readme-6", kind: "speaker", notes: ["reports no battery to this Mac"]),
    ],
    threshold: 20, now: Date()),
  isSample: false)

/// One widget as a desktop host draws it: its content inset, on a rounded tile.
struct Tile: View {
  let family: WidgetFamily
  let size: CGSize
  let scheme: ColorScheme

  var body: some View {
    JuiceWidgetView(entry: entry, family: family)
      .padding(16)
      .frame(width: size.width, height: size.height)
      .background(
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .fill(scheme == .dark ? Color(white: 0.17) : Color.white)
          .shadow(color: .black.opacity(scheme == .dark ? 0.5 : 0.12), radius: 10, y: 4))
  }
}

/// Small over medium on the left, large on the right.
struct Board: View {
  let scheme: ColorScheme

  var body: some View {
    HStack(alignment: .top, spacing: gap) {
      VStack(alignment: .leading, spacing: gap) {
        tile(.systemMedium)
        tile(.systemSmall)
      }
      tile(.systemLarge)
    }
    .padding(32)
    .background(scheme == .dark ? Color(white: 0.08) : Color(white: 0.92))
    .environment(\.colorScheme, scheme)
  }

  private func tile(_ family: WidgetFamily) -> some View {
    Tile(family: family, size: families.first(where: { $0.family == family })!.size, scheme: scheme)
  }
}

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write(Data("usage: juice-widget-snapshots <output directory>\n".utf8))
  exit(2)
}
let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

for (scheme, name) in [(ColorScheme.light, "light"), (.dark, "dark")] {
  let png = MainActor.assumeIsolated { () -> Data? in
    let renderer = ImageRenderer(content: Board(scheme: scheme))
    // Twice the point size, so the picture stays sharp on a high-density screen.
    renderer.scale = 2
    return renderer.cgImage.flatMap { NSBitmapImageRep(cgImage: $0).representation(using: .png, properties: [:]) }
  }
  guard let png else {
    FileHandle.standardError.write(Data("could not render the \(name) widgets\n".utf8))
    exit(1)
  }
  let file = output.appendingPathComponent("widgets-\(name).png")
  try png.write(to: file)
  print("wrote \(file.path)")
}
