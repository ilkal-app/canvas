import { readFileSync } from 'node:fs';

import { afterEach, expect, it, vi } from 'vitest';

import { FontLibrary } from '@canvas/engine';

import { DemandFonts } from './demand-fonts.js';
import { loadLocalFont, requestLocalFonts, supportsLocalFonts } from './local-fonts.js';
import { loadPageFonts, pageFontLoader } from './page-fonts.js';

vi.mock('./page-fonts.js', () => ({ loadPageFonts: vi.fn(), pageFontLoader: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it('requires permission, installs into the shared renderer and never fetches or uploads bytes', async () => {
  const bytes = readFileSync(
    new URL('../../../engine/assets/fonts/LiberationSans-Regular.ttf', import.meta.url),
  );
  const fonts = new FontLibrary();
  const demand = new DemandFonts(fonts, []);
  vi.mocked(loadPageFonts).mockReturnValue({ fonts, loaded: Promise.resolve() });
  vi.mocked(pageFontLoader).mockReturnValue(demand);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('queryLocalFonts', undefined);
  expect(supportsLocalFonts()).toBe(false);
  await expect(loadLocalFont('Private Mono')).rejects.toThrow('Allow local fonts');
  const blob = vi.fn(() => Promise.resolve(new Blob([bytes])));
  const query = vi.fn(() => Promise.resolve([{ family: 'Private Mono', style: 'Regular', blob }]));
  vi.stubGlobal('queryLocalFonts', query);
  expect(supportsLocalFonts()).toBe(true);
  expect(query).not.toHaveBeenCalled();
  expect(await requestLocalFonts()).toEqual(['Private Mono']);
  expect(blob).not.toHaveBeenCalled();
  const changed = vi.fn();
  demand.subscribe(changed);
  await loadLocalFont('Private Mono');
  expect(demand.status('Private Mono')).toBe('ready');
  expect(fonts.faces).toEqual([{ family: 'Private Mono', weight: 400, isItalic: false }]);
  expect(changed).toHaveBeenCalledOnce();
  await loadLocalFont('Private Mono');
  expect(fonts.faces).toHaveLength(1);
  expect(blob).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});
