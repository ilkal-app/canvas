import { describe, expect, it } from 'vitest';

import type { ObjectId, Point } from '@canvas/schema';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectController } from './select-controller.js';
import { createSelectHitTester } from './select-hit-tester.js';
import type { SelectInput, SelectPointerType } from './select-input.js';

// A lone selected line is edited by its end handles (fix round 1): its frame is the
// axis-aligned box of its ends, so for a diagonal line two of the frame's corners are empty
// board, and a press there must draw a marquee, not turn the line through an invisible band.

const LINE = id('line-l');
/** Just outside the top-right corner of line-l's frame, (0, 500)–(100, 550): empty board. */
const OUTSIDE_EMPTY_CORNER = { x: 106, y: 494 };

/**
 * A select tool over the select board with line-l selected.
 *
 * @param hasLineEndHandles - Whether lines are edited by their end handles.
 * @returns The tool, the store and a pointer driver.
 */
function withLineSelected(hasLineEndHandles: boolean) {
  const store = createSelectStore();
  const index = indexOf(selectBoardObjects());
  store.subscribe((changes) => {
    index.apply({ ...changes, get: (key: ObjectId) => store.get(key) });
  });
  const controller = new SelectController({
    store,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(index, storeSource(store)),
    hasLineEndHandles,
  });
  controller.select([LINE]);
  const at = (
    kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
    point: Point,
    pointerType?: SelectPointerType,
  ) => {
    const input: SelectInput = {
      kind,
      screen: point,
      world: point,
      isShiftPressed: false,
      isModPressed: false,
      ...(pointerType === undefined ? {} : { pointerType }),
    };
    controller.handle(input, 1);
  };
  return { store, controller, at };
}

describe('SelectController: a lone line with end handles', () => {
  it('draws a marquee from outside an empty corner of its frame, and turns nothing', () => {
    const { store, controller, at } = withLineSelected(true);
    const before = store.encodeState();
    at('pointerMove', OUTSIDE_EMPTY_CORNER);
    expect(controller.cursor).toBe('default');
    at('pointerDown', OUTSIDE_EMPTY_CORNER);
    at('pointerMove', { x: 300, y: 700 });
    expect(controller.overlay().marquee).toEqual({ minX: 106, minY: 494, maxX: 300, maxY: 700 });
    at('pointerUp', { x: 300, y: 700 });
    expect(store.encodeState()).toEqual(before);
  });

  it('offers no rotation band to a finger either', () => {
    const { store, controller, at } = withLineSelected(true);
    const before = store.encodeState();
    at('pointerDown', { x: 135, y: 465 }, 'touch');
    at('pointerMove', { x: 300, y: 700 }, 'touch');
    at('pointerUp', { x: 300, y: 700 }, 'touch');
    expect(store.encodeState()).toEqual(before);
    // Empty board under the finger: it pans the view, keeping the line selected.
    expect(controller.selection.ids).toEqual([LINE]);
  });

  it('keeps the frame’s controls without end handles: the same presses turn the line', () => {
    const plain = withLineSelected(false);
    plain.at('pointerMove', OUTSIDE_EMPTY_CORNER);
    expect(plain.controller.cursor).not.toBe('default');
    const before = plain.store.encodeState();
    plain.at('pointerDown', OUTSIDE_EMPTY_CORNER);
    plain.at('pointerMove', { x: 300, y: 700 });
    plain.at('pointerUp', { x: 300, y: 700 });
    expect(plain.store.encodeState()).not.toEqual(before);
    const touch = withLineSelected(false);
    const untouched = touch.store.encodeState();
    touch.at('pointerDown', { x: 135, y: 465 }, 'touch');
    touch.at('pointerMove', { x: 300, y: 700 }, 'touch');
    touch.at('pointerUp', { x: 300, y: 700 }, 'touch');
    expect(touch.store.encodeState()).not.toEqual(untouched);
  });

  it('keeps the frame’s controls for a selection of more than the line', () => {
    const { controller, at } = withLineSelected(true);
    controller.select([LINE, id('rect-a')]);
    const frame = controller.frame();
    if (!frame) throw new Error('no frame');
    at('pointerMove', { x: frame.x + frame.width + 6, y: frame.y - 6 });
    expect(controller.cursor).not.toBe('default');
  });
});
