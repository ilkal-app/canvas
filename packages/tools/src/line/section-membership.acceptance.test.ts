// Item 9, written before the code. CONTRACT: a free line whose box centre is in a section joins it with local coordinates and unchanged world ends. Deliberately not asserted: line cap or snapping.
import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { lineToolContext } from './__fixtures__/line-tool-context.js';
import { LineMode } from './line-mode.js';

it('creates a line inside the existing frame in its coordinates', () => {
  const { store, context } = lineToolContext();
  const mode = new LineMode(context);
  for (const [kind, x, y] of [
    ['pointerDown', 500, 100],
    ['pointerMove', 600, 150],
    ['pointerUp', 600, 150],
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
  const line = store.get('new-1' as ObjectId);
  expect(line).toMatchObject({ type: 'line', parentId: 'frame-f', x: 100, y: 100 });
  // No page of its own: a child reads as `pageId: null` (page-rules), never a page.
  expect(line?.pageId ?? null).toBeNull();
});
