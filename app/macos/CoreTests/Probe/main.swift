import Foundation

// Reads every connected device's battery once, through the app's own
// `BatteryReader`, and prints what the widget would show — the way to tell a
// reading problem from a UI one, without React or the menu bar app.
//
//   juice-probe [--threshold N]

let arguments = CommandLine.arguments
let threshold = arguments.firstIndex(of: "--threshold").flatMap { arguments.indices.contains($0 + 1) ? Int(arguments[$0 + 1]) : nil } ?? 20

let reader = BatteryReader()
let done = DispatchSemaphore(value: 0)
var devices: [DeviceBattery] = []
DispatchQueue.global().async {
  reader.read { result in
    devices = result
    done.signal()
  }
}
// The LE read reports on its own queue; keep the main run loop turning meanwhile.
while done.wait(timeout: .now() + 0.1) == .timedOut {
  RunLoop.main.run(until: Date().addingTimeInterval(0.1))
}

let snapshot = Battery.snapshot(devices, threshold: threshold, now: Date())
print("== \(snapshot.devices.count) connected devices, low at \(threshold)% or less")
for device in snapshot.devices {
  let level = device.percent.map { String(format: "%3d%%", $0) } ?? "   —"
  let detail = device.source.map { "from \($0)" } ?? device.note ?? ""
  let parts = device.parts.sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)%" }.joined(separator: ", ")
  print("\(level)  \(device.name)  [\(device.kind)]  \(detail)\(parts.isEmpty ? "" : "  (\(parts))")")
}
