import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldBounds } from '../../camera/camera.js';
import { intersectsBounds } from '../../spatial/bounds.js';

import { checkMovedObjects, type SegmentSpatialIndex } from './segment-moves.js';
import type { SegmentPlan } from './segment-plan.js';

/**
 * A plan of four objects by rank: a note with text (passes 0 and 1) alone in split 0, a note
 * with text beside it in split 1 merged into the same segment, a note without text in split 2,
 * and a hidden object (mask 0).
 */
const PLAN: SegmentPlan = {
  entries: [],
  passMaskByRank: Int32Array.of(0b11, 0b11, 0b01, 0),
  segmentOfRank: Int32Array.of(0, 0, 0, 0),
  splitOfRank: Int32Array.of(0, 1, 2, 0),
  segmentCount: 1,
  hasSpatialMerges: true,
  pageSpans: [],
};

const RANKS = new Map(['a', 'b', 'c', 'hidden'].map((id, rank) => [id as ObjectId, rank]));

/**
 * A spatial index over boxes by id.
 *
 * @param boxes - Each object's box.
 * @returns The index.
 */
function indexOf(boxes: Record<string, WorldBounds | undefined>): SegmentSpatialIndex {
  return {
    boundsOf: (id) => boxes[id],
    searchRect: (rect) =>
      Object.entries(boxes).flatMap(([id, box]) =>
        box !== undefined && intersectsBounds(box, rect) ? [id as ObjectId] : [],
      ),
  };
}

/**
 * A 10-unit box at a point.
 *
 * @param x - Its left.
 * @returns The box.
 */
function at(x: number): WorldBounds {
  return { minX: x, minY: 0, maxX: x + 10, maxY: 10 };
}

const check = (moved: string[], boxes: Record<string, WorldBounds | undefined>, limit = 10) =>
  checkMovedObjects(PLAN, moved as ObjectId[], (id) => RANKS.get(id), indexOf(boxes), limit);

describe('checkMovedObjects', () => {
  it('keeps a plan while moved objects meet nothing that draws later than them', () => {
    expect(check(['b'], { a: at(0), b: at(100), c: at(200) })).toBe('kept');
    expect(check(['a'], { a: at(0), b: at(100), c: at(200) })).toBe('kept');
  });

  it('breaks a plan where a moved object lands on an earlier split’s later pass, or under a later one', () => {
    expect(check(['b'], { a: at(0), b: at(5), c: at(200) })).toBe('broken');
    // A note without text on an earlier note's text: the union would draw that text over it.
    expect(check(['c'], { a: at(0), b: at(100), c: at(5) })).toBe('broken');
    expect(check(['a'], { a: at(95), b: at(100), c: at(200) })).toBe('broken');
  });

  it('skips objects the plan did not draw, and ids it never saw', () => {
    expect(check(['hidden', 'gone'], { a: at(0), hidden: at(0) })).toBe('kept');
    expect(check(['a'], { a: at(0), hidden: at(0) })).toBe('kept');
  });

  it('breaks a plan when a moved object has no box, and gives up past the limit', () => {
    expect(check(['b'], { a: at(0), b: undefined })).toBe('broken');
    expect(check(['a', 'b'], { a: at(0), b: at(100) }, 1)).toBe('tooMany');
  });

  it('keeps a plan when a moved object is clipped away entirely, since it draws nothing', () => {
    const index = {
      ...indexOf({ a: at(0), b: undefined }),
      isClippedAway: (id: ObjectId) => id === 'b',
    };
    expect(checkMovedObjects(PLAN, ['b' as ObjectId], (id) => RANKS.get(id), index, 10)).toBe(
      'kept',
    );
  });

  it('breaks a plan where a moved image lands on an earlier one on a higher page', () => {
    // Two images in one pass (bit 0), each an occluder in its own split of one segment: the
    // later on page 0, the earlier on page 2, kept together only while apart.
    const images: SegmentPlan = {
      entries: [],
      passMaskByRank: Int32Array.of(0b1, 0b1),
      segmentOfRank: Int32Array.of(0, 0),
      splitOfRank: Int32Array.of(0, 1),
      segmentCount: 1,
      hasSpatialMerges: true,
      pageSpans: [
        {
          passIndex: 0,
          isPaintOrdered: true,
          minPageByRank: Int32Array.of(2, 0),
          maxPageByRank: Int32Array.of(2, 0),
        },
      ],
    };
    const checkImages = (boxes: Record<string, WorldBounds>) =>
      checkMovedObjects(images, ['b' as ObjectId], (id) => RANKS.get(id), indexOf(boxes), 10);
    expect(checkImages({ a: at(0), b: at(100) })).toBe('kept');
    expect(checkImages({ a: at(0), b: at(5) })).toBe('broken');
    // The same for a paged pass drawn page by page without keeping paint order (text): two
    // splits merged by boxes break when a later text on a lower page moves onto an earlier one.
    const [span] = images.pageSpans;
    if (span === undefined) throw new Error('the plan has a page span');
    const texts = { ...images, pageSpans: [{ ...span, isPaintOrdered: false }] };
    const checkTexts = (boxes: Record<string, WorldBounds>) =>
      checkMovedObjects(texts, ['b' as ObjectId], (id) => RANKS.get(id), indexOf(boxes), 10);
    expect(checkTexts({ a: at(0), b: at(100) })).toBe('kept');
    expect(checkTexts({ a: at(0), b: at(5) })).toBe('broken');
  });
});

