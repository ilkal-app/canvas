import { describe, expect, it } from 'vitest';

import type { NewObject } from '@canvas/document';
import { createBoard, type AssetId, type BoardObject, type ObjectId } from '@canvas/schema';

import { CopiedAssets, type CopiedAssetsStorage } from '../assets/copied-assets.js';
import { CopyLedger, CROSS_BOARD_TOO_MANY_MESSAGE } from '../assets/copy-ledger.js';
import {
  CROSS_BOARD_NOT_COPIED_MESSAGE,
  CROSS_BOARD_REFUSED_MESSAGE,
  CROSS_BOARD_UNAVAILABLE_MESSAGE,
} from '../assets/page-images.js';

import { clipboardBoard, objectOf } from './__fixtures__/clipboard-board.js';
import { encodeClipboardFlavours } from './clipboard-flavours.js';
import { CANVAS_BOARD_MIME_TYPE, HTML_MIME_TYPE } from './clipboard-formats.js';
import { createLinkedPaste, imageAssetsOf, sourceBoardOf } from './linked-paste.js';
import type { PasteImages, PasteItem, PasteTarget } from './paste-handlers.js';

const BOARD = clipboardBoard();
const OBJECTS: NewObject[] = [];

/**
 * A record of this browser's copies, over a storage of its own, holding the given copies.
 *
 * @param copies - The boards the test's image was copied from.
 * @returns The record.
 */
function copiedFrom(...copies: string[]): CopiedAssets {
  const items = new Map<string, string>();
  const storage: CopiedAssetsStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  const record = new CopiedAssets({ storage: () => storage });
  for (const board of copies) record.record(imageAssetsOf(BOARD), board);
  return record;
}

/**
 * A paste target recording what it created, linked and was told.
 *
 * @param fields - The target's board, source board, record of copies and whether it has images,
 *   and how links go.
 * @param fields.boardId - The target board.
 * @param fields.sourceBoard - The board the clipboard claims the copy came from.
 * @param fields.hasImages - Whether the page has images.
 * @param fields.link - How a link answers.
 * @param fields.copies - What this browser copied; nothing if absent.
 * @param fields.hasImageOf - Whether the board's document already shows the test's image.
 * @returns The target and the records.
 */
function target(fields: {
  boardId?: string;
  sourceBoard?: string;
  hasImages?: boolean;
  link?: () => Promise<void>;
  copies?: Pick<CopiedAssets, 'wasCopiedFrom'>;
  hasImageOf?: boolean;
}) {
  const links: [readonly AssetId[], string][] = [];
  const notices: string[] = [];
  const shownCalls: number[] = [];
  const recordCalls: number[] = [];
  let created = 0;
  const copies = fields.copies ?? copiedFrom();
  const images: PasteImages = {
    insert: () => undefined,
    wasCopiedFrom: (assets, board) => {
      recordCalls.push(assets.length);
      return copies.wasCopiedFrom(assets, board);
    },
    linkFrom: (assets, source) => {
      links.push([assets, source]);
      return (fields.link ?? (() => Promise.resolve()))();
    },
  };
  const pasteTarget: PasteTarget = {
    pointer: undefined,
    viewCentre: { x: 0, y: 0 },
    createObjects: () => true,
    notify: (message) => notices.push(message),
    ...(fields.boardId === undefined ? {} : { boardId: fields.boardId }),
    ...(fields.sourceBoard === undefined ? {} : { sourceBoard: fields.sourceBoard }),
    ...(fields.hasImages === false ? {} : { images }),
    ...(fields.hasImageOf === undefined
      ? {}
      : {
          shownImagesAmong: (assetIds) => {
            shownCalls.push(assetIds.length);
            return new Set(fields.hasImageOf === true ? assetIds : []);
          },
        }),
  };
  const create = () => {
    created += 1;
  };
  return { pasteTarget, create, links, notices, shownCalls, recordCalls, created: () => created };
}

/**
 * A second image of another asset, which no copy of the test names.
 *
 * @returns The image.
 * @throws {Error} When the fixture's photo is not an image.
 */
