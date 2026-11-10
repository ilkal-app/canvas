// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { Point } from '@canvas/schema';

import { NO_IMAGES_MESSAGE, PageImages } from '../assets/page-images.js';
import { ImagePreparer } from '../assets/prepare-image.js';
import type { PasteTarget } from '../clipboard/paste-handlers.js';

import { MountImages, withPageImages } from './mount-images.js';

const CAMERA: Camera = {
  x: 100,
  y: 0,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};
const PNG = new File(['png'], 'a.png', { type: 'image/png' });

/**
 * A paste location recording what it was asked.
 *
 * @param hasImages - Whether the page has images.
 * @returns The location getter and the records.
 */
function location(hasImages: boolean) {
  const inserted: [readonly File[], Point][] = [];
  const notices: string[] = [];
  const target: PasteTarget = {
    pointer: undefined,
    viewCentre: { x: 1, y: 2 },
    createObjects: () => true,
    notify: (message) => notices.push(message),
    ...(hasImages
      ? {
          images: {
            insert: (files: readonly File[], at: Point) => inserted.push([files, at]),
            wasCopiedFrom: () => false,
            linkFrom: () => Promise.resolve(),
          },
        }
      : {}),
  };
  return { pasteTarget: () => target, inserted, notices };
}

/**
 * Chooses files in the picker the mount opened.
 *
 * @param files - The files.
 * @throws {Error} When no picker is open.
 */
function choose(files: File[]): void {
  const input = document.querySelector<HTMLInputElement>('input[data-image-picker]');
  if (input === null) throw new Error('No picker.');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change'));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('MountImages', () => {
  it('places picked images at the given point, else the view’s centre', async () => {
    const canvas = document.createElement('canvas');
    const { pasteTarget, inserted } = location(true);
    const images = new MountImages(canvas, pasteTarget, () => CAMERA);
    const atCentre = images.pick(undefined);
    choose([PNG]);
    await atCentre;
    const atPoint = images.pick({ x: 5, y: 6 });
    choose([PNG]);
    await atPoint;
    const cancelled = images.pick(undefined);
    choose([]);
    await cancelled;
    expect(inserted).toEqual([
      [[PNG], { x: 1, y: 2 }],
      [[PNG], { x: 5, y: 6 }],
    ]);
    images.destroy();
  });

  it('places dropped images at the drop’s world point', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const { pasteTarget, inserted } = location(true);
    const images = new MountImages(canvas, pasteTarget, () => CAMERA);
    const drop = new Event('drop', { cancelable: true });
    Object.defineProperties(drop, {
      dataTransfer: { value: { types: ['Files'], files: [PNG] } },
      clientX: { value: 200 },
      clientY: { value: 100 },
    });
    canvas.dispatchEvent(drop);
    expect(inserted).toEqual([[[PNG], { x: 200, y: 50 }]]);
    images.destroy();
  });

  it('says there are no images on a page without them', async () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    const { pasteTarget, notices } = location(false);
    const images = new MountImages(canvas, pasteTarget, () => CAMERA);
    await images.pick(undefined);
    const drop = new Event('drop', { cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [PNG] } });
    canvas.dispatchEvent(drop);
    expect(notices).toEqual([NO_IMAGES_MESSAGE, NO_IMAGES_MESSAGE]);
    images.destroy();
  });
});

describe('withPageImages', () => {
  it('adds the page’s board and images to the paste location', async () => {
    const { pasteTarget } = location(false);
    const page = new PageImages(undefined, {
      boardId: 'board-a',
      preparer: new ImagePreparer(() => undefined),
    });
    const target = withPageImages(pasteTarget(), page);
    expect(target.boardId).toBe('board-a');
    target.images?.insert([PNG], { x: 0, y: 0 });
    await expect(target.images?.linkFrom([], 'b')).rejects.toThrow(NO_IMAGES_MESSAGE);
    expect(withPageImages(pasteTarget(), undefined)).toBe(pasteTarget());
    const unknown = withPageImages(pasteTarget(), new PageImages(undefined));
    expect(unknown.boardId).toBeUndefined();
    // A pasted link's preview goes through the same service: none on this page.
    await expect(target.unfurlLink?.('https://example.com/')).rejects.toThrow(NO_IMAGES_MESSAGE);
  });
});
