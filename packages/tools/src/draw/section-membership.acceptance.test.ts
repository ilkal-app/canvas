// Written before the code. CONTRACT: a stroke over a section keeps its preview id and is stored in section coordinates.
import { expect, it } from 'vitest';

import { frame } from '../select/__fixtures__/select-board.js';

import { drawToolContext, strokesIn } from './__fixtures__/draw-tool-context.js';
import { DrawMode } from './draw-mode.js';

it('stores a stroke over a section as its child with the preview id', () => {
  const { store, context, record } = drawToolContext(undefined, [
    frame('section', null, { x: 100, y: 100, width: 400, height: 400 }),
  ]);
  const mode = new DrawMode(context);
  for (const [kind, x, y] of [
    ['pointerDown', 200, 200],
    ['pointerMove', 220, 220],
    ['pointerUp', 220, 220],
  ] as const) {
    mode.onPointer({
      kind,
      screen: { x, y },
      world: { x, y },
      zoom: 1,
      isShiftPressed: false,
      isModPressed: false,
    });
  }
  const [stroke] = strokesIn(store);
  expect(strokesIn(store)).toHaveLength(1);
  expect(stroke).toMatchObject({ parentId: 'section', pageId: null, x: 100, y: 100 });
  expect(stroke?.id).toBe([...record.previews.keys()][0]);
});
