module.exports = {
  root: true,
  extends: '@react-native',
  // The desktop app's bundles, packaged builds and dependencies, and the native
  // build output (DerivedData holds generated and vendored JS), not its sources.
  ignorePatterns: ['desktop/out/', 'desktop/release/', 'desktop/node_modules/', 'macos/build/**'],
};
