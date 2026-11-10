import { describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { id, mapSource, rect, selectBoardObjects } from './__fixtures__/select-board.js';
import { isChangeRelated, selectionRelationsOf } from './selection-relations.js';

const SOURCE = mapSource(selectBoardObjects());

/** A box for an object arriving in a group. */
const NEW_BOX = { x: 500, y: 0, width: 100, height: 100 };

/**
 * A change set touching some ids.
 *
 * @param touched - The ids, by kind.
 * @param touched.created - Created ids.
 * @param touched.updated - Updated ids.
 * @param touched.deleted - Deleted ids.
 * @returns The change set.
 */
function change(touched: { created?: string[]; updated?: string[]; deleted?: string[] }) {
  return {
    created: (touched.created ?? []).map(id),
    updated: (touched.updated ?? []).map(id),
    deleted: (touched.deleted ?? []).map(id),
  };
}

describe('selectionRelationsOf', () => {
  it('holds the selected ids and their ancestors, and a selected group’s whole subtree', () => {
    const relations = selectionRelationsOf([id('rect-c'), id('group-g')], SOURCE);
    expect([...relations.ids].sort()).toEqual(
      ['frame-f', 'group-g', 'group-h', 'rect-c', 'rect-d', 'rect-e'].sort(),
    );
    expect(relations.hasGroup).toBe(true);
  });

  it('holds a selected connector’s targets and their ancestors, and a group target’s subtree', () => {
    const relations = selectionRelationsOf([id('connector-k')], SOURCE);
    expect([...relations.ids].sort()).toEqual(['connector-k', 'frame-f', 'rect-a', 'rect-c']);
    expect(relations.hasGroup).toBe(false);
    const onGroup = selectBoardObjects().map((object) =>
      object.id === id('connector-k')
        ? { ...object, to: { kind: 'object', objectId: id('group-h'), anchor: null } }
        : object,
    );
    const toGroup = selectionRelationsOf([id('connector-k')], mapSource(onGroup as never));
    expect([...toGroup.ids].sort()).toEqual(
      ['connector-k', 'group-g', 'group-h', 'rect-a', 'rect-e'].sort(),
    );
    expect(isChangeRelated(change({ updated: ['rect-e'] }), toGroup, SOURCE)).toBe(true);
    // An object arriving under the target group grows its bounds, so it moves the route.
    expect(toGroup.hasGroup).toBe(true);
    expect([...toGroup.groupSubtree].sort()).toEqual(['group-h', 'rect-e']);
    const arrived = mapSource([...onGroup, rect('rect-new', 'group-h', NEW_BOX)] as never);
    expect(isChangeRelated(change({ created: ['rect-new'] }), toGroup, arrived)).toBe(true);
  });

  it('has no group subtree when no group is selected', () => {
    const relations = selectionRelationsOf([id('rect-a')], SOURCE);
    expect([...relations.ids]).toEqual(['rect-a']);
    expect(relations.hasGroup).toBe(false);
  });
});

describe('isChangeRelated', () => {
  it('is true when a change touches a selected id, an ancestor or a group’s descendant', () => {
    const relations = selectionRelationsOf([id('rect-c'), id('group-g')], SOURCE);
    expect(isChangeRelated(change({ updated: ['rect-c'] }), relations, SOURCE)).toBe(true);
    expect(isChangeRelated(change({ updated: ['frame-f'] }), relations, SOURCE)).toBe(true);
    expect(isChangeRelated(change({ deleted: ['rect-e'] }), relations, SOURCE)).toBe(true);
  });

  it('is false for a change to unrelated objects, even a sibling in the same frame', () => {
    const objects = [
      ...selectBoardObjects(),
      rect('rect-s', 'frame-f', { x: 0, y: 0, width: 10, height: 10 }),
    ];
    const source = mapSource(objects);
    const relations = selectionRelationsOf([id('rect-c')], source);
    const change1 = change({ created: ['rect-s'], updated: ['rect-a'], deleted: ['rect-x'] });
    expect(isChangeRelated(change1, relations, source)).toBe(false);
  });

  it('reads nothing from the document for an unrelated change when no group is selected', () => {
    const get = vi.fn((objectId: ObjectId) => SOURCE.get(objectId));
    const source = { ...SOURCE, get };
    const relations = selectionRelationsOf([id('rect-a'), id('rect-c')], source);
    get.mockClear();
    const unrelated = change({ created: ['rect-new'], updated: ['rect-b', 'frame-f'] });
    // frame-f is rect-c's parent: related, found without a read.
    expect(isChangeRelated(unrelated, relations, source)).toBe(true);
    expect(isChangeRelated(change({ updated: ['rect-b'] }), relations, source)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  it('finds an object newly put under a selected group by walking up its parents', () => {
    const objects = [
      ...selectBoardObjects(),
      rect('rect-new', 'group-h', { x: 0, y: 0, width: 10, height: 10 }),
    ];
    const source = mapSource(objects);
    // Relations built before rect-new existed.
    const relations = selectionRelationsOf([id('group-g')], mapSource(selectBoardObjects()));
    expect(isChangeRelated(change({ created: ['rect-new'] }), relations, source)).toBe(true);
    expect(isChangeRelated(change({ updated: ['rect-a'] }), relations, source)).toBe(false);
  });

  it('walks past unrelated parents with a group selected, and stops on a parent cycle', () => {
    const objects = [
      ...selectBoardObjects(),
      rect('rect-s', 'frame-f', { x: 0, y: 0, width: 10, height: 10 }),
      rect('loop-a', 'loop-b', { x: 0, y: 0, width: 10, height: 10 }),
      rect('loop-b', 'loop-a', { x: 0, y: 0, width: 10, height: 10 }),
    ];
    const source = mapSource(objects);
    const relations = selectionRelationsOf([id('group-g')], source);
    const touched = change({ created: ['rect-s'], updated: ['loop-a'] });
    expect(isChangeRelated(touched, relations, source)).toBe(false);
  });

  it('is false with nothing selected', () => {
    const relations = selectionRelationsOf([] as ObjectId[], SOURCE);
    expect(isChangeRelated(change({ updated: ['rect-a'] }), relations, SOURCE)).toBe(false);
  });
});
