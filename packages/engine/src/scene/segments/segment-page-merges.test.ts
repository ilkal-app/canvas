import { describe, expect, it } from 'vitest';

import type { WorldBounds } from '../../camera/camera.js';

import { SegmentPageMerges } from './segment-page-merges.js';
import type { PassPageSpans } from './segment-pages.js';

const at = (x: number): WorldBounds => ({ minX: x, minY: 0, maxX: x + 10, maxY: 10 });

/**
 * Text spans for three ranks: 0 on page 2, 1 on page 1, 2 draws no text.
 *
 * @param isPaintOrdered - Whether the pass keeps paint order across pages.
 * @returns The spans.
 */
function textSpans(isPaintOrdered: boolean): PassPageSpans[] {
  return [
    {
      passIndex: 4,
      isPaintOrdered,
      minPageByRank: Int32Array.of(2, 1, 2 ** 31 - 1),
      maxPageByRank: Int32Array.of(2, 1, -1),
    },
  ];
}

describe('SegmentPageMerges', () => {
  it('refuses a merge where text of the split meets text of the segment on a higher page', () => {
    const boxes = [at(0), at(5), at(100)];
    const merges = new SegmentPageMerges(textSpans(false), {
      boxOf: (rank) => boxes[rank],
      extent: { minX: 0, minY: 0, maxX: 110, maxY: 10 },
      count: 3,
    });
    // Nothing in the segment yet: nothing to refuse.
    expect(merges.verdictOf(Int32Array.of(1))).toBe('none');
    merges.closeSplit(Int32Array.of(0), true);
    // Rank 1's text, page 1, meets rank 0's on page 2: drawn page by page it would go under.
    expect(merges.verdictOf(Int32Array.of(1))).toBe('conflict');
    // Rank 2 draws no text: the merge does not rest on text at all.
    expect(merges.verdictOf(Int32Array.of(2))).toBe('none');
    boxes[1] = at(50);
    expect(merges.verdictOf(Int32Array.of(1))).toBe('apart');
    // A new segment forgets the old one's text.
    boxes[1] = at(5);
    merges.closeSplit(Int32Array.of(2), true);
    expect(merges.verdictOf(Int32Array.of(1))).toBe('none');
  });

  it('leaves passes that keep paint order across pages to the page order', () => {
    const merges = new SegmentPageMerges(textSpans(true), {
      boxOf: at,
      extent: { minX: 0, minY: 0, maxX: 110, maxY: 10 },
      count: 3,
    });
    merges.closeSplit(Int32Array.of(0), true);
    expect(merges.verdictOf(Int32Array.of(1))).toBe('none');
  });
});
