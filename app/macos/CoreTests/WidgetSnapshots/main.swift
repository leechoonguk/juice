import AppKit
import SwiftUI
import WidgetKit

// Renders the README's widget pictures from the real `JuiceWidgetView`, compiled
// in through the `Widget` symlink, so a changed widget is re-rendered — never
// redrawn by hand:
//
//   juice-widget-snapshots <output directory>   widgets-light.png, widgets-dark.png
//                                               (`make widget-snapshots`)
//   juice-widget-snapshots --demo <file.gif>    the moving demo: a scripted desk of
//                                               devices whose levels change frame by
//                                               frame, encoded by ffmpeg (`make demo`)
//
// Every device is made up: no real name or address belongs in a picture.

/// WidgetKit's point sizes for each family on a Mac desktop.
let families: [(family: WidgetFamily, size: CGSize)] = [
  (.systemSmall, CGSize(width: 170, height: 170)),
  (.systemMedium, CGSize(width: 364, height: 170)),
  (.systemLarge, CGSize(width: 364, height: 382)),
]
let gap: CGFloat = 20
let threshold = 20

func reading(_ percent: Int, _ source: String = "system") -> [BatteryReading] {
  [BatteryReading(part: nil, percent: percent, source: source)]
}

/// The still: a desk of devices, one of them low, ordered the way the app publishes them.
let stillEntry = BatteryEntry(
  date: Date(),
  snapshot: Battery.snapshot(
    [
      DeviceBattery(name: "Keyboard", identifier: "readme-1", kind: "keyboard", readings: reading(14, "HID report")),
      DeviceBattery(name: "Mouse", identifier: "readme-2", kind: "mouse", readings: reading(52, "HID report")),
      DeviceBattery(name: "Trackpad", identifier: "readme-3", kind: "trackpad", readings: reading(75)),
      DeviceBattery(
        name: "Headphones", identifier: "readme-4", kind: "headphones",
        readings: [BatteryReading(part: "left", percent: 90, source: "system"), BatteryReading(part: "right", percent: 88, source: "system")]),
      DeviceBattery(name: "Phone", identifier: "readme-5", kind: "phone", readings: reading(97, "LE")),
      // Reports no battery: listed in the menu, never drawn by the widget.
      DeviceBattery(name: "Speaker", identifier: "readme-6", kind: "speaker", notes: ["reports no battery to this Mac"]),
    ],
    threshold: threshold, now: Date()),
  isSample: false)

// MARK: - The demo script

/// Frames per second of the demo, and its length.
let fps = 12
let seconds = 10.0

/// One device's level over the demo: linear from `from` to `to` between two times, held outside them.
struct Track {
  let name: String
  let kind: String
  let from: Int
  let to: Int
  let start: Double
  let end: Double
  /// When the device connects; before it, the device is not on the desk at all.
  var connects: Double = 0

  func percent(at time: Double) -> Int? {
    guard time >= connects else { return nil }
    let progress = min(max((time - start) / (end - start), 0), 1)
    return Int((Double(from) + Double(to - from) * progress).rounded())
  }
}

/// The keyboard drains past the threshold — its ring turns red and the warning
/// appears — while the rest barely move; then headphones connect and take their place.
let tracks = [
  Track(name: "Keyboard", kind: "keyboard", from: 34, to: 16, start: 0.5, end: 6),
  Track(name: "Mouse", kind: "mouse", from: 61, to: 57, start: 0.5, end: 6),
  Track(name: "Trackpad", kind: "trackpad", from: 82, to: 80, start: 0.5, end: 6),
  Track(name: "Phone", kind: "phone", from: 97, to: 95, start: 0.5, end: 6),
  Track(name: "Headphones", kind: "headphones", from: 90, to: 90, start: 0, end: 1, connects: 7),
]

func demoEntry(at time: Double) -> BatteryEntry {
  let devices = tracks.enumerated().compactMap { index, track -> DeviceBattery? in
    track.percent(at: time).map {
      DeviceBattery(name: track.name, identifier: "demo-\(index)", kind: track.kind, readings: reading($0))
    }
  } + [DeviceBattery(name: "Speaker", identifier: "demo-speaker", kind: "speaker", notes: ["reports no battery to this Mac"])]
  return BatteryEntry(
    date: Date(), snapshot: Battery.snapshot(devices, threshold: threshold, now: Date()), isSample: false)
}

