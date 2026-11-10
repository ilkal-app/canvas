// Item 9, written before the code. CONTRACT: text created over a section joins it while its world position stays at the click. Deliberately not asserted: font metrics beyond the existing fixture.
import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { frame } from '../select/__fixtures__/select-board.js';

import { createTextModeContext } from './__fixtures__/text-mode-context.js';
import { TextMode } from './text-mode.js';

it('creates text in section coordinates at the clicked world point', () => {
  const { store, context } = createTextModeContext([
    frame('section', null, { x: 100, y: 100, width: 400, height: 400 }),
  ]);
  const mode = new TextMode(context, { kind: 'create' });
  for (const kind of ['pointerDown', 'pointerUp'] as const) {
    mode.onPointer({
      kind,
      screen: { x: 250, y: 250 },
      world: { x: 250, y: 250 },
      zoom: 1,
      isShiftPressed: false,
      isModPressed: false,
    });
  }
  mode.session?.type('X');
  const text = store.get('new-1' as ObjectId);
  expect(text).toMatchObject({ type: 'text', parentId: 'section', x: 150, y: 150, text: 'X' });
  // No page of its own: a child reads as `pageId: null` (page-rules), never a page.
  expect(text?.pageId ?? null).toBeNull();
});
