import AppKit
import Foundation

// Renders Juice's app icon into the asset catalog: an upright battery, its
// cell filled two-thirds with orange juice — a wavy surface, a few bubbles — on
// fresh green. Drawn with CoreGraphics at every catalog size so no bitmap is
// ever scaled; at 16pt it still reads as a battery with an orange level.
//
//   juice-icon <path to AppIcon.appiconset>

let catalogSizes: [(points: Int, scale: Int)] = [
  (16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2),
]

func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
  CGColor(
    red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
    blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

func gradient(_ stops: [(UInt32, CGFloat)]) -> CGGradient {
  CGGradient(
    colorsSpace: CGColorSpaceCreateDeviceRGB(),
    colors: stops.map { color($0.0) } as CFArray,
    locations: stops.map(\.1))!
}

/// Draws the icon in a 1024-unit space; the context's transform supplies the size.
func drawIcon(in g: CGContext) {
  // macOS icon template: the artwork fills an 824pt rounded square centred in 1024.
  let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
  let tilePath = CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil)

  g.saveGState()
  g.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, alpha: 0.35))
  g.setFillColor(color(0x1E9E62))
  g.addPath(tilePath)
  g.fillPath()
  g.restoreGState()

  g.saveGState()
  g.addPath(tilePath)
  g.clip()
  g.drawLinearGradient(
    gradient([(0x5FD98E, 0), (0x22A86A, 0.55), (0x0F7A55, 1)]),
    start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
  g.restoreGState()

  // The battery: a terminal cap on top of a tall rounded body.
  let body = CGRect(x: 342, y: 196, width: 340, height: 580)
  let bodyPath = CGPath(roundedRect: body, cornerWidth: 86, cornerHeight: 86, transform: nil)
  let cap = CGRect(x: 442, y: 760, width: 140, height: 72)
  let capPath = CGPath(roundedRect: cap, cornerWidth: 26, cornerHeight: 26, transform: nil)

  g.saveGState()
  g.setShadow(offset: CGSize(width: 0, height: -14), blur: 30, color: color(0x003A24, alpha: 0.45))
  g.setFillColor(color(0xF7FBF8))
  g.addPath(capPath)
  g.addPath(bodyPath)
  g.fillPath()
  g.restoreGState()

  // The cell: the body's inside, where the juice sits.
  let cell = body.insetBy(dx: 30, dy: 30)
  let cellPath = CGPath(roundedRect: cell, cornerWidth: 58, cornerHeight: 58, transform: nil)
  g.saveGState()
  g.addPath(cellPath)
  g.clip()
  g.setFillColor(color(0xE3EEE7))
  g.fill(cell)

  // Juice two-thirds up, its surface a gentle wave.
  let level = cell.minY + cell.height * 0.64
  let juice = CGMutablePath()
  juice.move(to: CGPoint(x: cell.minX, y: cell.minY))
  juice.addLine(to: CGPoint(x: cell.minX, y: level))
  let steps = 48
  for step in 0...steps {
    let x = cell.minX + cell.width * CGFloat(step) / CGFloat(steps)
    let phase = Double(step) / Double(steps) * 2 * Double.pi * 1.25
    juice.addLine(to: CGPoint(x: x, y: level + CGFloat(sin(phase)) * 16))
  }
  juice.addLine(to: CGPoint(x: cell.maxX, y: cell.minY))
  juice.closeSubpath()
  g.addPath(juice)
  g.clip()
  g.drawLinearGradient(
    gradient([(0xFFD64F, 0), (0xFFA22E, 0.6), (0xF4761A, 1)]),
    start: CGPoint(x: 512, y: level + 20), end: CGPoint(x: 512, y: cell.minY), options: [])

  // Bubbles rising through it.
  for (x, y, r) in [(430.0, 300.0, 22.0), (560.0, 380.0, 15.0), (470.0, 470.0, 11.0), (590.0, 260.0, 12.0)] {
    g.setFillColor(color(0xFFFFFF, alpha: 0.45))
    g.fillEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
  }
  g.restoreGState()

  // A glassy highlight down the left of the body.
  g.saveGState()
  g.addPath(cellPath)
  g.clip()
  g.setFillColor(color(0xFFFFFF, alpha: 0.28))
  g.addPath(CGPath(roundedRect: CGRect(x: cell.minX + 22, y: cell.minY + 60, width: 26, height: cell.height - 120),
                   cornerWidth: 13, cornerHeight: 13, transform: nil))
  g.fillPath()
  g.restoreGState()
}

func render(pixels: Int) -> Data {
  let context = CGContext(
    data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  context.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)
  drawIcon(in: context)
  let image = context.makeImage()!
  let rep = NSBitmapImageRep(cgImage: image)
  return rep.representation(using: .png, properties: [:])!
}

guard CommandLine.arguments.count == 2 else {
  print("usage: juice-icon <AppIcon.appiconset>")
  exit(2)
}
let folder = URL(fileURLWithPath: CommandLine.arguments[1])
var entries: [[String: String]] = []
for (points, scale) in catalogSizes {
  let name = scale == 1 ? "icon_\(points).png" : "icon_\(points)@\(scale)x.png"
  try render(pixels: points * scale).write(to: folder.appendingPathComponent(name))
  entries.append(["idiom": "mac", "size": "\(points)x\(points)", "scale": "\(scale)x", "filename": name])
  print("wrote \(name)")
}
let manifest: [String: Any] = ["images": entries, "info": ["author": "juice-icon", "version": 1]]
let json = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
try (String(decoding: json, as: UTF8.self) + "\n").write(
  to: folder.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
