// @vitest-environment jsdom
// The copies a tab makes itself (fix round 2): a cut and paste on one board works
// whatever the storage does and however many images it holds, and a paste of more than 2,000
// images onto another board works in the tab that copied them, not after a reload.
import { describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import {
  createBoard,
  type AssetId,
  type Board,
  type BoardObject,
  type ObjectId,
} from '@canvas/schema';

import { FAKE_ASSETS_URL, fakeToken } from '../assets/__fixtures__/fake-assets-service.js';
import { CopiedAssets, type CopiedAssetsStorage } from '../assets/copied-assets.js';
import { CROSS_BOARD_TOO_MANY_MESSAGE } from '../assets/copy-ledger.js';
import { PageImages } from '../assets/page-images.js';
import { ImagePreparer } from '../assets/prepare-image.js';
import { clipboardBoard, objectOf } from '../clipboard/__fixtures__/clipboard-board.js';
import { createLinkedPaste } from '../clipboard/linked-paste.js';
import type { PasteTarget } from '../clipboard/paste-handlers.js';

import type { DocumentClipboard } from './document-clipboard.js';
import { EngineClipboard } from './engine-clipboard.js';
import { withPageImages } from './mount-images.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 200, dpr: 1 };

/** A storage that refuses everything, as with storage disabled or full. */
const BROKEN_STORAGE: CopiedAssetsStorage = {
  getItem: () => {
    throw new Error('storage is disabled');
  },
  setItem: () => {
    throw new Error('quota exceeded');
  },
};

/**
 * A board of many images of distinct assets.
 *
 * @param count - How many.
 * @returns The board.
 * @throws {Error} When the fixture's photo is not an image.
 */
function manyImages(count: number): Board {
  const photo = objectOf(clipboardBoard(), 'photo');
  if (photo.type !== 'image') throw new Error('the fixture’s photo is not an image');
  const images: BoardObject[] = [];
  for (let index = 0; index < count; index += 1) {
    images.push({
      ...photo,
      id: `many-${String(index)}` as ObjectId,
      assetId: `asset-${String(index)}` as AssetId,
    });
  }
  return createBoard(images);
}

/**
 * A tab's page images for a board, over a stored record on the given storage, asking the
 * service for nothing it cannot be asked (spies on the token lookup and the fetch).
 *
 * @param boardId - The board the tab shows.
 * @param storage - What the record is stored in.
 * @returns The images and the spies.
 */
function tab(boardId: string, storage: CopiedAssetsStorage) {
  const tokenFor = vi.fn((board: string) => Promise.resolve(fakeToken(board)));
  const fetch = vi.fn(() => Promise.reject(new Error('the service is not reachable in this test')));
  const images = new PageImages(
    {
      assetsUrl: FAKE_ASSETS_URL,
      boardId,
      token: () => Promise.resolve(fakeToken(boardId)),
      tokenFor,
    },
    {
      fetch,
      preparer: new ImagePreparer(() => undefined),
      copiedAssets: new CopiedAssets({ storage: () => storage }),
    },
  );
  return { images, tokenFor, fetch };
}

/**
 * The clipboard side of a tab that copies or cuts a board's images.
 *
 * @param images - The tab's page images.
 * @param copied - What the document copies.
 * @returns The clipboard.
 */
function clipboardOf(images: PageImages, copied: Board): EngineClipboard {
  const stub = {
    copySelection: () => copied,
    clipboardColors: () => ({}),
    prepareCut: () => ({ kind: 'ready', copied, remove: () => undefined }),
    pasteTarget: () => ({ pointer: undefined, viewCentre: { x: 0, y: 0 } }),
  };
  return new EngineClipboard(
    document.createElement('canvas'),
    stub as unknown as DocumentClipboard,
    () => CAMERA,
    images,
  );
}

/**
 * Pastes a board the way the clipboard names its source, on a board showing none of its images.
 *
 * @param pasted - The board.
 * @param images - The tab's page images.
 * @param sourceBoard - The source the clipboard claims.
 * @returns What was created and told.
 */
function paste(pasted: Board, images: PageImages, sourceBoard: string) {
  const notices: string[] = [];
  const created = vi.fn();
  const base: PasteTarget = {
    pointer: undefined,
    viewCentre: { x: 0, y: 0 },
    createObjects: () => true,
    notify: (message) => notices.push(message),
  };
  const target = { ...withPageImages(base, images), sourceBoard };
  const linked: (readonly AssetId[])[] = [];
  if (target.images !== undefined) {
    const original = target.images;
    target.images = {
      ...original,
      linkFrom: (assets) => {
        linked.push(assets);
        return Promise.resolve();
      },
    };
  }
  createLinkedPaste(pasted, [], target, created);
  return { notices, created, linked };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the copies a tab makes itself', () => {
  it('lets a cut and paste on one board work with the storage throwing', () => {
    const board = clipboardBoard();
    const { images } = tab('board-a', BROKEN_STORAGE);
    clipboardOf(images, board).prepareCut();
    const pasted = paste(board, images, 'board-a');
    expect(pasted.notices).toEqual([]);
    expect(pasted.created).toHaveBeenCalledOnce();
    images.destroy();
  });

  it('lets a cut and paste of more than 2,000 images work on the same board', () => {
    const board = manyImages(2_500);
    const { images } = tab('board-a', BROKEN_STORAGE);
    clipboardOf(images, board).prepareCut();
    const pasted = paste(board, images, 'board-a');
    expect(pasted.notices).toEqual([]);
    expect(pasted.created).toHaveBeenCalledOnce();
    images.destroy();
  });

  it('lets a paste of more than 2,000 images onto another board work in the same tab', async () => {
    const board = manyImages(2_500);
    const { images } = tab('board-b', BROKEN_STORAGE);
    // The tab copied them on board A, then shows board B: its record lives with the tab.
    images.copies.record(
      [...board.objects.values()].flatMap((object) =>
        object.type === 'image' ? [object.assetId] : [],
      ),
      'board-a',
    );
    const pasted = paste(board, images, 'board-a');
    await settle();
    expect(pasted.notices).toEqual([]);
    expect(pasted.linked).toHaveLength(1);
    expect(pasted.linked[0]).toHaveLength(2_500);
    expect(pasted.created).toHaveBeenCalledOnce();
    images.destroy();
  });

  it('refuses such a paste after a reload, with the notice, creating and asking for nothing', async () => {
    const board = manyImages(2_500);
    const items = new Map<string, string>();
    const storage: CopiedAssetsStorage = {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
    };
    const before = tab('board-a', storage);
    clipboardOf(before.images, board).copySelection();
    before.images.destroy();
    // A reload: a new tab's page images over the same storage; the 2,500 were not stored.
    const { images, tokenFor, fetch } = tab('board-b', storage);
    const pasted = paste(board, images, 'board-a');
    await settle();
    expect(pasted.notices).toEqual([CROSS_BOARD_TOO_MANY_MESSAGE]);
    expect(pasted.created).not.toHaveBeenCalled();
    expect(pasted.linked).toEqual([]);
    expect(tokenFor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    images.destroy();
  });

  it('gives a forged clipboard nothing from the tab’s memory', async () => {
    const board = clipboardBoard();
    const { images, tokenFor, fetch } = tab('board-b', BROKEN_STORAGE);
    clipboardOf(images, board).copySelection();
    const forged = paste(board, images, 'victim-board');
    await settle();
    expect(forged.created).not.toHaveBeenCalled();
    expect(forged.linked).toEqual([]);
    expect(tokenFor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    images.destroy();
  });
});
