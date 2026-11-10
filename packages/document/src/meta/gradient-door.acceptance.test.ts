// Independent raw-Yjs door acceptance: bypasses command/schema validation.
import { describe, expect, it } from 'vitest';

import { fixtureGateBoard, mergeGroup, rawUpdate } from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

const stops = [
  { offset: 0, color: [1, 0, 0, 1] },
  { offset: 1, color: [0, 0, 1, 1] },
];
const valid = { type: 'linear', angle: 0, stops };
const verdict = (fill: unknown) => {
  const board = fixtureGateBoard();
  const update = rawUpdate(board, (objects) => {
    mergeGroup(objects, 'shape-box', 'style', { fill });
  });
  return new UpdateStampCheck(board.hub).check(update);
};

describe('raw paint admission', () => {
  it('accepts a valid gradient without a hostile-value finding', () => {
    expect(verdict(valid)).toEqual({ kind: 'accepted' });
  });
  it.each([
    { ...valid, angle: Infinity },
    { ...valid, stops: [...stops].reverse() },
    {
      ...valid,
      stops: Array.from({ length: 9 }, (unused, i) => ({ offset: i / 8, color: [1, 0, 0, 1] })),
    },
    { ...valid, stops: [{ offset: 0, color: 'ink' }, stops[1]] },
    { ...valid, stops: [{ offset: 0, color: [NaN, 0, 0, 1] }, stops[1]] },
    { type: 'radial', center: { x: 2, y: 0 }, radius: 0, stops },
  ])('reports hostile raw paint %j', (paint) => {
    expect(verdict(paint)).toMatchObject({ hostileValue: { objectId: 'shape-box', key: 'style' } });
  });
});
