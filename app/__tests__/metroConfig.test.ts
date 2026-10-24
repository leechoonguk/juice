// The project's resolveRequest replaces the CLI's, which is the one that maps
// `react-native` to `react-native-macos` on macOS. Dropping it bundled core
// React Native into the Mac app, and it died at launch on `Platform.select`.

type Resolve = (context: { originModulePath: string; resolveRequest: Resolve }, name: string, platform: string) => unknown;

const mockFrameworkResolve = jest.fn((_context: unknown, name: string, platform: string) => ({ via: 'framework', name, platform }));

jest.mock('@react-native/metro-config', () => ({
  getDefaultConfig: () => ({ resolver: { resolveRequest: mockFrameworkResolve } }),
  mergeConfig: (base: { resolver: object }, extra: { resolver: object }) => ({
    ...base,
    resolver: { ...base.resolver, ...extra.resolver },
  }),
}));

const { resolver } = require('../metro.config') as { resolver: { resolveRequest: Resolve } };

const context = (origin: string) => ({
  originModulePath: origin,
  resolveRequest: jest.fn(() => ({ via: 'metro' })) as unknown as Resolve,
});

beforeEach(() => mockFrameworkResolve.mockClear());

test('macOS requests still go through the CLI resolver that maps react-native to react-native-macos', () => {
  expect(resolver.resolveRequest(context('/app/App.tsx'), 'react-native', 'macos')).toEqual({
    via: 'framework',
    name: 'react-native',
    platform: 'macos',
  });
  resolver.resolveRequest(context('/app/src/screens/BatteryScreen.tsx'), '../native/juiceBattery', 'macos');
  expect(mockFrameworkResolve).toHaveBeenCalledTimes(2);
});

test('an Android import of a native wrapper resolves to its mobile file, and nothing else is swapped', () => {
  const origin = context('/app/src/screens/BatteryScreen.tsx');
  expect(resolver.resolveRequest(origin, '../native/juiceBattery', 'android')).toEqual({
    type: 'sourceFile',
    filePath: expect.stringMatching(/mobile\/src\/juiceBattery\.ts$/),
  });
  expect(resolver.resolveRequest(origin, '../native/appUpdates', 'android')).toEqual({
    type: 'sourceFile',
    filePath: expect.stringMatching(/mobile\/src\/appUpdates\.ts$/),
  });
  expect(resolver.resolveRequest(context('/app/index.js'), './src/native/backgroundTasks', 'android')).toEqual({
    type: 'sourceFile',
    filePath: expect.stringMatching(/mobile\/src\/widget\.tsx$/),
  });
  expect(mockFrameworkResolve).not.toHaveBeenCalled();

  // The Android-only wrapper has no swap: it is the one door to the native module there.
  resolver.resolveRequest(context('/app/mobile/src/juiceBattery.ts'), '../../src/native/androidBluetooth', 'android');
  // A library's own file of the same name is the library's.
  resolver.resolveRequest(context('/app/node_modules/lib/index.js'), './native/appUpdates', 'android');
  expect(mockFrameworkResolve).toHaveBeenCalledTimes(2);
});
