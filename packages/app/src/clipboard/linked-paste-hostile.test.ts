// A hostile clipboard against the real page images: a page that writes another board
// into the clipboard's board flavour must not make this page fetch that board's token or ask
// the service to link anything, whichever handler asks. Over the fake assets service.
import { describe, expect, it, vi } from 'vitest';

import { createBoard } from '@canvas/schema';

import { FAKE_ASSETS_URL, fakeToken } from '../assets/__fixtures__/fake-assets-service.js';
import { BOARD, memoryCopies, png, setUp } from '../assets/__fixtures__/page-images-setup.js';
import { CROSS_BOARD_NOT_COPIED_MESSAGE, PageImages } from '../assets/page-images.js';
import { withPageImages } from '../engine/mount-images.js';

import { clipboardBoard, objectOf } from './__fixtures__/clipboard-board.js';
import { createLinkedPaste } from './linked-paste.js';
import { PasteHandlerRegistry, type PasteTarget } from './paste-handlers.js';

/** The board the attacker's page names as the source. */
const VICTIM = 'victim-board';

/**
 * A paste of one image into this page's board, over page images whose token lookup and fetch
 * are spied on, and the paste location the engine gives (`withPageImages`).
 *
 * @returns The pieces to paste and assert on.
 * @throws {Error} When the fixture's photo is not an image.
 */
function pasteSetUp() {
  const { service } = setUp();
  const { assetId } = png(5);
  service.seed(new Uint8Array([5, 1, 2, 3]), [VICTIM]);
  const tokenFor = vi.fn((board: string) => Promise.resolve(fakeToken(board)));
  const fetch = vi.fn(service.fetch);
  const copies = memoryCopies();
  const images = new PageImages(
    {
      assetsUrl: FAKE_ASSETS_URL,
      boardId: BOARD,
      token: () => Promise.resolve(fakeToken(BOARD)),
      tokenFor,
    },
    { fetch, wait: () => Promise.resolve(), copiedAssets: copies },
  );
  const photo = objectOf(clipboardBoard(), 'photo');
  if (photo.type !== 'image') throw new Error('the fixture’s photo is not an image');
  const pasted = createBoard([{ ...photo, assetId }]);
  const notices: string[] = [];
  const create = vi.fn();
  const base: PasteTarget = {
    pointer: undefined,
    viewCentre: { x: 0, y: 0 },
    createObjects: () => true,
    notify: (message) => notices.push(message),
  };
  const target: PasteTarget = { ...withPageImages(base, images), sourceBoard: VICTIM };
  return { service, assetId, tokenFor, fetch, pasted, notices, create, target, images, copies };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a paste whose clipboard names a board this browser never copied from', () => {
  it('fetches no token, sends no request, and creates no image', async () => {
    const { service, assetId, tokenFor, fetch, pasted, notices, create, target, images } =
      pasteSetUp();
    createLinkedPaste(pasted, [], target, create);
    await settle();
    expect(tokenFor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(service.requests).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(notices).toEqual([CROSS_BOARD_NOT_COPIED_MESSAGE]);
    expect(service.isLinked(assetId, BOARD)).toBe(false);
    images.destroy();
  });

  it('is linked and created when this browser did copy the image from that board', async () => {
    const { service, assetId, tokenFor, pasted, notices, create, target, images, copies } =
      pasteSetUp();
    copies.record([assetId], VICTIM);
    createLinkedPaste(pasted, [], target, create);
    await settle();
    expect(tokenFor).toHaveBeenCalledWith(VICTIM);
    expect(service.isLinked(assetId, BOARD)).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(notices).toEqual([]);
    images.destroy();
  });
});

describe('a paste handler that asks the page to link directly', () => {
  it('asks for no token even with an empty list, for a board of the clipboard’s choosing', async () => {
    const { service, tokenFor, fetch, target, images } = pasteSetUp();
    const registry = new PasteHandlerRegistry();
    registry.register('application/x-canvas-objects+json', (item, pasteTarget) => {
      void pasteTarget.images?.linkFrom([], pasteTarget.sourceBoard ?? '');
      return item.kind === 'string';
    });
    registry.dispatch(
      [{ kind: 'string', type: 'application/x-canvas-objects+json', data: '{}' }],
      target,
    );
    await settle();
    expect(tokenFor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(service.requests).toEqual([]);
    images.destroy();
  });

  it('cannot use the tab’s own copies for a board the tab never copied from', async () => {
    const { service, assetId, tokenFor, fetch, pasted, notices, create, target, images } =
      pasteSetUp();
    images.copies.record([assetId], 'board-mine');
    createLinkedPaste(pasted, [], target, create);
    await settle();
    expect(tokenFor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(service.requests).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    expect(notices).toEqual([CROSS_BOARD_NOT_COPIED_MESSAGE]);
    images.destroy();
  });

  it('causes no token fetch and no request for a pair this browser never copied', async () => {
    const { service, assetId, tokenFor, fetch, notices, target, images } = pasteSetUp();
    const registry = new PasteHandlerRegistry();
    const outcomes: string[] = [];
    // A later or third-party handler, which the clipboard's claim reaches like any other.
    registry.register('application/x-canvas-objects+json', (item, pasteTarget) => {
      const source = pasteTarget.sourceBoard ?? '';
      pasteTarget.images?.linkFrom([assetId], source).then(
        () => outcomes.push('linked'),
        (error: unknown) => outcomes.push(error instanceof Error ? error.message : 'failed'),
      );
      return item.kind === 'string';
    });
    registry.dispatch(
      [{ kind: 'string', type: 'application/x-canvas-objects+json', data: '{}' }],
      target,
    );
    await settle();
    expect(outcomes).toEqual([CROSS_BOARD_NOT_COPIED_MESSAGE]);
    expect(tokenFor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(service.requests).toEqual([]);
    expect(service.isLinked(assetId, BOARD)).toBe(false);
    expect(notices).toEqual([]);
    images.destroy();
  });
});
