// CONTRACT (item 4): Shift+click with the sticky tool stacks below the note at the
// press, then the selected or last placed note; with no anchor it places at the press.
import { describe, expect, it } from 'vitest';

import type { ObjectId, Point, StickyObject } from '@canvas/schema';

import * as tools from '../index.js';
import type { ToolPointerInput } from '../modes/tool-mode.js';
import { createTextModeContext, tenPointNote } from '../text/__fixtures__/text-mode-context.js';

import type { NewStickyObject } from './new-sticky-object.js';
import { StickyMode } from './sticky-mode.js';

// The export is part of this acceptance contract and is absent until implementation.
const { stackedStickyOf } = tools as typeof tools & {
  stackedStickyOf: (above: StickyObject) => NewStickyObject;
};

function click(mode: StickyMode, x: number, y: number, isShiftHeld = false): void {
  for (const kind of ['pointerDown', 'pointerUp'] as const) {
    mode.onPointer({
      kind,
      screen: { x, y },
      world: { x, y },
      isShiftPressed: isShiftHeld,
      isModPressed: false,
      zoom: 1,
    } satisfies ToolPointerInput);
  }
}

function expectStacked(
  store: ReturnType<typeof createTextModeContext>['store'],
  mode: StickyMode,
  selected: readonly (readonly ObjectId[])[],
  above: StickyObject,
  belowId: string,
): void {
  const below = store.get(belowId as ObjectId);
  expect(below).toMatchObject(stackedStickyOf(above));
  expect(selected.at(-1)).toEqual([belowId]);
  expect(mode.session?.id).toBe(belowId);
}

describe('StickyMode Shift+click stacking', () => {
  it('ends the current edit and stacks below the last placed note even when clicked elsewhere', () => {
    const { store, context, record } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });
    click(mode, 300, 200);
    mode.session?.type('First note');
    const above = store.get('new-1' as ObjectId);
    if (above?.type !== 'sticky') throw new Error('First click did not create a sticky');

    click(mode, 900, 700, true);

    expect(store.read().objects.size).toBe(2);
    expect(store.get(above.id)).toMatchObject({ text: 'First note' });
    expectStacked(store, mode, record.selected, above, 'new-2');
  });

  it('stacks below the sticky at the Shift+click instead of the last placed note', () => {
    const target = tenPointNote('target', 'Target', {
      x: 600,
      y: 50,
      width: 300,
      height: 260,
      color: [1, 0.74, 0.8, 1],
      aspect: 'wide',
    });
    const { store, context, record } = createTextModeContext([target]);
    const mode = new StickyMode(
      { ...context, stickyAt: (world: Point) => (world.x === 650 ? target.id : undefined) },
      { kind: 'create' },
    );
    click(mode, 200, 200);
    expect(mode.session?.id).toBe('new-1');

    click(mode, 650, 100, true);

    expect(store.read().objects.size).toBe(3);
    expectStacked(store, mode, record.selected, target, 'new-2');
  });

  it('stacks below the selected sticky when none was placed with this tool', () => {
    const selected = tenPointNote('selected', 'Earlier', { x: 40, y: 80, width: 320 });
    const { store, context, record } = createTextModeContext([selected]);
    const mode = new StickyMode(
      { ...context, selectedSticky: () => selected.id },
      { kind: 'create' },
    );

    click(mode, 900, 700, true);

    expect(store.read().objects.size).toBe(2);
    expectStacked(store, mode, record.selected, selected, 'new-1');
  });

  it('places at the press when no sticky is under it, selected, or last placed', () => {
    const { store, context, record } = createTextModeContext();
    const mode = new StickyMode(context, { kind: 'create' });

    click(mode, 340, 180, true);

    const note = store.get('new-1' as ObjectId);
    expect(note).toMatchObject({ type: 'sticky', x: 240, y: 80, width: 200, height: 200 });
    expect(store.read().objects.size).toBe(1);
    expect(record.selected.at(-1)).toEqual(['new-1']);
    expect(mode.session?.id).toBe('new-1');
  });
});
