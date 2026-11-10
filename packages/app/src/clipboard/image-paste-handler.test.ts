import { describe, expect, it } from 'vitest';

import type { Point } from '@canvas/schema';

import { NO_IMAGES_MESSAGE } from '../assets/page-images.js';

import { createImagePasteHandler } from './image-paste-handler.js';
import type { PasteImages, PasteItem, PasteTarget } from './paste-handlers.js';

/**
 * A paste target that records what the handler asked of it.
 *
 * @param pointer - The pointer on the board, if on the canvas.
 * @param hasImages - Whether the page has images.
 * @returns The target, the inserted files and the notices.
 */
function recordingTarget(pointer: Point | undefined, hasImages = true) {
  const inserted: { files: readonly File[]; at: Point }[] = [];
  const notices: string[] = [];
  const images: PasteImages = {
    insert: (files, at) => inserted.push({ files, at }),
    wasCopiedFrom: () => false,
    linkFrom: () => Promise.resolve(),
  };
  const target: PasteTarget = {
    pointer,
    viewCentre: { x: -100, y: -100 },
    notify: (message) => notices.push(message),
    createObjects: () => true,
    ...(hasImages ? { images } : {}),
  };
  return { target, inserted, notices };
}

const FILE = new File(['png'], 'pasted.png', { type: 'image/png' });
const FILE_ITEM: PasteItem = { kind: 'file', type: 'image/png', file: FILE };

describe('createImagePasteHandler', () => {
  it('takes an image file at once and inserts it at the pointer, else the view’s centre', () => {
    const handler = createImagePasteHandler();
    const atPointer = recordingTarget({ x: 10, y: 20 });
    expect(handler(FILE_ITEM, atPointer.target)).toBe(true);
    expect(atPointer.inserted).toEqual([{ files: [FILE], at: { x: 10, y: 20 } }]);
    const offCanvas = recordingTarget(undefined);
    handler(FILE_ITEM, offCanvas.target);
    expect(offCanvas.inserted[0]?.at).toEqual({ x: -100, y: -100 });
  });

  it('leaves string flavours to other handlers', () => {
    const { target } = recordingTarget(undefined);
    expect(
      createImagePasteHandler()({ kind: 'string', type: 'text/plain', data: 'x' }, target),
    ).toBe(false);
  });

  it('says why nothing was placed on a page without images', () => {
    const { target, notices } = recordingTarget(undefined, false);
    expect(createImagePasteHandler()(FILE_ITEM, target)).toBe(true);
    expect(notices).toEqual([NO_IMAGES_MESSAGE]);
  });
});
