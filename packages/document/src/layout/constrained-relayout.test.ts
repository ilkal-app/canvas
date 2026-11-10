import { describe, expect, it } from 'vitest';

import {
  MAX_DRAWABLE_SIZE,
  type AutoLayout,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { createHistory } from '../history/undo-manager.js';

import { box, frame, rect, storeWith } from './__fixtures__/auto-layout-fixtures.js';
import { planRelayout } from './plan-relayout.js';

// A frame an auto-layout pass resizes maps its own children by their constraints, as a
// resize does. The MX benchmark's edit E4: deleting one of four filling actions in a fixed row
// grew the other three, but their stretched backgrounds and content stayed at the old width.

/** A fixed row 356 wide, 8 apart, unpadded: four 83-wide actions fill it exactly. */
const ACTIONS: AutoLayout = {
  direction: 'row',
  gap: 8,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
};

const STRETCH = { constraints: { x: 'stretch', y: 'stretch' } } as const;

/**
 * One filling action at its laid place: a stretched rounded background and a stretched content
 * frame inset by 4, optionally laid out itself with a filling label.
 *
 * @param index - Its place in the row, from 0.
 * @param isContentLaid - Whether the content frame is an auto-layout row with a filling label.
 * @returns The action and its descendants.
 */
function action(index: number, isContentLaid = false): BoardObject[] {
  const id = `action-${String(index)}`;
  const content = `${id}-content`;
  return [
    {
      ...frame(id, 'row', `a${String(index)}`),
      x: index * 91,
      y: 0,
      width: 83,
      height: 44,
      layoutChild: { fill: true },
    } as BoardObject,
    { ...box(`${id}-bg`, id, 'a0', 83, 44), ...STRETCH },
    {
      ...frame(content, id, 'a1'),
      x: 4,
      y: 4,
      width: 75,
      height: 36,
      ...STRETCH,
      ...(isContentLaid ? { autoLayout: ACTIONS } : {}),
    } as BoardObject,
    ...(isContentLaid
      ? [
          {
            ...box(`${id}-label`, content, 'a0', 75, 36),
            layoutChild: { fill: true },
          } as BoardObject,
        ]
      : []),
  ];
}

/**
 * The E4 board: the row and its four actions.
 *
 * @param isContentLaid - Whether each action's content is laid out itself.
 * @returns The objects.
 */
function actionRow(isContentLaid = false): BoardObject[] {
  return [
    { ...frame('row'), width: 356, height: 44, autoLayout: ACTIONS } as BoardObject,
    ...[0, 1, 2, 3].flatMap((index) => action(index, isContentLaid)),
  ];
}

/** The width each of three actions fills: (356 − 2 × 8) / 3. */
const GROWN = (356 - 16) / 3;

describe('constraints under a relayout', () => {
  it('grows an action’s stretched children with it when a sibling is deleted, in one undo step', () => {
    const store = storeWith(...actionRow());
    const history = createHistory(store, 'user:ada' as PrincipalId);
    applyCommand(store, deleteObjectsCommand, { ids: ['action-3'] });
    for (const index of [0, 1, 2]) {
      const id = `action-${String(index)}`;
      expect(rect(store, id)).toEqual([index * (GROWN + 8), 0, GROWN, 44]);
      expect(rect(store, `${id}-bg`)).toEqual([0, 0, GROWN, 44]);
      expect(rect(store, `${id}-content`)).toEqual([4, 4, GROWN - 8, 36]);
    }
    expect(history.undo()).toBe(true);
    expect(rect(store, 'action-0-bg')).toEqual([0, 0, 83, 44]);
    expect(rect(store, 'action-0-content')).toEqual([4, 4, 75, 36]);
  });

  it('lays out a stretched child that is an auto-layout frame at its new size', () => {
    const store = storeWith(...actionRow(true));
    applyCommand(store, deleteObjectsCommand, { ids: ['action-3'] });
    expect(rect(store, 'action-0-content')).toEqual([4, 4, GROWN - 8, 36]);
    expect(rect(store, 'action-0-label')).toEqual([0, 0, GROWN - 8, 36]);
  });

  it('leaves a child without constraints where it is', () => {
    const objects = actionRow().map((object) =>
      object.id === 'action-0-bg' ? { ...object, constraints: undefined } : object,
    );
    const store = storeWith(...objects);
    applyCommand(store, deleteObjectsCommand, { ids: ['action-3'] });
    expect(rect(store, 'action-0')).toEqual([0, 0, GROWN, 44]);
    expect(rect(store, 'action-0-bg')).toEqual([0, 0, 83, 44]);
  });

  it('leaves a locked stretched child, and what it holds, as it was', () => {
    const objects = actionRow(true).map((object) =>
      object.id === 'action-0-content' ? { ...object, locked: true } : object,
    );
    const store = storeWith(...objects);
    applyCommand(store, deleteObjectsCommand, { ids: ['action-3'] });
    expect(rect(store, 'action-0')).toEqual([0, 0, GROWN, 44]);
    expect(rect(store, 'action-0-bg')).toEqual([0, 0, GROWN, 44]);
    expect(rect(store, 'action-0-content')).toEqual([4, 4, 75, 36]);
    expect(rect(store, 'action-0-label')).toEqual([0, 0, 75, 36]);
  });

  it('maps nothing under a frame whose laid size the store would refuse', () => {
    // A peer's raw write left the row past the extent a renderer draws: its filling actions lay
    // out past it too, `relayoutOf` leaves those writes out, so their children must stay.
    const objects = actionRow().map((object) =>
      object.id === 'row' ? { ...object, width: 8 * MAX_DRAWABLE_SIZE } : object,
    );
    const byId = new Map(objects.map((object) => [object.id, object]));
    const planned = planRelayout(
      {
        get: (id) => byId.get(id),
        childrenOf: (id) => objects.filter((o) => o.parentId === id).map((o) => o.id),
        instancesOf: () => [],
      },
      ['row' as ObjectId],
    );
    expect(planned.has('action-0' as ObjectId)).toBe(true);
    expect(planned.has('action-0-bg' as ObjectId)).toBe(false);
    expect(planned.has('action-0-content' as ObjectId)).toBe(false);
  });
});
