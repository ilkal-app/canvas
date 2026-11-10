// Independent raw-Yjs acceptance for the ink token.
import { describe, expect, it } from 'vitest';

import { fixtureGateBoard, mergeGroup, rawUpdate } from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

const verdict = (color: unknown) => {
  const board = fixtureGateBoard();
  const update = rawUpdate(board, (objects) => {
    mergeGroup(objects, 'shape-box', 'style', { stroke: { color, width: 2 } });
  });
  return new UpdateStampCheck(board.hub).check(update);
};

describe('raw ink admission', () => {
  it('accepts the exact ink token', () => {
    expect(verdict('ink')).toEqual({ kind: 'accepted' });
  });
  it.each(['Ink', 'INK', 'white', { type: 'ink' }])('reports a hostile colour %j', (color) => {
    expect(verdict(color)).toMatchObject({ hostileValue: { objectId: 'shape-box', key: 'style' } });
  });
});
