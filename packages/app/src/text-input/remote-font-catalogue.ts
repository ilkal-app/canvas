import type { FontFaceSource } from '@canvas/engine';
import { isFontWeight } from '@canvas/schema';

import type { FontCategory, FontFamilyEntry } from './font-catalogue.js';

let catalogueBase: string | undefined = '/assets/fonts/';

/**
 * Configures the page's public font service from the validated board address; no request starts.
 *
 * @param assetsUrl - The configured service, or same-origin routes for standalone pages.
 */
export function configureFontCatalogue(assetsUrl: string | undefined): void {
  catalogueBase = `${assetsUrl?.replace(/\/$/, '') ?? ''}/assets/fonts/`;
}

/**
 * Leaves the page with no font service (an SDK board, which makes no network request):
 * the catalogue is never requested, and only the bundled fonts are offered.
 */
export function disableFontCatalogue(): void {
  catalogueBase = undefined;
}

/**
 * Reads the route used for both catalogue metadata and its font files.
 *
 * @returns The configured public fonts route, or undefined when the page has no font service.
 */
export function fontCatalogueBase(): string | undefined {
  return catalogueBase;
}

const CATEGORIES = new Set(['sans', 'serif', 'mono', 'display', 'handwriting']);

/**
 * Loads the self-hosted catalogue; all font URLs remain on the same service.
 *
 * @param base - The assets service's public fonts route; the page's if absent.
 * @returns Approved families, with safe service-relative face URLs.
 * @throws {Error} When the page has no font service, or the catalogue cannot be loaded or has an
 *   invalid shape.
 */
export async function fetchFontCatalogue(
  base = fontCatalogueBase(),
): Promise<readonly FontFamilyEntry[]> {
  if (base === undefined) throw new Error('This page has no font catalogue.');
  const response = await fetch(`${base}catalogue.json`);
  if (!response.ok) throw new Error('The font catalogue could not be loaded.');
  return parseFontCatalogue(await response.json(), base);
}

/**
 * Validates an imported catalogue without accepting third-party URLs.
 *
 * @param value - The downloaded JSON.
 * @param base - The configured self-hosted font route.
 * @returns Font families safe to request.
 * @throws {Error} When catalogue data is invalid.
 */
export function parseFontCatalogue(value: unknown, base: string): readonly FontFamilyEntry[] {
  const data = value as { version?: unknown; entries?: unknown } | null;
  if (data?.version !== 1 || !Array.isArray(data.entries))
    throw new Error('Invalid font catalogue.');
  return data.entries.flatMap((value: unknown): FontFamilyEntry[] => {
    const entry = value as {
      family?: unknown;
      category?: unknown;
      licence?: unknown;
      faces?: unknown;
    } | null;
    if (
      !entry ||
      typeof entry.family !== 'string' ||
      !CATEGORIES.has(String(entry.category)) ||
      !['OFL-1.1', 'Apache-2.0'].includes(String(entry.licence)) ||
      !Array.isArray(entry.faces)
    )
      return [];
    const family = entry.family;
    const faces = entry.faces.flatMap((value: unknown): FontFaceSource[] => {
      const face = value as { weight?: unknown; isItalic?: unknown; url?: unknown } | null;
      if (
        !face ||
        !isFontWeight(face.weight) ||
        typeof face.isItalic !== 'boolean' ||
        typeof face.url !== 'string' ||
        !/^[a-z0-9]+\/[1-9]00i?\.ttf$/.test(face.url)
      )
        return [];
      return [{ family, weight: face.weight, isItalic: face.isItalic, url: `${base}${face.url}` }];
    });
    return faces.length === 0 ? [] : [{ family, category: entry.category as FontCategory, faces }];
  });
}
