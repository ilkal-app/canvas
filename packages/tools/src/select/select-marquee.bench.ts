import { bench, describe } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { indexOf, mapSource, rect } from './__fixtures__/select-board.js';
import { beginDrag, dragIntent } from './select-drag.js';
import { createSelectHitTester } from './select-hit-tester.js';
import { EMPTY_SELECTION } from './selection-state.js';

const OBJECTS: BoardObject[] = [];
for (let row = 0; row < 100; row += 1) {
  for (let column = 0; column < 100; column += 1) {
    OBJECTS.push(
      rect(`r-${String(row)}-${String(column)}`, null, {
        x: column * 12,
        y: row * 12,
        width: 10,
        height: 10,
      }),
    );
  }
}
const HITS = createSelectHitTester(indexOf(OBJECTS), mapSource(OBJECTS));
const CONTEXT = {
  zoom: 1,
  selection: EMPTY_SELECTION,
  frame: undefined,
  canResize: false,
  isLocked: false,
  hitTester: HITS,
};

describe('marquee drag over 10k objects', () => {
  bench('100 moves growing a populated rectangle by 2px each move', () => {
    const drag = beginDrag({ kind: 'empty', onClick: undefined }, false, [], null);
    for (let move = 0; move < 100; move += 1) {
      const world = { x: 500 + move * 2, y: 900 };
      dragIntent(
        drag,
        { x: -20, y: -20 },
        { world, screen: world, isShiftPressed: false, isModPressed: false },
        CONTEXT,
      );
    }
  });
});
