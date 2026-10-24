#import <React/RCTBridgeModule.h>

// Exposes the Swift `JuiceBattery` class (JuiceBatteryModule.swift) to React Native.
@interface RCT_EXTERN_MODULE(JuiceBattery, NSObject)

RCT_EXTERN_METHOD(snapshot:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(refresh:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setThreshold:(nonnull NSNumber *)value
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(permissions:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(openInputMonitoringSettings)

@end