function otherImage(): BoardObject {
  const photo = objectOf(BOARD, 'photo');
  if (photo.type !== 'image') throw new Error('the fixture’s photo is not an image');
  return { ...photo, id: 'other' as ObjectId, assetId: 'asset-other' as AssetId };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('imageAssetsOf', () => {
  it('lists each image’s asset once', () => {
    const assets = imageAssetsOf(BOARD);
    expect(assets).toHaveLength(1);
    expect(imageAssetsOf(createBoard([]))).toEqual([]);
  });
});

describe('sourceBoardOf', () => {
  const read = (html: string, attribute: string) =>
    new RegExp(`${attribute}="([^"]*)"`).exec(html)?.[1];

  it('reads the board flavour, else the attribute on the canvas’s HTML', () => {
    const flavours = encodeClipboardFlavours(BOARD, 'board-a');
    const items = [...flavours].map(([type, data]): PasteItem => ({ kind: 'string', type, data }));
    expect(sourceBoardOf(items, read)).toBe('board-a');
    const htmlOnly = items.filter(({ type }) => type !== CANVAS_BOARD_MIME_TYPE);
    expect(sourceBoardOf(htmlOnly, read)).toBe('board-a');
    expect(sourceBoardOf([], read)).toBeUndefined();
    const blank: PasteItem = { kind: 'string', type: CANVAS_BOARD_MIME_TYPE, data: ' ' };
    const html: PasteItem = { kind: 'string', type: HTML_MIME_TYPE, data: '<p>x</p>' };
    expect(sourceBoardOf([blank, html], read)).toBeUndefined();
  });

  it('is written only when the copy knows its board', () => {
    expect(encodeClipboardFlavours(BOARD).has(CANVAS_BOARD_MIME_TYPE)).toBe(false);
  });
});

/**
 * A pasted board of many images of distinct assets.
 *
 * @param count - How many.
 * @returns The board.
 * @throws {Error} When the fixture's photo is not an image.
 */
function manyImages(count: number) {
  const photo = objectOf(BOARD, 'photo');
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

describe('createLinkedPaste', () => {
  it('creates at once without images, or on a page that knows no board', () => {
    const unknownBoard = target({});
    createLinkedPaste(BOARD, OBJECTS, unknownBoard.pasteTarget, unknownBoard.create);
    const plain = target({ boardId: 'a', sourceBoard: 'b' });
    createLinkedPaste(createBoard([]), OBJECTS, plain.pasteTarget, plain.create);
    expect([unknownBoard.created(), plain.created(), plain.links]).toEqual([1, 1, []]);
  });

  it('links the images from another board before creating anything', async () => {
    const { pasteTarget, create, links, created } = target({
      boardId: 'a',
      sourceBoard: 'b',
      copies: copiedFrom('b'),
    });
    createLinkedPaste(BOARD, OBJECTS, pasteTarget, create);
    expect(created()).toBe(0);
    await settle();
    expect(links).toEqual([[imageAssetsOf(BOARD), 'b']]);
    expect(created()).toBe(1);
  });

  it('creates nothing and says why when the link is refused or cannot be asked', async () => {
    const copies = copiedFrom('b');
    const refused = target({
      boardId: 'a',
      sourceBoard: 'b',
      copies,
      link: () => Promise.reject(new Error(CROSS_BOARD_REFUSED_MESSAGE)),
    });
    createLinkedPaste(BOARD, OBJECTS, refused.pasteTarget, refused.create);
    await settle();
    expect([refused.created(), refused.notices]).toEqual([0, [CROSS_BOARD_REFUSED_MESSAGE]]);
    const odd = target({
      boardId: 'a',
      sourceBoard: 'b',
      copies,
      link: () => Promise.reject(new Error()),
    });
    createLinkedPaste(BOARD, OBJECTS, odd.pasteTarget, odd.create);
    await settle();
    expect(odd.notices).toEqual([CROSS_BOARD_UNAVAILABLE_MESSAGE]);
    for (const fields of [{ boardId: 'a' }, { boardId: 'a', sourceBoard: 'b', hasImages: false }]) {
      const unavailable = target({ ...fields, copies });
      createLinkedPaste(BOARD, OBJECTS, unavailable.pasteTarget, unavailable.create);
      expect([unavailable.created(), unavailable.notices]).toEqual([
        0,
        [CROSS_BOARD_UNAVAILABLE_MESSAGE],
      ]);
    }
  });

  it('asks for nothing when the clipboard names a board this browser never copied from', async () => {
    const forged = target({ boardId: 'a', sourceBoard: 'victim-board' });
    createLinkedPaste(BOARD, OBJECTS, forged.pasteTarget, forged.create);
    await settle();
    expect(forged.links).toEqual([]);
    expect(forged.created()).toBe(0);
    expect(forged.notices).toEqual([CROSS_BOARD_NOT_COPIED_MESSAGE]);
  });

  it('asks for nothing when the copy was from another board than the clipboard claims', async () => {
    const forged = target({
      boardId: 'a',
      sourceBoard: 'victim-board',
      copies: copiedFrom('board-mine'),
    });
    createLinkedPaste(BOARD, OBJECTS, forged.pasteTarget, forged.create);
    await settle();
    expect([forged.links, forged.created(), forged.notices]).toEqual([
      [],
      0,
      [CROSS_BOARD_NOT_COPIED_MESSAGE],
    ]);
  });

  it('refuses the whole paste when one of its images was never copied', async () => {
    const two = createBoard([...BOARD.objects.values(), otherImage()]);
    const partial = target({ boardId: 'a', sourceBoard: 'b', copies: copiedFrom('b') });
    createLinkedPaste(two, OBJECTS, partial.pasteTarget, partial.create);
    await settle();
    expect([partial.links, partial.created(), partial.notices]).toEqual([
      [],
      0,
      [CROSS_BOARD_NOT_COPIED_MESSAGE],
    ]);
  });

  it('refuses a cross-board paste of images when the browser has no storage', async () => {
    const record = new CopiedAssets({ storage: () => undefined });
    record.record(imageAssetsOf(BOARD), 'b');
    const none = target({ boardId: 'a', sourceBoard: 'b', copies: record });
    createLinkedPaste(BOARD, OBJECTS, none.pasteTarget, none.create);
    await settle();
    expect([none.links, none.created(), none.notices]).toEqual([
      [],
      0,
      [CROSS_BOARD_NOT_COPIED_MESSAGE],
    ]);
  });

  it('uses one sentence for a copy to be made again and another for a link the service refused', () => {
    expect(CROSS_BOARD_NOT_COPIED_MESSAGE).not.toBe(CROSS_BOARD_REFUSED_MESSAGE);
    for (const message of [CROSS_BOARD_NOT_COPIED_MESSAGE, CROSS_BOARD_REFUSED_MESSAGE]) {
      expect(message).not.toMatch(/board-|https?:|[0-9a-f]{16}/);
    }
  });

  it('pastes within a board what the record holds for it, also after the original was deleted', () => {
    const honest = target({ boardId: 'a', sourceBoard: 'a', copies: copiedFrom('a') });
    createLinkedPaste(BOARD, OBJECTS, honest.pasteTarget, honest.create);
    expect([honest.created(), honest.links, honest.notices]).toEqual([1, [], []]);
  });

  it('pastes within a board what its document already shows, whatever the record holds', () => {
    const shown = target({ boardId: 'a', sourceBoard: 'a', hasImageOf: true });
    createLinkedPaste(BOARD, OBJECTS, shown.pasteTarget, shown.create);
    expect([shown.created(), shown.links, shown.notices]).toEqual([1, [], []]);
  });

  it('refuses a clipboard that claims this board for an image the board does not hold', () => {
    for (const fields of [
      { copies: copiedFrom('other-board') },
      { copies: copiedFrom(), hasImageOf: false },
      { copies: copiedFrom(), hasImages: false },
    ]) {
      const forged = target({ boardId: 'a', sourceBoard: 'a', ...fields });
      createLinkedPaste(BOARD, OBJECTS, forged.pasteTarget, forged.create);
      expect([forged.created(), forged.links, forged.notices]).toEqual([
        0,
        [],
        [CROSS_BOARD_NOT_COPIED_MESSAGE],
      ]);
    }
  });

  it('refuses a same-board paste when only some of its images are held', () => {
    const two = createBoard([...BOARD.objects.values(), otherImage()]);
    const partial = target({ boardId: 'a', sourceBoard: 'a', copies: copiedFrom('a') });
    createLinkedPaste(two, OBJECTS, partial.pasteTarget, partial.create);
    expect([partial.created(), partial.notices]).toEqual([0, [CROSS_BOARD_NOT_COPIED_MESSAGE]]);
  });

  it('pastes a board without images whatever the record holds', () => {
    const plain = target({ boardId: 'a', sourceBoard: 'victim-board' });
    createLinkedPaste(createBoard([]), OBJECTS, plain.pasteTarget, plain.create);
    expect([plain.created(), plain.links]).toEqual([1, []]);
  });

  it('asks the board and the record once for a same-board paste, whatever its size', () => {
    const board = manyImages(500);
    const held = target({ boardId: 'a', sourceBoard: 'a', hasImageOf: true });
    createLinkedPaste(board, OBJECTS, held.pasteTarget, held.create);
    expect([held.created(), held.shownCalls, held.recordCalls]).toEqual([1, [500], []]);
    const notShown = target({ boardId: 'a', sourceBoard: 'a', hasImageOf: false });
    createLinkedPaste(board, OBJECTS, notShown.pasteTarget, notShown.create);
    expect([notShown.created(), notShown.shownCalls, notShown.recordCalls]).toEqual([
      0,
      [500],
      [500],
    ]);
  });

  it('asks the record only about the images the board does not show', () => {
    const board = createBoard([...BOARD.objects.values(), otherImage()]);
    const partial = target({ boardId: 'a', sourceBoard: 'a', copies: copiedFrom('a') });
    partial.pasteTarget.shownImagesAmong = (ids) =>
      new Set(ids.filter((id) => id === ('asset-other' as AssetId)));
    createLinkedPaste(board, OBJECTS, partial.pasteTarget, partial.create);
    expect([partial.created(), partial.recordCalls]).toEqual([1, [1]]);
  });

  it('says at most 2,000 images can go to another board at once, when a larger paste is unrecorded', async () => {
    const forged = target({ boardId: 'a', sourceBoard: 'b' });
    createLinkedPaste(manyImages(2_001), OBJECTS, forged.pasteTarget, forged.create);
    await settle();
    expect([forged.links, forged.created(), forged.notices]).toEqual([
      [],
      0,
      [CROSS_BOARD_TOO_MANY_MESSAGE],
    ]);
    const atLimit = target({ boardId: 'a', sourceBoard: 'b' });
    createLinkedPaste(manyImages(2_000), OBJECTS, atLimit.pasteTarget, atLimit.create);
    expect(atLimit.notices).toEqual([CROSS_BOARD_NOT_COPIED_MESSAGE]);
    expect(CROSS_BOARD_TOO_MANY_MESSAGE).toContain('2,000');
    expect(CROSS_BOARD_TOO_MANY_MESSAGE).not.toMatch(/board-|https?:|[0-9a-f]{16}/);
  });

  it('links a recorded paste of more than 2,000 images, and does not call it too many', async () => {
    const board = manyImages(2_500);
    const ledger = new CopyLedger(copiedFrom());
    ledger.record(imageAssetsOf(board), 'b');
    const held = target({ boardId: 'a', sourceBoard: 'b', copies: ledger });
    createLinkedPaste(board, OBJECTS, held.pasteTarget, held.create);
    await settle();
    expect([held.created(), held.notices]).toEqual([1, []]);
  });

  it('refuses a same-board paste of more than 2,000 unheld images with the copy-again notice', () => {
    const forged = target({ boardId: 'a', sourceBoard: 'a', hasImageOf: false });
    createLinkedPaste(manyImages(2_500), OBJECTS, forged.pasteTarget, forged.create);
    expect([forged.created(), forged.notices]).toEqual([0, [CROSS_BOARD_NOT_COPIED_MESSAGE]]);
  });
});
