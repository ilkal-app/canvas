import { afterEach, expect, it, vi } from 'vitest';

import { configureFontCatalogue, fetchFontCatalogue } from '../text-input/remote-font-catalogue.js';

import { openBoardConnection } from './open-board-connection.js';

const entry = {
  family: 'Remote Example',
  category: 'sans',
  licence: 'OFL-1.1',
  faces: [{ weight: 400, isItalic: false, url: 'example/400.ttf' }],
};

afterEach(() => {
  configureFontCatalogue(undefined);
  vi.unstubAllGlobals();
});

it('loads the catalogue and its faces from the configured board assets service', async () => {
  const fetch = vi.fn(() => Promise.resolve(Response.json({ version: 1, entries: [entry] })));
  vi.stubGlobal('fetch', fetch);
  const connection = await openBoardConnection({
    address: {
      boardId: 'fonts',
      assetsUrl: 'https://assets.example/',
      relayUrl: undefined,
      tokenUrl: undefined,
      token: undefined,
    },
    guestSubject: () => 'guest',
    openCache: () => Promise.resolve(undefined),
    shouldSeedDemoBoard: false,
  });
  try {
    const entries = await fetchFontCatalogue();
    expect(fetch).toHaveBeenCalledWith('https://assets.example/assets/fonts/catalogue.json');
    expect(entries[0]?.faces[0]?.url).toBe('https://assets.example/assets/fonts/example/400.ttf');
  } finally {
    connection.destroy();
  }
});
