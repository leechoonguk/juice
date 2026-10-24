import { type ColorValue, PlatformColor } from 'react-native';

/**
 * macOS semantic colours. They follow light/dark mode, Increase Contrast and
 * the user's accent colour on their own, which fixed hex values never do.
 */
export const colors: Record<
  'label' | 'secondaryLabel' | 'tertiaryLabel' | 'track' | 'accent' | 'separator' | 'window' | 'card' | 'low',
  ColorValue
> = {
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

/** One spacing scale for every margin and gap, so the layout keeps a rhythm. */
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };
