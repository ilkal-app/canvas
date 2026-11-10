// Once the board's session ended, the page's images
// make no request and write nothing: uploads stop, the adapter's polls pause and its requests for
// access go unanswered, and an insert or a link begun before (or after) creates nothing.
import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import {
  FAKE_ASSETS_URL,
  FakeAssetsService,
  fakeToken,
} from './__fixtures__/fake-assets-service.js';
import { settle } from './__fixtures__/manual-schedule.js';
import { BOARD, memoryCopies, ofType, png, setUp } from './__fixtures__/page-images-setup.js';
import { directLinks, type PageAssetMessage } from './asset-channel.js';
import { NO_IMAGES_MESSAGE, PageImages } from './page-images.js';

/**
 * A promise and its resolve, for a token a test answers late.
 *
 * @returns Both.
 */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Page images over the fake service whose tokens (this board's and another's) answer when the
 * test says.
 *
 * @returns The images, the service, the adapter's end and inbox, and the late answers.
 */
function lateTokens() {
  const service = new FakeAssetsService();
  const boardToken = deferred<string>();
  const sourceToken = deferred<string | undefined>();
  const copies = memoryCopies();
  const images = new PageImages(
    {
      assetsUrl: FAKE_ASSETS_URL,
      boardId: BOARD,
      token: () => boardToken.promise,
      tokenFor: () => sourceToken.promise,
    },
    { fetch: service.fetch, wait: () => Promise.resolve(), copiedAssets: copies },
  );
  const { page, adapter } = directLinks();
  images.connect(page);
  const toAdapter: PageAssetMessage[] = [];
  adapter.listen((message) => toAdapter.push(message));
  return { images, service, adapter, toAdapter, boardToken, sourceToken, copies };
}

describe('PageImages.endSession', () => {
  it('pauses the polls and answers no request for access, asking for no token', async () => {
    const { images, adapter, toAdapter, tokens } = setUp();
    images.endSession();
    await settle();
    expect(ofType(toAdapter, 'page-visibility').at(-1)).toEqual({
      type: 'page-visibility',
      isHidden: true,
    });
    adapter.send({ type: 'access-request' });
    await settle();
    expect(ofType(toAdapter, 'access')).toEqual([]);
    expect(tokens).toEqual([]);
  });

  it('shows no collaborator’s image processing once ended, a late report included', async () => {
    const { images, adapter } = setUp();
    const asset = 'b'.repeat(64) as AssetId;
    adapter.send({ type: 'processing', assetIds: [asset] });
    await settle();
    expect(images.processing.snapshot()).toEqual([asset]);
    images.endSession();
    expect(images.processing.snapshot()).toEqual([]);
    adapter.send({ type: 'processing', assetIds: [asset] });
    await settle();
    expect(images.processing.snapshot()).toEqual([]);
  });

  it('creates and uploads nothing for an insert begun before the session ended', async () => {
    const { images, service, toAdapter, created, target } = setUp();
    const image = png(1);
    const inserting = images.insert([image.file], { x: 0, y: 0 }, target);
    images.endSession();
    await inserting;
    await settle();
    expect(created).toEqual([]);
    expect(images.uploads.snapshot()).toEqual([]);
    expect(service.isLinked(image.assetId, BOARD)).toBe(false);
    expect(ofType(toAdapter, 'uploaded')).toEqual([]);
  });

  it('stops an upload under way, and takes no insert or link after', async () => {
    const { images, toAdapter, created, target } = setUp();
    const image = png(2);
    await images.insert([image.file], { x: 0, y: 0 }, target);
    expect(created).toHaveLength(1);
    images.endSession();
    await settle();
    expect(images.uploads.snapshot()).toEqual([]);
    expect(ofType(toAdapter, 'uploaded')).toEqual([]);
    await images.insert([png(3).file], { x: 0, y: 0 }, target);
    expect(created).toHaveLength(1);
    await expect(images.linkFrom([image.assetId], 'other-board')).rejects.toThrow(
      NO_IMAGES_MESSAGE,
    );
  });

  it('tells the adapter the session ended, so it makes no request', async () => {
    const { images, toAdapter } = setUp();
    images.endSession();
    await settle();
    expect(ofType(toAdapter, 'session-ended')).toEqual([{ type: 'session-ended' }]);
  });

  it('makes no link for a paste whose source token arrives after the session ended', async () => {
    const { images, service, sourceToken, boardToken, copies } = lateTokens();
    const { assetId } = png(5);
    service.seed(new Uint8Array([5, 1, 2, 3]), ['board-b']);
    copies.record([assetId], 'board-b');
    boardToken.resolve(fakeToken(BOARD));
    const linking = images.linkFrom([assetId], 'board-b');
    images.endSession();
    sourceToken.resolve(fakeToken('board-b'));
    await expect(linking).rejects.toThrow(NO_IMAGES_MESSAGE);
    expect(service.requests).toEqual([]);
    expect(service.isLinked(assetId, BOARD)).toBe(false);
  });

  it('hands the adapter no token that arrives after the session ended', async () => {
    const { images, adapter, toAdapter, boardToken } = lateTokens();
    adapter.send({ type: 'access-request' });
    await settle();
    images.endSession();
    boardToken.resolve(fakeToken(BOARD));
    await settle();
    expect(ofType(toAdapter, 'access')).toEqual([]);
  });
});
