import { describe, expect, it } from 'vitest';

import type { Board, BoardObject, ObjectId, PageId } from '@canvas/schema';

import { exportScopeOf } from './export-scope.js';

const PAGE = 'page-1' as PageId;

/**
 * An object of the test board, every field the scope reads.
 *
 * @param fields - Its fields.
 * @returns The object.
 */
function object(fields: Record<string, unknown>): BoardObject {
  return { parentId: null, pageId: PAGE, rotation: 0, x: 0, y: 0, ...fields } as BoardObject;
}

/**
 * A board of objects.
 *
 * @param objects - The objects.
 * @returns The board.
 */
function boardOf(objects: readonly BoardObject[]): Board {
  return { objects: new Map(objects.map((entry) => [entry.id, entry])) };
}

describe('exportScopeOf, groups', () => {
  it('bounds a group by its children, placed through it, and skips a child it cannot place', () => {
    const group = object({ id: 'group', type: 'group', x: 100, y: 50 });
    const inner = object({ id: 'inner', type: 'group', parentId: 'group', pageId: null });
    const left = object({
      id: 'left',
      type: 'shape',
      parentId: 'inner',
      pageId: null,
      x: 0,
      y: 0,
      width: 20,
      height: 10,
    });
    const right = object({
      id: 'right',
      type: 'shape',
      parentId: 'group',
      pageId: null,
      x: 80,
      y: 30,
      width: 20,
      height: 20,
    });
    const scope = exportScopeOf(boardOf([group, inner, left, right]), {
      kind: 'selection',
      ids: ['group' as ObjectId],
    });
    expect(scope?.rect).toEqual({ x: 100, y: 50, width: 100, height: 50 });
    expect([...(scope?.shownIds ?? [])].sort()).toEqual(['group', 'inner', 'left', 'right']);
  });

  it('exports nothing from a group with nothing to place', () => {
    const empty = object({ id: 'empty', type: 'group' });
    expect(
      exportScopeOf(boardOf([empty]), { kind: 'selection', ids: ['empty' as ObjectId] }),
    ).toBeUndefined();
  });
});

describe('exportScopeOf, what the canvas draws', () => {
  const shape = (id: string, x: number, fields: Record<string, unknown> = {}) =>
    object({ id, type: 'shape', x, y: 0, width: 10, height: 10, ...fields });

  it('leaves hidden objects, their content and retired mains out of the bounds and the drawing', () => {
    const shown = shape('shown', 0);
    const hidden = shape('hidden', 5000, { isHidden: true });
    const hiddenGroup = object({ id: 'hidden-group', type: 'group', isHidden: true });
    const inHidden = shape('in-hidden', 9000, { parentId: 'hidden-group', pageId: null });
    const retired = object({
      id: 'retired',
      type: 'component',
      retired: true,
      x: 7000,
      width: 10,
      height: 10,
    });
    const inRetired = shape('in-retired', 0, { parentId: 'retired', pageId: null });
    const board = boardOf([shown, hidden, hiddenGroup, inHidden, retired, inRetired]);
    const scope = exportScopeOf(board, { kind: 'page', pageId: PAGE });
    expect(scope?.rect).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect([...(scope?.shownIds ?? [])]).toEqual(['shown']);
    // A shown group is bounded by its shown children only.
    const group = object({ id: 'group', type: 'group' });
    const visibleChild = shape('visible-child', 0, { parentId: 'group', pageId: null });
    const hiddenChild = shape('hidden-child', 5000, {
      parentId: 'group',
      pageId: null,
      isHidden: true,
    });
    const grouped = exportScopeOf(boardOf([group, visibleChild, hiddenChild]), {
      kind: 'selection',
      ids: ['group' as ObjectId],
    });
    expect(grouped?.rect).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    const onlyHiddenChild = boardOf([group, hiddenChild]);
    expect(
      exportScopeOf(onlyHiddenChild, { kind: 'selection', ids: ['group' as ObjectId] }),
    ).toBeUndefined();
    const onlyHidden = boardOf([hidden]);
    expect(exportScopeOf(onlyHidden, { kind: 'page', pageId: PAGE })).toBeUndefined();
  });

  it('sends the mains an instance swaps in, with their content, and not as shown', () => {
    const main = object({ id: 'main', type: 'component', x: 500, width: 10, height: 10 });
    const swapped = object({ id: 'swapped', type: 'component', x: 900, width: 10, height: 10 });
    const inSwapped = shape('in-swapped', 0, { parentId: 'swapped', pageId: null });
    const instance = object({
      id: 'instance',
      type: 'instance',
      mainId: 'main',
      overrides: { slot: { mainId: 'swapped' } },
      width: 10,
      height: 10,
    });
    const scope = exportScopeOf(boardOf([main, swapped, inSwapped, instance]), {
      kind: 'selection',
      ids: ['instance' as ObjectId],
    });
    const sent = new Set(scope?.objects.map(({ id }) => id));
    expect([...sent].sort()).toEqual(['in-swapped', 'instance', 'main', 'swapped']);
    expect([...(scope?.shownIds ?? [])]).toEqual(['instance']);
  });
});
