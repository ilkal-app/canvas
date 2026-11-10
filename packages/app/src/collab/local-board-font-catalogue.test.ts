import { afterEach, expect, it, vi } from 'vitest';

import { loadRemoteFontCatalogue } from '../text-input/page-fonts.js';
import {
  configureFontCatalogue,
  fetchFontCatalogue,
  fontCatalogueBase,
} from '../text-input/remote-font-catalogue.js';

import { createLocalBoardConnection } from './local-board-connection.js';

afterEach(() => {
  configureFontCatalogue(undefined);
  vi.unstubAllGlobals();
});

it('leaves a local board without a font catalogue it never requests, when asked', async () => {
  const fetch = vi.fn(() => Promise.resolve(Response.json({ version: 1, entries: [] })));
  vi.stubGlobal('fetch', fetch);
  const connection = await createLocalBoardConnection('sdk', {
    openCache: () => Promise.resolve(undefined),
    shouldSeedDemoBoard: false,
    hasFontCatalogue: false,
  });
  try {
    expect(fontCatalogueBase()).toBeUndefined();
    await expect(loadRemoteFontCatalogue(true)).resolves.toEqual([]);
    await expect(fetchFontCatalogue()).rejects.toThrow('no font catalogue');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    connection.destroy();
  }
});

it('keeps the same-origin catalogue for a local board by default (the playground)', async () => {
  const connection = await createLocalBoardConnection('playground', {
    openCache: () => Promise.resolve(undefined),
    shouldSeedDemoBoard: false,
  });
  try {
    expect(fontCatalogueBase()).toBe('/assets/fonts/');
  } finally {
    connection.destroy();
  }
});
