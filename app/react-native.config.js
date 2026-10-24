/**
 * Android-only libraries stay out of the Apple builds: macOS runs the Swift
 * Bluetooth core and the WidgetKit widget, so none of these pods would be used
 * there. react-native-macos autolinks a dependency's `macos` entry, or else its
 * `ios` one, so both are switched off.
 */
const ANDROID_ONLY = { platforms: { ios: null, macos: null } };

module.exports = {
  dependencies: {
    '@react-native-async-storage/async-storage': ANDROID_ONLY,
    'react-native-android-widget': ANDROID_ONLY,
    'react-native-device-info': ANDROID_ONLY,
  },
};
