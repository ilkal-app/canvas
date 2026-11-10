// Item 9, written before the code. CONTRACT: a drawn shape joins the topmost section containing its box centre and retains its world box. Deliberately not asserted: snapping or style.
import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { frame } from '../select/__fixtures__/select-board.js';
import { createTextModeContext } from '../text/__fixtures__/text-mode-context.js';

import { ShapeMode } from './shape-mode.js';

it('creates a shape in the topmost section at the same world box', () => {
  const lower = frame('lower', null, { x: 100, y: 100, width: 400, height: 400 });
  const upper = { ...frame('upper', null, { x: 150, y: 150, width: 300, height: 300 }), z: 'a1' };
  const { store, context } = createTextModeContext([lower, upper]);
  const mode = new ShapeMode(context, { kind: 'create' });
  for (const [kind, x, y] of [
    ['pointerDown', 200, 200],
    ['pointerMove', 260, 240],
    ['pointerUp', 260, 240],
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
  const shape = store.get('new-1' as ObjectId);
  expect(shape).toMatchObject({
    type: 'shape',
    parentId: 'upper',
    x: 50,
    y: 50,
    width: 60,
    height: 40,
  });
  // No page of its own: a child reads as `pageId: null` (page-rules), never a page.
  expect(shape?.pageId ?? null).toBeNull();
});
