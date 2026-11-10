import { describe, expect, it } from 'vitest';

import { DEFAULT_AUTO_LAYOUT, type PrincipalId } from '@canvas/schema';

import {
  applyCommand,
  expectRejected,
  mustGet,
} from '../commands/__fixtures__/command-fixtures.js';
import { patchAutoLayoutCommand } from '../commands/patch-auto-layout.js';
import { setAutoLayoutCommand } from '../commands/set-auto-layout.js';
import { createHistory } from '../history/undo-manager.js';

import { box, frame, rect, ROW, storeWith } from './__fixtures__/auto-layout-fixtures.js';

// The inspector edits one field of several containers' auto-layouts at once, each
// keeping its other fields, in one command.

const ADA_ID = 'user:ada' as PrincipalId;

/**
 * The stored auto-layout of an object.
 *
 * @param store - The store.
 * @param id - The object.
 * @returns Its `autoLayout`, if any.
 */
function autoLayoutOf(store: ReturnType<typeof storeWith>, id: string): unknown {
  return (mustGet(store, id) as { readonly autoLayout?: unknown }).autoLayout;
}

describe('DEFAULT_AUTO_LAYOUT', () => {
  it('is a hugging row with no gap or padding, at the start', () => {
    expect(DEFAULT_AUTO_LAYOUT).toEqual({
      direction: 'row',
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'start',
      justify: 'start',
      width: 'hug',
      height: 'hug',
    });
  });
});

describe('patchAutoLayout', () => {
  it('merges one field into each container, keeping the rest, and re-lays them in one step', () => {
    const store = storeWith(
      frame('row'),
      box('a', 'row', 'a0', 40, 10),
      box('b', 'row', 'a1', 30, 20),
      frame('column', null, 'a1'),
      box('c', 'column', 'a0', 40, 10),
      box('d', 'column', 'a1', 30, 20),
    );
    applyCommand(store, setAutoLayoutCommand, { ids: ['row'], autoLayout: ROW });
    applyCommand(store, setAutoLayoutCommand, {
      ids: ['column'],
      autoLayout: { ...ROW, direction: 'column', gap: 4 },
    });
    const history = createHistory(store, ADA_ID);
    const { result } = applyCommand(store, patchAutoLayoutCommand, {
      ids: ['row', 'column'],
      patch: { gap: 20 },
    });
    expect(result.updatedIds).toEqual(['row', 'column']);
    expect(autoLayoutOf(store, 'row')).toEqual({ ...ROW, gap: 20 });
    expect(autoLayoutOf(store, 'column')).toEqual({ ...ROW, direction: 'column', gap: 20 });
    expect(rect(store, 'b')).toEqual([65, 5, 30, 20]);
    expect(rect(store, 'd')).toEqual([5, 35, 30, 20]);
    expect(history.undo()).toBe(true);
    expect(autoLayoutOf(store, 'row')).toEqual(ROW);
    expect(autoLayoutOf(store, 'column')).toEqual({ ...ROW, direction: 'column', gap: 4 });
    expect(rect(store, 'b')).toEqual([55, 5, 30, 20]);
    expect(history.canUndo()).toBe(false);
  });

  it("merges padding per side, keeping each container's other sides", () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10), frame('g', null, 'a1'));
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    const wide = { top: 1, right: 2, bottom: 3, left: 4 };
    applyCommand(store, setAutoLayoutCommand, {
      ids: ['g'],
      autoLayout: { ...ROW, padding: wide },
    });
    applyCommand(store, patchAutoLayoutCommand, {
      ids: ['f', 'g'],
      patch: { padding: { top: 9 } },
    });
    expect(autoLayoutOf(store, 'f')).toEqual({ ...ROW, padding: { ...ROW.padding, top: 9 } });
    expect(autoLayoutOf(store, 'g')).toEqual({ ...ROW, padding: { ...wide, top: 9 } });
    expect(rect(store, 'a')).toEqual([5, 9, 40, 10]);
  });

  it('writes nothing for a container already holding every value', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10));
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    const again = applyCommand(store, patchAutoLayoutCommand, {
      ids: ['f'],
      patch: { gap: ROW.gap, padding: { left: 5 } },
    });
    expect(again.result.updatedIds).toEqual([]);
  });

  it('refuses a container without an auto-layout, and anything but a frame or main', () => {
    const store = storeWith(frame('f'), box('a', 'f', 'a0', 40, 10));
    const codes = (input: unknown) =>
      expectRejected(store, patchAutoLayoutCommand, input).map(({ code }) => code);
    expect(codes({ ids: ['f'], patch: { gap: 1 } })).toEqual(['unsupported-type']);
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    expect(codes({ ids: ['f', 'a'], patch: { gap: 1 } })).toEqual(['unsupported-type']);
    expect(autoLayoutOf(store, 'f')).toEqual(ROW);
  });

  it('refuses an empty or invalid patch', () => {
    const store = storeWith(frame('f'));
    applyCommand(store, setAutoLayoutCommand, { ids: ['f'], autoLayout: ROW });
    expect(patchAutoLayoutCommand.input.safeParse({ ids: ['f'], patch: {} }).success).toBe(false);
    expect(
      patchAutoLayoutCommand.input.safeParse({ ids: ['f'], patch: { padding: {} } }).success,
    ).toBe(false);
    // A negative gap overlaps the children; past minus the board bound it is refused.
    expect(
      patchAutoLayoutCommand.input.safeParse({ ids: ['f'], patch: { gap: -(2 ** 30) - 1 } })
        .success,
    ).toBe(false);
    expect(patchAutoLayoutCommand.input.safeParse({ ids: ['f'], patch: { gap: -4 } }).success).toBe(
      true,
    );
    expect(
      patchAutoLayoutCommand.input.safeParse({ ids: ['f'], patch: { wrap: true } }).success,
    ).toBe(false);
  });
});
