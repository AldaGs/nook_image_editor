import { catalog, cachedFetch, fontFileUrl, slug } from './fontCatalog.svelte';
// Fonts for text layers: bundled @fontsource files (Latin) that work offline, plus
// the full Google Fonts catalog through the Fontsource API, fetched the first time
// a family and weight is drawn and kept in the Cache API so it works offline after. PBC looks fonts up by these same family names, so
// a board's fonts must be installed on the desktop that opens the .pbc.

import inter100 from '@fontsource/inter/files/inter-latin-100-normal.woff2?url';
import inter200 from '@fontsource/inter/files/inter-latin-200-normal.woff2?url';
import inter300 from '@fontsource/inter/files/inter-latin-300-normal.woff2?url';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?url';
import inter900 from '@fontsource/inter/files/inter-latin-900-normal.woff2?url';
import montserrat100 from '@fontsource/montserrat/files/montserrat-latin-100-normal.woff2?url';
import montserrat200 from '@fontsource/montserrat/files/montserrat-latin-200-normal.woff2?url';
import montserrat300 from '@fontsource/montserrat/files/montserrat-latin-300-normal.woff2?url';
import montserrat400 from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff2?url';
import montserrat500 from '@fontsource/montserrat/files/montserrat-latin-500-normal.woff2?url';
import montserrat600 from '@fontsource/montserrat/files/montserrat-latin-600-normal.woff2?url';
import montserrat700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2?url';
import montserrat800 from '@fontsource/montserrat/files/montserrat-latin-800-normal.woff2?url';
import montserrat900 from '@fontsource/montserrat/files/montserrat-latin-900-normal.woff2?url';
import playfairDisplay400 from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2?url';
import playfairDisplay500 from '@fontsource/playfair-display/files/playfair-display-latin-500-normal.woff2?url';
import playfairDisplay600 from '@fontsource/playfair-display/files/playfair-display-latin-600-normal.woff2?url';
import playfairDisplay700 from '@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2?url';
import playfairDisplay800 from '@fontsource/playfair-display/files/playfair-display-latin-800-normal.woff2?url';
import playfairDisplay900 from '@fontsource/playfair-display/files/playfair-display-latin-900-normal.woff2?url';
import bebasNeue400 from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url';
import spaceGrotesk300 from '@fontsource/space-grotesk/files/space-grotesk-latin-300-normal.woff2?url';
import spaceGrotesk400 from '@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2?url';
import spaceGrotesk500 from '@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2?url';
import spaceGrotesk600 from '@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2?url';
import spaceGrotesk700 from '@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2?url';
import anton400 from '@fontsource/anton/files/anton-latin-400-normal.woff2?url';

/** Family → weight → file URL, for the fonts shipped with the app. */
export const FONTS: Record<string, Record<number, string>> = {
  'Inter': { 100: inter100, 200: inter200, 300: inter300, 400: inter400, 500: inter500, 600: inter600, 700: inter700, 800: inter800, 900: inter900 },
  'Montserrat': { 100: montserrat100, 200: montserrat200, 300: montserrat300, 400: montserrat400, 500: montserrat500, 600: montserrat600, 700: montserrat700, 800: montserrat800, 900: montserrat900 },
  'Playfair Display': { 400: playfairDisplay400, 500: playfairDisplay500, 600: playfairDisplay600, 700: playfairDisplay700, 800: playfairDisplay800, 900: playfairDisplay900 },
  'Bebas Neue': { 400: bebasNeue400 },
  'Space Grotesk': { 300: spaceGrotesk300, 400: spaceGrotesk400, 500: spaceGrotesk500, 600: spaceGrotesk600, 700: spaceGrotesk700 },
  'Anton': { 400: anton400 },
};

/** The weights a family has, lightest first: bundled, then from the online catalog. */
export function weightsOf(family: string): number[] {
  const bundled = FONTS[family];
  if (bundled) return Object.keys(bundled).map(Number);
  const remote = catalog.byFamily.get(family)?.weights ?? catalog.remembered[family];
  return remote?.length ? [...remote].sort((a, b) => a - b) : Object.keys(FONTS.Inter!).map(Number);
}

/** The family's file nearest to `weight`, or null when it can't be had (text then draws in Inter). */
export async function loadFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  const nearest = weightsOf(family).reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a));
  const bundled = FONTS[family];
  if (bundled) {
    const res = await fetch(bundled[nearest]!);
    return res.ok ? res.arrayBuffer() : null;
  }
  const font = catalog.byFamily.get(family);
  const res = await cachedFetch(fontFileUrl(font?.id ?? slug(family), font?.defSubset ?? 'latin', nearest));
  return res?.ok ? res.arrayBuffer() : null;
}
