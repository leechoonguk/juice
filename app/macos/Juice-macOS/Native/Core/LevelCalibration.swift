import Foundation

/// The scale a HID battery report really uses, learned per device.
///
/// A descriptor declares a range and the device need not fill it: a keyboard
/// that declared 0–255 read 69% and 70% when full (measured), so its 20% alert
/// came with 29% left. Nothing says where a device's own scale ends, and the
/// app cannot see a charger, so the ceiling is learned from what repeats: a
/// partial charge ends at a different level each time, a full one at the same.
/// A level is scaled only once that ceiling is confirmed; until then it is shown
/// as read, which errs low — an early alert, never a missed one.
///
/// Only levels read from a HID report are learned from: the system's record and
/// LE Battery Level are percentages by specification.
struct LevelCalibration: Codable, Equatable {
  /// How far a level must climb from its last low to count as a charge.
  static let rise = 10
  /// How far two readings of the same charge may differ (69 and 70, measured).
  static let tolerance = 2
  /// How many charges must end at the same level before it is the ceiling.
  static let confirming = 3
  /// How many recent charges are remembered, so a ceiling follows an ageing battery down.
  static let window = 5
  /// A device that ever reports this much fills its declared range and is never scaled.
  static let honest = 95
  /// The fastest a battery is taken to drain, in points an hour. A level that
  /// falls faster is a glitch, not a discharge: learned from, a level flapping
  /// between a stale low and the real one would count every return as a charge.
  static let drain = 20.0

  struct Track: Codable, Equatable {
    /// Where the current climb started and the highest level it has reached.
    var low: Int
    var high: Int
    /// The last level learned from, and when it was read.
    var level: Int
    var at: Date
    /// The levels at which earlier charges ended, oldest first.
    var peaks: [Int] = []
    var ceiling: Int?
    var isHonest = false
  }

  private(set) var tracks: [String: Track] = [:]

  /// The confirmed ceiling of each device that has one, by identifier.
  var ceilings: [String: Int] {
    tracks.compactMapValues { $0.isHonest ? nil : $0.ceiling }
  }

  /// `devices` with every HID-report level on the scale learned for its device.
  mutating func apply(to devices: [DeviceBattery], at now: Date) -> [DeviceBattery] {
    var devices = devices
    for at in devices.indices {
      for index in devices[at].readings.indices where devices[at].readings[index].source == "HID report" {
        let reading = devices[at].readings[index]
        devices[at].readings[index] = BatteryReading(
          part: reading.part, percent: level(reading.percent, for: devices[at].identifier, at: now),
          source: reading.source)
      }
    }
    return devices
  }

  /// Learns from one reading of `identifier` taken at `now` and returns the level to show for it.
  mutating func level(_ percent: Int, for identifier: String, at now: Date) -> Int {
    var track = tracks[identifier] ?? Track(low: percent, high: percent, level: percent, at: now)
    defer { tracks[identifier] = track }
    if percent >= Self.honest { track.isHonest = true }
    guard !track.isHonest else { return percent }
    // A level clear above the ceiling disproves it: those charges were partial ones that happened to agree.
    if let ceiling = track.ceiling, percent > ceiling + Self.tolerance {
      track.ceiling = nil
      track.peaks = []
    }
    let fall = track.level - percent
    let hours = now.timeIntervalSince(track.at) / 3600
    if fall < Self.rise || Double(fall) <= Self.drain * hours {
      track.level = percent
      track.at = now
      learn(percent, in: &track)
    }
    guard let ceiling = track.ceiling else { return percent }
    return min(100, (percent * 100 + ceiling / 2) / ceiling)
  }

  private func learn(_ percent: Int, in track: inout Track) {
    if percent < track.high - Self.tolerance {
      // The level left its high: that climb is over, and was a charge if it rose far enough.
      if track.high - track.low >= Self.rise {
        track.peaks = Array((track.peaks + [track.high]).suffix(Self.window))
      }
      track.low = percent
      track.high = percent
    } else if percent > track.high {
      track.high = percent
    }
    let climbing = track.high - track.low >= Self.rise ? [track.high] : []
    let peaks = (track.peaks + climbing).suffix(Self.window)
    // Only the highest peaks can be the ceiling: a higher one shows the device goes further.
    if let top = peaks.max(), peaks.filter({ $0 >= top - Self.tolerance }).count >= Self.confirming {
      track.ceiling = top
    }
  }
}
