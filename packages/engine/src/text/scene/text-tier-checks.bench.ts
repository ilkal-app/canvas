import { bench, describe } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { TextTierChecks, type VisibleObjects } from './text-tier-checks.js';

// The text pass's tier checks when the visible set changes (fix round 1): after a zoom
// takes a font size across a tier edge every text is queued, and the off-screen ones stay queued
// until they come into view. On the 50k board that is about 18,000 texts off screen while a pan
// or the padded region's re-search changes the visible set by a few objects: the check must cost
// what enters the view, not what is queued.

const PENDING = 18_000;
const VISIBLE = 2_000;
const ENTERING = 10;

const ids = Array.from(
  { length: PENDING + VISIBLE },
  (unused, index) => `t${String(index)}` as ObjectId,
);

/**
 * A visible set of `VISIBLE` texts starting at an offset.
 *
 * @param offset - Where the set starts in `ids`.
 * @param entered - Where the texts that entered it start.
 * @returns The set as the tier checks read it, at revision 0.
 */
function visibleAt(offset: number, entered: number): VisibleObjects {
  const visibleIds = ids.slice(offset, offset + VISIBLE);
  const members = new Set(visibleIds);
  return {
    visibleRevision: 0,
    visibleIds,
    enteredIds: ids.slice(entered, entered + ENTERING),
    isVisible: (id) => members.has(id),
  };
}

describe(`TextTierChecks, ${String(PENDING)} texts queued off screen`, () => {
  const checks = new TextTierChecks();
  checks.noteFontSizes([16]);
  // 16-unit type at 7 and at 9 device px per unit: 112 and 144 px per em, across 128.
  checks.rescale(7, 9, ids);
  // A pan back and forth by ten texts: the queue keeps its 18,000 off-screen texts.
  const sets = [visibleAt(0, 0), visibleAt(ENTERING, VISIBLE)];
  let revision = 0;
  bench(`a visible set that changes by ${String(ENTERING)} objects`, () => {
    revision += 1;
    const next = sets[revision % 2];
    if (next !== undefined) checks.due({ ...next, visibleRevision: revision });
  });
});
