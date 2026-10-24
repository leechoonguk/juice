import AppKit
import Foundation
import React

/// React Native adapter over `BatteryMonitor`. No logic here.
@objc(JuiceBattery)
final class JuiceBatteryModule: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  /// The last published snapshot, or null before the first read finishes.
  @objc(snapshot:rejecter:)
  func snapshot(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      resolve(BatteryMonitor.shared.latest.map(Battery.payload))
    }
  }

  /// Reads every device now and resolves with the new snapshot.
  @objc(refresh:rejecter:)
  func refresh(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      BatteryMonitor.shared.refresh { resolve(Battery.payload($0)) }
    }
  }

  @objc(setThreshold:resolver:rejecter:)
  func setThreshold(
    _ value: NSNumber, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      resolve(BatteryMonitor.shared.setThreshold(value.intValue).map(Battery.payload))
    }
  }

  /// `{ inputMonitoring }`: whether a keyboard's battery report may be read.
  @objc(permissions:rejecter:)
  func permissions(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(["inputMonitoring": BatteryMonitor.shared.mayReadHIDReports])
  }

  @objc(openInputMonitoringSettings)
  func openInputMonitoringSettings() {
    let pane = "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
    DispatchQueue.main.async { _ = URL(string: pane).map(NSWorkspace.shared.open) }
  }
}
