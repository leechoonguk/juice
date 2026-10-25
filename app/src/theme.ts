import { Appearance, type ColorValue, Platform, PlatformColor } from 'react-native';

/** Every colour the window names. */
export type Palette = Record<
  'label' | 'secondaryLabel' | 'tertiaryLabel' | 'track' | 'accent' | 'separator' | 'window' | 'card' | 'low',
  `#${string}`
>;

/**
 * A fixed palette per scheme, for the platforms with no named system colours
 * React Native can reach — Android and the Windows/Linux window. The Android
 * widget draws with its own colours, measured from the macOS widget
 * (`app/mobile/src/widgetArt.ts`).
 */
export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: {
    label: '#1d1d1f',
    secondaryLabel: '#6e6e73',
    tertiaryLabel: '#aeaeb2',
    track: '#d1d1d6',
    accent: '#0a64d8',
    separator: '#d2d2d7',
    window: '#f5f5f7',
    card: '#ffffff',
    low: '#d70015',
  },
  dark: {
    label: '#f5f5f7',
    secondaryLabel: '#a1a1a6',
    tertiaryLabel: '#636366',
    track: '#48484a',
    accent: '#3b8cff',
    separator: '#3a3a3c',
    window: '#1c1c1e',
    card: '#2c2c2e',
    low: '#ff453a',
  },
};

/**
 * macOS semantic colours. They follow light/dark mode, Increase Contrast and
 * the user's accent colour on their own, which fixed hex values never do.
 */
const APPKIT: Record<keyof Palette, ColorValue> = {
  label: PlatformColor('labelColor'),
  secondaryLabel: PlatformColor('secondaryLabelColor'),
  tertiaryLabel: PlatformColor('tertiaryLabelColor'),
  track: PlatformColor('quaternaryLabelColor'),
  accent: PlatformColor('controlAccentColor'),
  separator: PlatformColor('separatorColor'),
  window: PlatformColor('windowBackgroundColor'),
  card: PlatformColor('controlBackgroundColor'),
  low: PlatformColor('systemRedColor'),
};

/** The fixed palettes follow the scheme the app starts in. */
export const colors = Platform.select<Record<keyof Palette, ColorValue>>({
  macos: APPKIT,
  default: PALETTES[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'],
});

/** One spacing scale for every margin and gap, so the layout keeps a rhythm. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
