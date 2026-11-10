import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../camera/camera.js';
import type { WorldTransform } from '../scene/world-transform.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { CandidateFinder } from './image-candidates.js';
import { ImageIndex } from './image-index.js';

/**
 * A 1000 × 1000 world viewport.
 *
 * @param x - Its left edge, world units.
 * @param y - Its top edge, world units.
 * @returns The viewport.
 */
function viewportAt(x: number, y = 0): WorldBounds {
  return { minX: x, minY: y, maxX: x + 1000, maxY: y + 1000 };
}

/**
 * An index of 100 × 100 images along y = 0.
 *
 * @param xs - Each image's left edge, world units.
 * @returns The index.
 */
function indexWith(xs: readonly number[]): ImageIndex {
  const index = new ImageIndex();
  xs.forEach((x, i) => {
    const object = imageObject({ id: `image-${String(i)}` as ObjectId, width: 100, height: 100 });
    const transform: WorldTransform = { cos: 1, sin: 0, x, y: 0 };
    index.track({ object, transform });
  });
  return index;
}

function priorities(
  candidates: ReturnType<CandidateFinder['find']>,
): Record<string, string | undefined> {
  return Object.fromEntries(candidates.map(({ image, priority }) => [image.object.id, priority]));
}

describe('CandidateFinder', () => {
  it('marks images on screen visible and those in the padded viewport near', () => {
    const index = indexWith([100, 1100, 5000]);

    const found = priorities(new CandidateFinder().find(index, viewportAt(0), 0));

    expect(found).toEqual({ 'image-0': 'visible', 'image-1': 'near' });
  });

  it('classifies nothing on a zoom that provably changes no priority', () => {
    const index = indexWith([100, 400, 1150]);
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);
    let reads = 0;
    for (const { image } of finder.current) {
      const { bounds } = image;
      Object.defineProperty(image, 'bounds', {
        get: () => {
          reads += 1;
          return bounds;
        },
      });
    }
    const revision = finder.priorityRevision;
    // Zooming out a little: the padded search is reused, and every image keeps its side.
    const zoomedOut = { minX: -20, minY: -20, maxX: 1020, maxY: 1020 };
    expect(priorities(finder.find(index, zoomedOut, 16))).toEqual({
      'image-0': 'visible',
      'image-1': 'visible',
      'image-2': 'near',
    });
    expect(reads).toBe(0);
    expect(finder.priorityRevision).toBe(revision);
    // Zooming out further brings the image at x = 1150 on screen: it is classified again.
    const wider = { minX: -200, minY: -200, maxX: 1200, maxY: 1200 };
    expect(priorities(finder.find(index, wider, 32))['image-2']).toBe('visible');
    expect(reads).toBeGreaterThan(0);
    expect(finder.priorityRevision).toBe(revision + 1);
  });

  it('adds images ahead of a pan as prefetch, once each', () => {
    const index = indexWith([500, 1800]);
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);

    // 250 world units in 100 ms: the lookahead reaches the image at x = 1800.
    const found = priorities(finder.find(index, viewportAt(250), 100));

    expect(found).toEqual({ 'image-0': 'visible', 'image-1': 'prefetch' });
  });

  it('reuses the padded search while the view stays inside it and the index is unchanged', () => {
    const index = indexWith([100, 1100]);
    const search = vi.spyOn(index, 'search');
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);
    finder.remember(viewportAt(0), 50);

    // A zoom in about the centre: the view shrinks inside the padded rectangle.
    const found = priorities(
      finder.find(index, { minX: 250, minY: 250, maxX: 750, maxY: 750 }, 100),
    );

    expect(search).toHaveBeenCalledTimes(1);
    expect(found).toEqual({ 'image-0': 'near', 'image-1': 'near' });
  });

  it('searches again once the index changes', () => {
    const index = indexWith([100]);
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);
    const object = imageObject({ id: 'late' as ObjectId, width: 100, height: 100 });
    index.track({ object, transform: { cos: 1, sin: 0, x: 400, y: 0 } });

    const found = priorities(finder.find(index, viewportAt(0), 0));

    expect(found).toEqual({ 'image-0': 'visible', late: 'visible' });
  });

  it('takes a pan inside the padded search without searching, updating priorities in place', () => {
    const index = indexWith([100, 1100]);
    const finder = new CandidateFinder();
    const first = finder.find(index, viewportAt(0), 0);
    const search = vi.spyOn(index, 'search');

    // A 200-unit pan right: the 1100 image comes on screen, still inside the padded search.
    const isTaken = finder.pan(index, viewportAt(200), 16);

    expect(isTaken).toBe(true);
    expect(finder.current).toBe(first);
    expect(priorities(finder.current)).toEqual({ 'image-0': 'visible', 'image-1': 'visible' });
    // Only the prefetch strip ahead of the pan was searched.
    expect(search.mock.calls.every(([region]) => region.minX >= 1250)).toBe(true);
  });

  it('leaves a pan to find when the view leaves the padded search or the index changes', () => {
    const index = indexWith([100]);
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);

    expect(finder.pan(index, viewportAt(600), 16)).toBe(false);
    const object = imageObject({ id: 'late' as ObjectId, width: 100, height: 100 });
    index.track({ object, transform: { cos: 1, sin: 0, x: 400, y: 0 } });
    expect(finder.pan(index, viewportAt(10), 32)).toBe(false);
  });

  it('leaves a pan to find when the images ahead of it change', () => {
    const index = indexWith([100, 1700]);
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);
    finder.find(index, viewportAt(1), 16);

    // Faster: the prefetch region now reaches the image at 1700.
    expect(finder.pan(index, viewportAt(40), 32)).toBe(false);
    const found = priorities(finder.find(index, viewportAt(40), 32));

    expect(found).toEqual({ 'image-0': 'visible', 'image-1': 'prefetch' });
  });

  it('takes a steady pan whose images ahead stay the same', () => {
    const index = indexWith([100, 1260]);
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);
    // 10 world units a frame: 250 in the lookahead, rounded up to a reach of 375.
    finder.find(index, viewportAt(10), 16);

    expect(priorities(finder.current)).toEqual({ 'image-0': 'visible', 'image-1': 'prefetch' });
    expect(finder.pan(index, viewportAt(20), 32)).toBe(true);
  });

  it('keeps the prefetch region, searching nothing, while the speed of a pan varies', () => {
    const index = indexWith([100, 1260, 2000]);
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);
    finder.find(index, viewportAt(10), 16);
    const search = vi.spyOn(index, 'search');

    // 6, then 14 world units a frame: lookaheads of 150 and 350 keep the reach of 375.
    expect(finder.pan(index, viewportAt(16), 32)).toBe(true);
    expect(finder.pan(index, viewportAt(30), 48)).toBe(true);
    expect(search).not.toHaveBeenCalled();
    // 40 a frame: a lookahead of 1000 moves the region to 1500 ahead, which reaches x = 2000.
    expect(finder.pan(index, viewportAt(70), 64)).toBe(false);
    expect(priorities(finder.find(index, viewportAt(70), 64))).toEqual({
      'image-0': 'visible',
      'image-1': 'prefetch',
      'image-2': 'prefetch',
    });
  });

  it('prefetches nothing for a pan slower than the shortest reach', () => {
    const index = indexWith([100, 1260]);
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);

    // 1 world unit a frame: a lookahead of 25, short of 1500 / 16.
    expect(priorities(finder.find(index, viewportAt(1), 16))).toEqual({ 'image-0': 'visible' });
  });

  it('takes an image across both strips of a diagonal pan once', () => {
    const index = new ImageIndex();
    const object = imageObject({ id: 'corner' as ObjectId, width: 100, height: 100 });
    // Right of the padded search (it ends at 1250) and below it, across the corner.
    index.track({ object, transform: { cos: 1, sin: 0, x: 1200, y: 1300 } });
    const finder = new CandidateFinder();
    finder.find(index, viewportAt(0), 0);

    const found = finder.find(index, viewportAt(10, 10), 16);

    expect(found.map(({ image, priority }) => `${image.object.id} ${priority}`)).toEqual([
      'corner prefetch',
    ]);
  });
});
