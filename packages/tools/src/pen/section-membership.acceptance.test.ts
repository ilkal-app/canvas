// Item 9, written before the code. CONTRACT: a pen path joins the section containing its new box centre and keeps its vertices at their drawn world points. Deliberately not asserted: handle geometry or later editing.
import { expect, it } from 'vitest';

import { frame } from '../select/__fixtures__/select-board.js';

import { click, createPenModeContext, onlyPath } from './__fixtures__/pen-mode-context.js';
import { createPenMode } from './vector-modes.js';

it('stores a newly segmented path in section coordinates', () => {
  const { store, context } = createPenModeContext([
    frame('section', null, { x: 100, y: 100, width: 400, height: 400 }),
  ]);
  const mode = createPenMode(context, { kind: 'create' });
  click(mode, { x: 200, y: 200 });
  click(mode, { x: 260, y: 200 });
  expect(onlyPath(store)).toMatchObject({ parentId: 'section', x: 100, y: 100 });
  // No page of its own: a child reads as `pageId: null` (page-rules), never a page.
  expect(onlyPath(store).pageId ?? null).toBeNull();
  expect(onlyPath(store).vertices.map(({ x, y }) => [x, y])).toEqual([
    [0, 0],
    [60, 0],
  ]);
});
