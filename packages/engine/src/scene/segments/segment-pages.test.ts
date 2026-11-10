import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '../../camera/camera.js';
import type { DrawListEntry } from '../draw-list.js';

import { planSegmentDraws, planSegments, type PlannedPass } from './segment-plan.js';

/**
 * One slot per object, record 0, ranks in slot order.
 *
 * @param count - How many objects.
 * @returns The owners.
 */
function oneSlotEach(count: number): PlannedPass['owners'] {
  return {
    rankOfSlot: Int32Array.from({ length: count }, (unused, index) => index),
    recordOfSlot: new Int32Array(count),
  };
}

function images(pages: readonly number[], isPaintOrderedAcrossPages: boolean): PlannedPass {
  return {
    name: 'image',
    owners: oneSlotEach(pages.length),
    pageOfSlot: Int32Array.from(pages),
    isPaintOrderedAcrossPages,
  };
}

function plan(pass: PlannedPass, occluders: readonly number[] = []): DrawListEntry[] {
  return planSegments({
    passes: [pass],
    isOccluderByRank: Uint8Array.from(pass.owners.rankOfSlot, (rank) =>
      occluders.includes(rank) ? 1 : 0,
    ),
    visible: [
      { passName: pass.name, ranges: [{ start: 0, count: pass.owners.rankOfSlot.length }] },
    ],
  });
}

function sequence(entries: readonly DrawListEntry[]): string[] {
  return entries.map(
    ({ page, ranges }) =>
      `page ${String(page)}: ${ranges.map(({ start, count }) => `${String(start)}+${String(count)}`).join(' ')}`,
  );
}

describe('planSegments for a pass that keeps paint order across pages', () => {
  it('starts a segment at an object on a lower page than one before it', () => {
    // Four images, paint order 0..3, on pages 3, 1, 1, 2: image 1 must draw after image 0.
    expect(sequence(plan(images([3, 1, 1, 2], true), [0, 1, 2, 3]))).toEqual([
      'page 3: 0+1',
      'page 1: 1+2',
      'page 2: 3+1',
    ]);
  });

  it('keeps objects in one segment while their pages do not go down', () => {
    expect(sequence(plan(images([1, 1, 2, 5], true), [0, 1, 2, 3]))).toEqual([
      'page 1: 0+2',
      'page 2: 2+1',
      'page 5: 3+1',
    ]);
  });

  it('breaks for non-occluders too: a translucent image stays above the one below it', () => {
    expect(sequence(plan(images([2, 1], true)))).toEqual(['page 2: 0+1', 'page 1: 1+1']);
  });

  it('leaves a pass that does not ask drawing page by page in one segment', () => {
    expect(sequence(plan(images([3, 1, 1, 2], false), [0, 1, 2, 3]))).toEqual([
      'page 1: 1+2',
      'page 2: 3+1',
      'page 3: 0+1',
    ]);
  });
});

describe('planSegments for images on pages, given their boxes', () => {
  /**
   * Images in a row, 10 units wide, `gap` apart.
   *
   * @param gap - The space between neighbours; negative overlaps them.
   * @returns Each rank's box.
   */
  const row =
    (gap: number) =>
    (rank: number): WorldBounds => ({
      minX: rank * (10 + gap),
      minY: 0,
      maxX: rank * (10 + gap) + 10,
      maxY: 10,
    });
  const planWith = (pass: PlannedPass, boundsOfRank: (rank: number) => WorldBounds | undefined) =>
    planSegmentDraws({
      passes: [pass],
      isOccluderByRank: Uint8Array.from(pass.owners.rankOfSlot, () => 1),
      visible: [
        { passName: pass.name, ranges: [{ start: 0, count: pass.owners.rankOfSlot.length }] },
      ],
      boundsOfRank,
    });

  it('keeps images on falling pages in one segment when they do not overlap', () => {
    const plan = planWith(images([3, 1, 2, 0], true), row(5));
    expect(plan.segmentCount).toBe(1);
    expect(plan.hasSpatialMerges).toBe(true);
    expect(sequence(plan.entries)).toEqual([
      'page 0: 3+1',
      'page 1: 1+1',
      'page 2: 2+1',
      'page 3: 0+1',
    ]);
  });

  it('starts a segment where an image overlaps one on a higher page before it', () => {
    // Image 1 overlaps image 0 (page 3): a segment of its own; image 2 overlaps only image 1.
    const plan = planWith(images([3, 1, 2, 0], true), row(-5));
    expect(sequence(plan.entries)).toEqual([
      'page 3: 0+1',
      'page 1: 1+1',
      'page 2: 2+1',
      'page 0: 3+1',
    ]);
  });

  it('treats an image without a box as overlapping everything', () => {
    const plan = planWith(images([3, 1], true), (rank) => (rank === 1 ? undefined : row(5)(rank)));
    expect(plan.segmentCount).toBe(2);
  });
});
