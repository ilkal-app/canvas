import { describe, expect, it, vi } from 'vitest';

import type { AssetId } from '@canvas/schema';

import {
  adapterPortLink,
  directLinks,
  isAdapterAssetMessage,
  isPageAssetMessage,
  pagePortLink,
  type AdapterAssetMessage,
  type PageAssetMessage,
} from './asset-channel.js';

const ASSET = 'a'.repeat(64) as AssetId;
const ACCESS = { assetsUrl: 'http://assets.test', boardId: 'b', token: 't' };

/**
 * Lets a port's messages arrive.
 *
 * @returns Settles after a macrotask.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('isPageAssetMessage', () => {
  it('takes access, local images and uploads, and nothing malformed', () => {
    expect(isPageAssetMessage({ type: 'access', access: ACCESS })).toBe(true);
    expect(isPageAssetMessage({ type: 'access', access: null })).toBe(true);
    expect(isPageAssetMessage({ type: 'uploaded', assetId: ASSET })).toBe(true);
    expect(isPageAssetMessage({ type: 'page-visibility', isHidden: true })).toBe(true);
    const image = {
      assetId: ASSET,
      mimeType: 'image/png',
      naturalSize: { width: 1, height: 2 },
      file: new Blob([]),
    };
    expect(isPageAssetMessage({ type: 'local-image', image })).toBe(true);
    for (const message of [
      null,
      { type: 'access', access: { ...ACCESS, token: 3 } },
      { type: 'uploaded' },
      { type: 'page-visibility', isHidden: 'yes' },
      { type: 'local-image', image: { ...image, file: 'bytes' } },
      { type: 'local-image', image: { ...image, naturalSize: { width: '1' } } },
      { type: 'local-image' },
      { type: 'other' },
    ]) {
      expect(isPageAssetMessage(message)).toBe(false);
    }
  });
});

describe('isAdapterAssetMessage', () => {
  it('takes access requests and statuses, and nothing malformed', () => {
    expect(isAdapterAssetMessage({ type: 'access-request' })).toBe(true);
    expect(isAdapterAssetMessage({ type: 'local-image-held', assetId: ASSET })).toBe(true);
    expect(isAdapterAssetMessage({ type: 'local-image-held' })).toBe(false);
    const status = { type: 'asset-status', assetId: ASSET, status: 'ready', progress: 1 };
    expect(isAdapterAssetMessage(status)).toBe(true);
    expect(isAdapterAssetMessage({ type: 'processing', assetIds: [ASSET] })).toBe(true);
    expect(isAdapterAssetMessage({ type: 'processing', assetIds: [] })).toBe(true);
    for (const message of [
      undefined,
      { type: 'processing' },
      { type: 'processing', assetIds: [1] },
      { ...status, status: 'gone' },
      { ...status, progress: '1' },
      { type: 'other' },
    ]) {
      expect(isAdapterAssetMessage(message)).toBe(false);
    }
  });
});

describe('port links', () => {
  it('carry each side’s messages over a MessageChannel, dropping malformed ones', async () => {
    const channel = new MessageChannel();
    const page = pagePortLink(channel.port1);
    const adapter = adapterPortLink(channel.port2);
    const toAdapter: PageAssetMessage[] = [];
    const toPage: AdapterAssetMessage[] = [];
    adapter.listen((message) => toAdapter.push(message));
    const stop = page.listen((message) => toPage.push(message));
    page.send({ type: 'access', access: ACCESS });
    channel.port1.postMessage({ type: 'nonsense' });
    adapter.send({ type: 'access-request' });
    // A port delivers in a later task, later still under load.
    await vi.waitFor(() => {
      expect(toAdapter).toEqual([{ type: 'access', access: ACCESS }]);
      expect(toPage).toEqual([{ type: 'access-request' }]);
    });
    stop();
    adapter.send({ type: 'access-request' });
    await settle();
    expect(toPage).toHaveLength(1);
    page.close();
    adapter.close();
  });
});

describe('directLinks', () => {
  it('deliver in a later microtask, and nothing once closed', async () => {
    const { page, adapter } = directLinks();
    const toAdapter: PageAssetMessage[] = [];
    const toPage: AdapterAssetMessage[] = [];
    const stopAdapter = adapter.listen((message) => toAdapter.push(message));
    const stopPage = page.listen((message) => toPage.push(message));
    page.send({ type: 'uploaded', assetId: ASSET });
    adapter.send({ type: 'access-request' });
    expect([toAdapter, toPage]).toEqual([[], []]);
    await settle();
    expect(toAdapter).toEqual([{ type: 'uploaded', assetId: ASSET }]);
    expect(toPage).toEqual([{ type: 'access-request' }]);
    stopAdapter();
    stopPage();
    page.send({ type: 'uploaded', assetId: ASSET });
    adapter.close();
    adapter.send({ type: 'access-request' });
    await settle();
    expect([toAdapter.length, toPage.length]).toEqual([1, 1]);
  });
});
