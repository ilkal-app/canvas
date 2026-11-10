import { bench, describe } from 'vitest';

import { createBoard } from '../board/board.js';
import { createSeededIdGenerator } from '../ids/seeded-id-generator.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import type { BoardObject } from '../objects/board-object.js';

import { benchSize } from './__fixtures__/bench-size.js';
import { cascadeDelete } from './cascade-delete.js';
import { validateBoard } from './validate-board.js';

// A 50k-object board (the budget size for frame rate): 500 frames of 99 shapes, plus
// connectors between neighbouring shapes, so parents and connector targets are all exercised.
// CI's smoke run (`BENCH_SMOKE=1`) builds 20 frames, 2k objects.
const FRAME_COUNT = benchSize({ full: 500, smoke: 20 });
const nextId = createSeededIdGenerator(50_000);
const objects: BoardObject[] = [];
for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
  const frame = sampleObject('frame', nextId());
  objects.push(frame);
  let previous = sampleObject('shape', nextId(), { parentId: frame.id });
  objects.push(previous);
  for (let shapeIndex = 1; shapeIndex < 50; shapeIndex += 1) {
    const shape = sampleObject('shape', nextId(), { parentId: frame.id });
    const connector = sampleObject('connector', nextId(), {
      from: { kind: 'object', objectId: previous.id, anchor: null },
      to: { kind: 'object', objectId: shape.id, anchor: null },
    });
    objects.push(shape, connector);
    previous = shape;
  }
}
const board = createBoard(objects);
const firstFrame = objects[0];

describe(`board rules on a ${String(objects.length)}-object board`, () => {
  bench('validateBoard', () => {
    validateBoard(board);
  });

  bench('cascadeDelete of one frame with 49 connected shapes', () => {
    if (firstFrame !== undefined) cascadeDelete(board, [firstFrame.id]);
  });
});
