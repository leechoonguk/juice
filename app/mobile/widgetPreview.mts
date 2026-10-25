/**
 * Draws the Android widget gallery's preview — the macOS sample at the medium
 * size, light and dark — with the widget's own drawing code (`widgetArt.ts`),
 * so the gallery shows what a placed widget draws. Run by
 * `make android-widget-preview`; macOS only: Quick Look rasterises the SVG onto
 * an opaque square, so ffmpeg crops it to the widget and cuts the corners out
 * with a mask drawn the same way.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The preview's width in pixels: the medium widget at about three times its points. */
const PIXELS = 1014;
const RESOURCES = join(import.meta.dirname, '..', 'android', 'app', 'src', 'main', 'res');
const TARGETS = { light: 'drawable-nodpi', dark: 'drawable-night-nodpi' } as const;

// The app's sources import without extensions, as Metro and Jest resolve them.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.')) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { REFERENCE, SAMPLE_SNAPSHOT, widgetMask, widgetSvg } = await import('./src/widgetArt.ts');
const { width, height } = REFERENCE.medium;
const pixelHeight = Math.round((PIXELS * height) / width);
const work = mkdtempSync(join(tmpdir(), 'juice-widget-preview-'));
try {
  for (const [scheme, folder] of Object.entries(TARGETS)) {
    const art = rasterise(work, scheme, widgetSvg(SAMPLE_SNAPSHOT, width, height, scheme as keyof typeof TARGETS));
    const mask = rasterise(work, `${scheme}-mask`, widgetMask(width, height));
    const target = join(RESOURCES, folder, 'widget_preview.png');
    const crop = `crop=${PIXELS}:${pixelHeight}:0:0`;
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-i', art, '-i', mask,
      '-filter_complex', `[0]${crop}[art];[1]${crop},format=gray[mask];[art][mask]alphamerge`,
      target,
    ]);
    console.log(`==> ${target}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** `svg` as a PNG `PIXELS` wide, on Quick Look's opaque square. */
function rasterise(directory: string, name: string, svg: string): string {
  const file = join(directory, `${name}.svg`);
  writeFileSync(file, svg);
  execFileSync('qlmanage', ['-t', '-s', String(PIXELS), '-o', directory, file], { stdio: 'ignore' });
  return `${file}.png`;
}
