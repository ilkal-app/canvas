import { describe, expect, it } from 'vitest';

import { applyLinkUnfurl, createLinkCard } from '../index.js';
import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

const KEY = 'paste-1';

describe("a link card's image sizes", () => {
  it('keeps each size with its asset, and drops one whose asset is missing', () => {
    const store = createFixtureStore();
    const id = createLinkCard(
      store,
      { url: 'https://example.com/story', x: 0, y: 0, unfurlKey: KEY },
      ADA,
    );
    const outcome = {
      status: 'ready' as const,
      title: 'Story',
      description: '',
      siteName: '',
      imageAssetId: 'asset-preview',
      imageSize: { width: 1200, height: 630 },
      faviconSize: { width: 32, height: 32 },
    };
    expect(applyLinkUnfurl(store, id, { unfurlKey: KEY, outcome }, ADA)).toBe(true);
    const card = store.get(id);
    expect(card).toMatchObject({ imageSize: { width: 1200, height: 630 } });
    expect(card?.type === 'link' ? card.faviconSize : 'not a card').toBeUndefined();
  });

  it('refuses a size that is not a whole positive number of pixels', () => {
    const store = createFixtureStore();
    const id = createLinkCard(
      store,
      { url: 'https://example.com/story', x: 0, y: 0, unfurlKey: KEY },
      ADA,
    );
    const outcome = {
      status: 'ready' as const,
      title: 'Story',
      description: '',
      siteName: '',
      imageAssetId: 'asset-preview',
      imageSize: { width: 0, height: 630 },
    };
    expect(() => applyLinkUnfurl(store, id, { unfurlKey: KEY, outcome }, ADA)).toThrow();
    expect(store.get(id)).toMatchObject({ status: 'pending' });
  });
});