// MARK: - Drawing

/// One widget as a desktop host draws it: its content inset, on a rounded tile.
struct Tile: View {
  let entry: BatteryEntry
  let family: WidgetFamily
  let scheme: ColorScheme

  var body: some View {
    let size = families.first(where: { $0.family == family })!.size
    JuiceWidgetView(entry: entry, family: family)
      .padding(16)
      .frame(width: size.width, height: size.height)
      .background(
        RoundedRectangle(cornerRadius: 22, style: .continuous)
          .fill(scheme == .dark ? Color(white: 0.17) : Color.white)
          .shadow(color: .black.opacity(scheme == .dark ? 0.5 : 0.12), radius: 10, y: 4))
  }
}

/// Medium over small on the left, large on the right.
struct Board: View {
  let entry: BatteryEntry
  let scheme: ColorScheme

  var body: some View {
    HStack(alignment: .top, spacing: gap) {
      VStack(alignment: .leading, spacing: gap) {
        Tile(entry: entry, family: .systemMedium, scheme: scheme)
        Tile(entry: entry, family: .systemSmall, scheme: scheme)
      }
      Tile(entry: entry, family: .systemLarge, scheme: scheme)
    }
    .padding(32)
    .background(scheme == .dark ? Color(white: 0.08) : Color(white: 0.92))
    .environment(\.colorScheme, scheme)
  }
}

/// PNG bytes of `view` at twice its point size, so pictures stay sharp on a high-density screen.
func png(_ view: some View) -> Data? {
  MainActor.assumeIsolated {
    let renderer = ImageRenderer(content: view)
    renderer.scale = 2
    return renderer.cgImage.flatMap { NSBitmapImageRep(cgImage: $0).representation(using: .png, properties: [:]) }
  }
}

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(code)
}

// MARK: - Commands

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.count {
case 1:
  let output = URL(fileURLWithPath: arguments[0], isDirectory: true)
  try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
  for (scheme, name) in [(ColorScheme.light, "light"), (.dark, "dark")] {
    guard let data = png(Board(entry: stillEntry, scheme: scheme)) else { fail("could not render the \(name) widgets") }
    let file = output.appendingPathComponent("widgets-\(name).png")
    try data.write(to: file)
    print("wrote \(file.path)")
  }

case 2 where arguments[0] == "--demo":
  let gif = URL(fileURLWithPath: arguments[1])
  let frames = FileManager.default.temporaryDirectory.appendingPathComponent("juice-demo-\(getpid())")
  try FileManager.default.createDirectory(at: frames, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: frames) }
  let count = Int(seconds * Double(fps))
  for index in 0..<count {
    guard let data = png(Board(entry: demoEntry(at: Double(index) / Double(fps)), scheme: .dark)) else {
      fail("could not render demo frame \(index)")
    }
    try data.write(to: frames.appendingPathComponent(String(format: "frame-%03d.png", index)))
  }
  // One palette for the whole clip (the colours barely change), dithered lightly
  // so the rings' edges stay clean; scaled to the README's display width.
  let ffmpeg = Process()
  ffmpeg.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  ffmpeg.arguments = [
    "ffmpeg", "-y", "-loglevel", "error", "-framerate", "\(fps)",
    "-i", frames.appendingPathComponent("frame-%03d.png").path,
    "-vf", "scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5",
    "-loop", "0", gif.path,
  ]
  do { try ffmpeg.run() } catch { fail("ffmpeg is needed for the demo (brew install ffmpeg): \(error.localizedDescription)") }
  ffmpeg.waitUntilExit()
  guard ffmpeg.terminationStatus == 0 else { fail("ffmpeg exited \(ffmpeg.terminationStatus)") }
  print("wrote \(gif.path) (\(count) frames)")

default:
  fail("usage: juice-widget-snapshots <output directory> | --demo <file.gif>", code: 2)
}
