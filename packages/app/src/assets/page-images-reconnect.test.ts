import { describe, expect, it } from 'vitest';

import { settle } from './__fixtures__/manual-schedule.js';
import { ofType, png, setUp } from './__fixtures__/page-images-setup.js';
import { directLinks, type PageAssetMessage } from './asset-channel.js';

describe('PageImages, a new engine mid-upload', () => {
  it('tells a new link of its uploads under way, so the new engine reports them ready', async () => {
    const { images, target } = setUp();
    const image = png(1);
    await images.insert([image.file], { x: 0, y: 0 }, target);
    await settle();
    expect(images.uploads.snapshot().map(({ state }) => state.phase)).toEqual(['processing']);
    // The engine is mounted again (a remount of the canvas): the page links to its new adapter.
    const next = directLinks();
    const received: PageAssetMessage[] = [];
    next.adapter.listen((message) => received.push(message));
    images.connect(next.page);
    await settle();
    expect(
      ofType(received, 'local-image').map((message) =>
        message.type === 'local-image' ? message.image.assetId : undefined,
      ),
    ).toEqual([image.assetId]);
    expect(ofType(received, 'uploaded')).toEqual([{ type: 'uploaded', assetId: image.assetId }]);
    next.adapter.send({
      type: 'asset-status',
      assetId: image.assetId,
      status: 'ready',
      progress: 1,
    });
    await settle();
    expect(images.uploads.snapshot()).toEqual([]);
  });

  it('gives a new link a failed upload’s bytes but no upload to follow', async () => {
    const { images, service, target } = setUp();
    const image = png(2);
    service.failNext({ route: 'declare', status: 400, code: 'invalid' });
    await images.insert([image.file], { x: 0, y: 0 }, target);
    await settle();
    expect(images.uploads.snapshot().map(({ state }) => state.phase)).toEqual(['failed']);
    const next = directLinks();
    const received: PageAssetMessage[] = [];
    next.adapter.listen((message) => received.push(message));
    images.connect(next.page);
    await settle();
    // The new engine draws it from its bytes, with its Retry, as the old one did.
    expect(ofType(received, 'local-image')).toHaveLength(1);
    expect(ofType(received, 'uploaded')).toEqual([]);
  });

  it('gives the images back to the engine before once the newer one is released', async () => {
    const { images, target, adapter, toAdapter } = setUp();
    const first = png(3);
    await images.insert([first.file], { x: 0, y: 0 }, target);
    await settle();
    // A History preview's engine borrows them while the live engine stays mounted.
    const preview = directLinks();
    const release = images.connect(preview.page);
    await settle();
    const before = toAdapter.length;
    release();
    await settle();
    const caughtUp = toAdapter.slice(before);
    expect(ofType(caughtUp, 'uploaded')).toEqual([{ type: 'uploaded', assetId: first.assetId }]);
    expect(ofType(caughtUp, 'local-image')).toHaveLength(1);
    expect(ofType(caughtUp, 'page-visibility')).toHaveLength(1);
    expect(ofType(caughtUp, 'access')).toHaveLength(1);
    adapter.send({ type: 'asset-status', assetId: first.assetId, status: 'ready', progress: 1 });
    await settle();
    expect(images.uploads.snapshot()).toEqual([]);
    // A later upload is the live engine's too.
    const second = png(4);
    await images.insert([second.file], { x: 0, y: 0 }, target);
    await settle();
    expect(ofType(toAdapter, 'uploaded')).toContainEqual({
      type: 'uploaded',
      assetId: second.assetId,
    });
  });

  it('tells a restored engine the session ended while it was parked', async () => {
    const { images, toAdapter } = setUp();
    const release = images.connect(directLinks().page);
    images.endSession();
    release();
    await settle();
    expect(ofType(toAdapter, 'session-ended')).toHaveLength(1);
    expect(ofType(toAdapter, 'access')).toEqual([]);
  });
});
