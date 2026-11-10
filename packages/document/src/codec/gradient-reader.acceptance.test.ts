import { describe, expect, it } from 'vitest';

import { fixtureGateBoard, mergeGroup, rawUpdate } from '../meta/__fixtures__/gate-boards.js';
import { RELAY, fixtureObject } from '../store/__fixtures__/store-fixtures.js';

describe('tolerant replay reader', () => {
  it.each([
    { type: 'linear', angle: 0, stops: [] },
    { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0, stops: [] },
    {
      type: 'linear',
      angle: NaN,
      stops: [
        { offset: 0, color: [1, 0, 0, 1] },
        { offset: 1, color: [0, 0, 1, 1] },
      ],
    },
  ])('keeps the object and its outline when a replayed fill is invalid: %j', (fill) => {
    const board = fixtureGateBoard();
    try {
      const update = rawUpdate(board, (objects) => {
        mergeGroup(objects, 'shape-box', 'style', { fill });
      });
      board.writer.applyUpdate(update, RELAY);
      const object = [...board.writer.read().objects.values()].find(
        (value) => value.id === 'shape-box',
      );
      const original = fixtureObject('shape-box', 'shape');
      expect(object).toMatchObject({
        type: 'shape',
        fill: null,
        stroke: original.stroke,
        label: original.label,
      });
    } finally {
      board.hub.destroy();
      board.writer.destroy();
    }
  });
});
