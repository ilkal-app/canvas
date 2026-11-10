// Item 9, written before the code. CONTRACT: a sticky created over the topmost eligible section joins it in local coordinates; outside or over a locked section it stays root. Deliberately not asserted: text editing or styling.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { frame } from '../select/__fixtures__/select-board.js';
import { createTextModeContext } from '../text/__fixtures__/text-mode-context.js';

import { StickyMode } from './sticky-mode.js';

function createAt(x: number, y: number, isLocked = false) {
  const section = frame('section', null, { x: 100, y: 100, width: 400, height: 400, isLocked });
  const { store, context } = createTextModeContext([section]);
  const mode = new StickyMode(context, { kind: 'create' });
  for (const kind of ['pointerDown', 'pointerUp'] as const) {
    mode.onPointer({
      kind,
      screen: { x, y },
      world: { x, y },
      zoom: 1,
      isShiftPressed: false,
      isModPressed: false,
    });
  }
  return store.get('new-1' as ObjectId);
}

describe('sticky section membership', () => {
  it('stores a sticky at its drawn world position in the section coordinate system', () => {
    expect(createAt(300, 300)).toMatchObject({
      parentId: 'section',
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    });
    // No page of its own: a child reads as `pageId: null` (page-rules), never a page.
    expect(createAt(300, 300)?.pageId ?? null).toBeNull();
  });
  it('keeps a sticky outside or over a locked section at the root', () => {
    expect(createAt(700, 300)).toMatchObject({ parentId: null, x: 600, y: 200 });
    expect(createAt(300, 300, true)).toMatchObject({ parentId: null, x: 200, y: 200 });
  });
});

describe('sticky section membership, hidden sections (review)', () => {
  function createOver(objects: Parameters<typeof createTextModeContext>[0]) {
    const { store, context } = createTextModeContext(objects);
    const mode = new StickyMode(context, { kind: 'create' });
    for (const kind of ['pointerDown', 'pointerUp'] as const) {
      const at = { x: 300, y: 300 };
      mode.onPointer({
        kind,
        screen: at,
        world: at,
        zoom: 1,
        isShiftPressed: false,
        isModPressed: false,
      });
    }
    return store.get('new-1' as ObjectId);
  }
  it('keeps a sticky over a hidden section, or one in a hidden section, at the root', () => {
    const box = { x: 100, y: 100, width: 400, height: 400 };
    expect(createOver([{ ...frame('section', null, box), isHidden: true }])).toMatchObject({
      parentId: null,
    });
    const outer = {
      ...frame('outer', null, { ...box, x: 0, y: 0, width: 800, height: 800 }),
      isHidden: true,
    };
    expect(createOver([outer, frame('inner', 'outer', box)])).toMatchObject({ parentId: null });
  });
});