describe('checkMovedObjects with closing ranks', () => {
  // A frame at rank 0 (pass 0 only, split 0) whose closing rank 2 (its outline, pass 1) was
  // merged by boxes into the segment of a note at rank 1 (passes 0 and 1, split 1).
  const plan: SegmentPlan = {
    entries: [],
    passMaskByRank: Int32Array.of(0b01, 0b11, 0b10),
    segmentOfRank: Int32Array.of(0, 0, 0),
    splitOfRank: Int32Array.of(0, 1, 2),
    segmentCount: 1,
    hasSpatialMerges: true,
    pageSpans: [],
  };
  const ranks = new Map([
    ['frame' as ObjectId, 0],
    ['note' as ObjectId, 1],
  ]);
  const closing = new Map([['frame' as ObjectId, 2]]);
  const checkClosing = (moved: string[], boxes: Record<string, WorldBounds | undefined>) =>
    checkMovedObjects(
      plan,
      moved as ObjectId[],
      (id) => ranks.get(id),
      indexOf(boxes),
      10,
      (id) => closing.get(id),
    );

  it('checks a moved object’s closing rank against what it meets', () => {
    // The outline (pass 1) is a later split than the note (passes 0 and 1): kept.
    expect(checkClosing(['frame'], { frame: at(0), note: at(100) })).toBe('kept');
    expect(checkClosing(['note'], { frame: at(0), note: at(5) })).toBe('kept');
  });

  it('breaks the plan where only a met object’s closing rank is reordered by the merge', () => {
    // The note (pass 0) in a later split than the outline (pass 1): merged, the note would draw
    // under the outline. The frame's own rank (pass 0, split 0) alone would keep the plan.
    const reordered: SegmentPlan = {
      ...plan,
      passMaskByRank: Int32Array.of(0b01, 0b01, 0b10),
      splitOfRank: Int32Array.of(0, 2, 1),
    };
    const verdict = (closingRankOf?: (id: ObjectId) => number | undefined) =>
      checkMovedObjects(
        reordered,
        ['note' as ObjectId],
        (id) => ranks.get(id),
        indexOf({ frame: at(0), note: at(5) }),
        10,
        closingRankOf,
      );
    expect(verdict()).toBe('kept');
    expect(verdict((id) => closing.get(id))).toBe('broken');
  });
});
