import { describe, expect, it } from 'vitest';

import { createHistory } from '../history/undo-manager.js';
import { applyLinkUnfurl, createLinkCard, setLinkLayout } from '../index.js';
import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

const URL = 'https://example.com/story';
const KEY = 'paste-1';

describe('link card document commands', () => {
  it('creates a pending card at the paste point in one undo step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const id = createLinkCard(store, { url: URL, x: 17, y: 29, unfurlKey: KEY }, ADA);
    expect(store.get(id)).toMatchObject({
      type: 'link',
      url: URL,
      x: 17,
      y: 29,
      title: '',
      description: '',
      siteName: '',
      layout: 'vertical',
      status: 'pending',
      unfurlKey: KEY,
    });
    expect(history.undo()).toBe(true);
    expect(store.get(id)).toBeUndefined();
    expect(history.undo()).toBe(false);
  });

  it('applies only the matching pending result, clips fields, and lets paste undo remove the card', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const id = createLinkCard(
      store,
      { url: URL, x: 0, y: 0, layout: 'horizontal', unfurlKey: KEY },
      ADA,
    );
    const ready = {
      status: 'ready' as const,
      title: '  ' + '😀'.repeat(301),
      description: '  Summary  ',
      siteName: ' Site ',
      imageAssetId: 'asset-preview',
      faviconAssetId: 'asset-icon',
    };
    expect(applyLinkUnfurl(store, id, { unfurlKey: 'stale', outcome: ready }, ADA)).toBe(false);
    expect(store.get(id)).toMatchObject({ status: 'pending', title: '' });
    expect(applyLinkUnfurl(store, id, { unfurlKey: KEY, outcome: ready }, ADA)).toBe(true);
    expect(store.get(id)).toMatchObject({
      status: 'ready',
      layout: 'horizontal',
      title: '😀'.repeat(300),
      description: 'Summary',
      siteName: 'Site',
      imageAssetId: 'asset-preview',
      faviconAssetId: 'asset-icon',
    });
    expect(applyLinkUnfurl(store, id, { unfurlKey: KEY, outcome: { status: 'failed' } }, ADA)).toBe(
      false,
    );
    expect(history.undo()).toBe(true);
    expect(store.get(id)).toBeUndefined();
  });

  it('marks failure and changes layout for selected cards', () => {
    const store = createFixtureStore();
    const id = createLinkCard(store, { url: URL, x: 0, y: 0, unfurlKey: KEY }, ADA);
    expect(applyLinkUnfurl(store, id, { unfurlKey: KEY, outcome: { status: 'failed' } }, ADA)).toBe(
      true,
    );
    expect(store.get(id)).toMatchObject({ status: 'failed' });
    setLinkLayout(store, [id], 'horizontal', ADA);
    expect(store.get(id)).toMatchObject({ layout: 'horizontal', status: 'failed' });
  });
});
