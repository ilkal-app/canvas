import { bench, describe } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { planSegmentDraws } from './segment-plan.js';

// A 50k loose-board ordering: document chunks group children by their old frame, while
// paint rank alternates across those groups. These cases compare slot layouts in one pass.
const COUNT = 50_000;
const documentOrder = [...Array(COUNT).keys()].map(
  (index) => `leaf-${String(index).padStart(5, '0')}` as ObjectId,
);
const paintOrder = [...documentOrder].sort((left, right) => {
  const a = Number(left.slice(5));
  const b = Number(right.slice(5));
  return (a % 10) - (b % 10) || a - b;
});
const ranks = new Map(paintOrder.map((id, rank) => [id, rank]));
function inputOf(order: readonly ObjectId[]) {
  const rankOfSlot = Int32Array.from(order, (id) => ranks.get(id) ?? -1);
  const recordOfSlot = new Int32Array(COUNT);
  return {
    passes: [{ name: 'text', owners: { rankOfSlot, recordOfSlot } }],
    isOccluderByRank: new Uint8Array(COUNT),
    visible: [{ passName: 'text', ranges: [{ start: 0, count: COUNT }] }],
  };
}
const fragmented = inputOf(documentOrder);
const compacted = inputOf(paintOrder);

describe('50k loose-board plan and draw-list ranges', () => {
  bench('fragmented document-order slots', () => {
    planSegmentDraws(fragmented);
  });
  bench('compacted paint-order slots', () => {
    planSegmentDraws(compacted);
  });
});
