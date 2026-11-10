// The page's images over their life (fix round 1): refusals that arrive together share one
// token fetch, a dropped upload lets its bytes go in the adapter too, and destroying the page's
// images stops their uploads.
import { describe, expect, it } from 'vitest';

import type { AssetId } from '@canvas/schema';

import { FAKE_ASSETS_URL, fakeToken } from './__fixtures__/fake-assets-service.js';
import { settle } from './__fixtures__/manual-schedule.js';
import { BOARD, ofType, png, setUp } from './__fixtures__/page-images-setup.js';
import { directLinks, type PageAssetMessage } from './asset-channel.js';
import { PageImages } from './page-images.js';
import { ImagePreparer } from './prepare-image.js';

describe('PageImages over its life', () => {
  it('fetches one fresh token for refusals that arrive together', async () => {
    const { images, service, target, tokens } = setUp();
    service.failNext({ route: 'declare', status: 401, code: 'expired' });
    service.failNext({ route: 'declare', status: 401, code: 'expired' });
    await images.insert([png(1).file, png(2).file], { x: 0, y: 0 }, target);
    await settle();
    expect(tokens.filter((isFresh) => isFresh)).toHaveLength(1);
    expect(images.uploads.snapshot().map(({ state }) => state.phase)).toEqual([
      'processing',
      'processing',
    ]);
  });

  it('tells the adapter to let a dropped upload’s bytes go', async () => {
    const { images, target, toAdapter } = setUp();
    const { assetId } = png(3);
    await images.insert([png(3).file], { x: 0, y: 0 }, target);
    images.uploads.forget(assetId);
    await settle();
    expect(ofType(toAdapter, 'forget-local')).toEqual([{ type: 'forget-local', assetId }]);
  });

  it('shows no collaborator’s image processing once destroyed', async () => {
    const { images, adapter } = setUp();
    const asset = 'b'.repeat(64) as AssetId;
    let changes = 0;
    images.processing.subscribe(() => (changes += 1));
    adapter.send({ type: 'processing', assetIds: [asset] });
    await settle();
    expect(images.processing.snapshot()).toEqual([asset]);
    images.destroy();
    expect(images.processing.snapshot()).toEqual([]);
    expect(changes).toBe(2);
  });

  it('stops its running uploads when destroyed', async () => {
    const signals: AbortSignal[] = [];
    const images = new PageImages(
      {
        assetsUrl: FAKE_ASSETS_URL,
        boardId: BOARD,
        token: () => Promise.resolve(fakeToken(BOARD)),
        tokenFor: () => Promise.resolve(undefined),
      },
      {
        preparer: new ImagePreparer(
          () => undefined,
          () => Promise.resolve({ width: 10, height: 10 }),
        ),
        // A put that runs until it is stopped.
        put: (url, headers, body, onProgress, signal) =>
          new Promise((resolve, reject) => {
            if (signal !== undefined) signals.push(signal);
            signal?.addEventListener('abort', () => {
              reject(new Error('stopped'));
            });
          }),
        fetch: (input) =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                status: 'new',
                upload: { id: 'u', url: `${input}/put`, method: 'PUT', headers: {} },
              }),
              { status: 201 },
            ),
          ),
      },
    );
    const links = directLinks();
    const received: PageAssetMessage[] = [];
    links.adapter.listen((message) => {
      received.push(message);
      if (message.type === 'local-image') {
        links.adapter.send({ type: 'local-image-held', assetId: message.image.assetId });
      }
    });
    images.connect(links.page);
    await images.insert(
      [png(4).file],
      { x: 0, y: 0 },
      { createObjects: () => true, notify: () => undefined },
    );
    await images.insert(
      [png(5).file],
      { x: 0, y: 0 },
      {
        createObjects: (objects, onCreated) => {
          onCreated?.(objects.map((unused, index) => `o${String(index)}` as never));
          return true;
        },
        notify: () => undefined,
      },
    );
    await expect.poll(() => signals.length).toBe(1);
    images.destroy();
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    await settle();
    expect(images.uploads.snapshot()).toEqual([]);
    expect(ofType(received, 'local-image')).toHaveLength(2);
  });
});
