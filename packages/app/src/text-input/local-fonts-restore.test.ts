// Restoring local fonts, the cases beside the acceptance tests: overlapping restores
// install a family once, and a family the catalogue already holds is not marked local.
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FontLibrary } from '@canvas/engine';

import { DemandFonts } from './demand-fonts.js';
import {
  isLocalFamily,
  requestLocalFonts,
  loadLocalFont,
  restoreLocalFonts,
} from './local-fonts.js';
import { loadPageFonts, pageFontLoader } from './page-fonts.js';

vi.mock('./page-fonts.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadPageFonts: vi.fn(),
  pageFontLoader: vi.fn(),
}));

const FONT_BYTES = readFileSync(
  new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
);

/**
 * A page loader over a fresh library, with the browser's permission granted and two installed
 * families.
 *
 * @returns The loader, the listing spy and the face reads spy.
 */
function setUp() {
  vi.stubGlobal('navigator', {
    permissions: { query: () => Promise.resolve({ state: 'granted' }) },
  });
  const blob = vi.fn(() => Promise.resolve(new Blob([FONT_BYTES])));
  const query = vi.fn(() =>
    Promise.resolve([
      { family: 'Overlap Private', style: 'Regular', blob },
      { family: 'Catalogue Held', style: 'Regular', blob },
    ]),
  );
  vi.stubGlobal('queryLocalFonts', query);
  const fonts = new FontLibrary();
  const demand = new DemandFonts(fonts, []);
  vi.mocked(loadPageFonts).mockReturnValue({ fonts, loaded: Promise.resolve() });
  vi.mocked(pageFontLoader).mockReturnValue(demand);
  return { demand, query, blob };
}

beforeEach(() => {
  vi.mocked(loadPageFonts).mockReset();
  vi.mocked(pageFontLoader).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

it('installs a family once when restores overlap, sharing one listing', async () => {
  const { demand, query } = setUp();
  const install = vi.spyOn(demand, 'installLocal');
  const [first, second] = await Promise.all([
    restoreLocalFonts(['Overlap Private']),
    restoreLocalFonts(['Overlap Private']),
  ]);
  expect([...first, ...second]).toEqual(['Overlap Private']);
  expect(install).toHaveBeenCalledOnce();
  expect(query).toHaveBeenCalledOnce();
});

it('does not mark a family local when the catalogue already supplies it', async () => {
  const { demand } = setUp();
  demand.register([{ family: 'Catalogue Held', category: 'serif', faces: [] }]);
  await requestLocalFonts();
  await loadLocalFont('Catalogue Held');
  expect(demand.isLocal('Catalogue Held')).toBe(false);
  expect(isLocalFamily('Catalogue Held')).toBe(false);
});
