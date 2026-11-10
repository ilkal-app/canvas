import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { validateBoard, type PrincipalId } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { BOB, createSyncedPair, exchange, id } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { applyCommand, mustGet, testEnvironment } from './__fixtures__/command-fixtures.js';
import { createObjectsCommand, type createObjectsInputSchema } from './create-objects.js';
import { deleteObjectsCommand } from './delete-objects.js';
import { moveObjectsCommand } from './move-objects.js';

// Sync tests for createObjects: pastes that meet other clients'
// pastes, deletes and moves converge to one valid board on every client.

/** The input of `createObjects`, before parsing. */
type Input = z.input<typeof createObjectsInputSchema>;

/**
 * What a copy of the fixture's diagram group would paste: the group and its two shapes, with the
 * group's position on the board and the shapes' in the group, listed under their old ids.
 */
const DIAGRAM_PASTE: Input = {
  objects: [
    { type: 'group', id: 'group-diagram', x: 416, y: 136 },
    ...(['shape-box', 'shape-star'] as const).map((listedId, index) => ({
      type: 'shape' as const,
      id: listedId,
      parentId: 'group-diagram',
      x: index * 60,
      y: 0,
      width: 50,
      height: 50,
      kind: 'rectangle' as const,
      stroke: null,
      fill: [1, 0, 0, 1] as [number, number, number, number],
      cornerRadius: 0,
      sides: 4,
      label: null,
    })),
  ],
};

/**
 * Checks that both clients hold the same board, and that it breaks no reference rule of the schema.
 *
 * @param ada - One client.
 * @param bob - The other.
 */
function expectConverged(ada: YjsDocumentStore, bob: YjsDocumentStore): void {
  expect(new Map(bob.read().objects)).toEqual(new Map(ada.read().objects));
  expect(ada.read().issues).toEqual([]);
  expect(validateBoard(ada.read())).toEqual([]);
}

describe('concurrent pastes', () => {
  it.each([
    { order: 'Ada first', isBobFirst: false },
    { order: 'Bob first', isBobFirst: true },
  ])(
    'two clients pasting into the same parent get distinct keys and both pastes ($order)',
    ({ isBobFirst }) => {
      const [ada, bob] = createSyncedPair();
      const input = { ...DIAGRAM_PASTE, parentId: 'frame-plan' };
      const adaIds = applyCommand(ada, createObjectsCommand, input).result.ids;
      const bobIds = applyCommand(bob, createObjectsCommand, input, BOB, testEnvironment(8)).result
        .ids;
      if (isBobFirst) exchange(bob, ada);
      else exchange(ada, bob);
      expectConverged(ada, bob);
      for (const newId of [...adaIds, ...bobIds]) expect(ada.get(id(newId))).toBeDefined();
      const [adaGroup = '', bobGroup = ''] = [adaIds[0], bobIds[0]];
      expect(mustGet(ada, adaGroup).z).not.toBe(mustGet(ada, bobGroup).z);
      // Both pastes sit on top of what the frame held, one above the other.
      const top = sortedSiblings(ada, id('frame-plan')).slice(-2);
      expect([...top].sort()).toEqual([adaGroup, bobGroup].sort());
    },
  );

  it('a paste racing a delete of its source keeps the pasted copy whole', () => {
    const [ada, bob] = createSyncedPair();
    // Ada copied the diagram group before Bob deleted it; the paste carries its own objects.
    applyCommand(bob, deleteObjectsCommand, { ids: ['group-diagram'] }, BOB);
    const pasted = applyCommand(ada, createObjectsCommand, DIAGRAM_PASTE).result.ids;
    exchange(ada, bob);
    expectConverged(ada, bob);
    expect(bob.get(id('group-diagram'))).toBeUndefined();
    expect(bob.get(id('shape-box'))).toBeUndefined();
    const [group, ...shapes] = pasted.map((newId) => mustGet(bob, newId));
    expect(group).toMatchObject({ type: 'group', parentId: null });
    for (const shape of shapes) expect(shape.parentId).toBe(group?.id);
  });

  it('a paste into a frame another client deletes moves to the root where it was', () => {
    const [ada, bob] = createSyncedPair();
    const pasted = applyCommand(ada, createObjectsCommand, {
      ...DIAGRAM_PASTE,
      parentId: 'frame-plan',
    }).result.ids;
    const [groupId = ''] = pasted;
    const inFrame = mustGet(ada, groupId);
    const frame = mustGet(ada, 'frame-plan');
    applyCommand(bob, deleteObjectsCommand, { ids: ['frame-plan'] }, BOB);
    exchange(ada, bob);
    expectConverged(ada, bob);
    // The reference repair re-roots the pasted group, keeping its place on the board.
    expect(mustGet(bob, groupId)).toMatchObject({
      parentId: null,
      x: frame.x + inFrame.x,
      y: frame.y + inFrame.y,
    });
    expect(mustGet(bob, pasted[1] ?? '').parentId).toBe(groupId);
  });

  it('undo removes a whole paste in one step and keeps a collaborator’s concurrent move', () => {
    const [ada, bob] = createSyncedPair();
    const history = createHistory(ada, 'user:ada' as PrincipalId);
    const pasted = applyCommand(ada, createObjectsCommand, DIAGRAM_PASTE).result.ids;
    applyCommand(
      bob,
      moveObjectsCommand,
      { moves: [{ id: 'image-photo', by: { x: 5, y: 5 } }] },
      BOB,
    );
    exchange(ada, bob);
    const moved = mustGet(ada, 'image-photo');
    expect(history.undo()).toBe(true);
    exchange(ada, bob);
    expectConverged(ada, bob);
    for (const newId of pasted) expect(bob.get(id(newId))).toBeUndefined();
    expect(mustGet(bob, 'image-photo')).toMatchObject({ x: moved.x, y: moved.y });
    expect(history.canUndo()).toBe(false);
    history.destroy();
  });
});
