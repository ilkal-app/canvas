import { describe, expect, it } from 'vitest';

import type { AutoLayout, BoardObject } from '@canvas/schema';

import { applyCommand } from '../commands/__fixtures__/command-fixtures.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { resizeObjectsCommand } from '../commands/resize-objects.js';
import { createHistory } from '../history/undo-manager.js';
import { ADA, exchange } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { box, frame, rect, storeWith } from './__fixtures__/auto-layout-fixtures.js';

const row: AutoLayout = {
  direction: 'row',
  gap: 8,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
};

/**
 * The four-action E4 board, with two independently stretched children in each action.
 *
 * @returns The row and its descendants.
 */
function e4(): BoardObject[] {
  return [
    { ...frame('row'), width: 356, height: 44, autoLayout: row } as BoardObject,
    ...[0, 1, 2, 3].flatMap((index): BoardObject[] => {
      const id = `action-${String(index)}`;
      return [
        {
          ...frame(id, 'row', `a${String(index)}`),
          x: index * 91,
          y: 0,
          width: 83,
          height: 44,
          layoutChild: { fill: true },
        } as BoardObject,
        {
          ...box(`${id}-background`, id, 'a0', 83, 44),
          constraints: { x: 'stretch', y: 'stretch' },
        },
        {
          ...frame(`${id}-content`, id, 'a1'),
          x: 4,
          y: 4,
          width: 75,
          height: 36,
          constraints: { x: 'stretch', y: 'stretch' },
        } as BoardObject,
      ];
    }),
  ];
}

/**
 * Checks the laid dimensions while allowing floating point representation differences.
 *
 * @param store - The board to inspect.
 * @param id - The object to inspect.
 * @param values - Expected x, y, width and height.
 */
function expectRect(store: YjsDocumentStore, id: string, values: readonly number[]): void {
  for (const [index, value] of values.entries()) {
    expect(rect(store, id)[index]).toBeCloseTo(value, 8);
  }
}

describe('constraints after command relayout (acceptance)', () => {
  it('reflows E4 after deletion, undo, redo, and exchange with a peer', () => {
    const ada = storeWith(...e4());
    const bob = new YjsDocumentStore({ clientId: 42 });
    exchange(ada, bob);
    const history = createHistory(ada, ADA.principalId);

    applyCommand(ada, deleteObjectsCommand, { ids: ['action-3'] });
    const grown = (356 - 2 * 8) / 3;
    for (const index of [0, 1, 2]) {
      const id = `action-${String(index)}`;
      expectRect(ada, id, [index * (grown + 8), 0, grown, 44]);
      expectRect(ada, `${id}-background`, [0, 0, grown, 44]);
      expectRect(ada, `${id}-content`, [4, 4, grown - 8, 36]);
    }
    exchange(ada, bob);
    expect(bob.read().objects).toEqual(ada.read().objects);
    expectRect(bob, 'action-1-content', [4, 4, grown - 8, 36]);

    expect(history.undo()).toBe(true);
    expectRect(ada, 'action-0-background', [0, 0, 83, 44]);
    expectRect(ada, 'action-0-content', [4, 4, 75, 36]);
    expect(history.redo()).toBe(true);
    expectRect(ada, 'action-0-background', [0, 0, grown, 44]);
  });

  it('stretches height in a fixed column after a deletion', () => {
    const objects = e4().map((object): BoardObject => {
      if (object.id === 'row')
        return {
          ...object,
          width: 44,
          height: 356,
          autoLayout: { ...row, direction: 'column' },
        } as BoardObject;
      if (object.parentId === 'row')
        return {
          ...object,
          x: 0,
          y: Number(object.id.slice(-1)) * 91,
          width: 44,
          height: 83,
        } as BoardObject;
      if (object.id.endsWith('-background'))
        return { ...object, width: 44, height: 83 } as BoardObject;
      return { ...object, width: 36, height: 75 } as BoardObject;
    });
    const store = storeWith(...objects);
    applyCommand(store, deleteObjectsCommand, { ids: ['action-3'] });
    const grown = (356 - 16) / 3;
    expectRect(store, 'action-0', [0, 0, 44, grown]);
    expectRect(store, 'action-0-background', [0, 0, 44, grown]);
    expectRect(store, 'action-0-content', [4, 4, 36, grown - 8]);
  });

  it('keeps start pinned and shifts end and center pins by the parent size delta', () => {
    const store = storeWith(
      ...e4(),
      {
        ...box('start', 'action-0', 'a2', 10, 10),
        x: 5,
        constraints: { x: 'start', y: 'start' },
      },
      {
        ...box('end', 'action-0', 'a3', 10, 10),
        x: 68,
        constraints: { x: 'end', y: 'start' },
      },
      {
        ...box('center', 'action-0', 'a4', 10, 10),
        x: 36.5,
        constraints: { x: 'center', y: 'start' },
      },
    );
    applyCommand(store, deleteObjectsCommand, { ids: ['action-3'] });
    const delta = (356 - 16) / 3 - 83;
    expectRect(store, 'start', [5, 0, 10, 10]);
    expectRect(store, 'end', [68 + delta, 0, 10, 10]);
    expectRect(store, 'center', [36.5 + delta / 2, 0, 10, 10]);
  });

  it('maps a filling sibling when a hugging container grows after its child is resized', () => {
    const hug: AutoLayout = { ...row, gap: 0, width: 'hug' };
    const store = storeWith(
      { ...frame('outer'), width: 356, height: 44, autoLayout: row } as BoardObject,
      {
        ...frame('hug', 'outer', 'a0'),
        x: 0,
        y: 0,
        width: 83,
        height: 44,
        autoLayout: hug,
      } as BoardObject,
      { ...box('hug-child', 'hug', 'a0', 83, 44) },
      {
        ...frame('fill', 'outer', 'a1'),
        x: 91,
        y: 0,
        width: 265,
        height: 44,
        layoutChild: { fill: true },
      } as BoardObject,
      {
        ...box('fill-background', 'fill', 'a0', 265, 44),
        constraints: { x: 'stretch', y: 'stretch' },
      },
    );
    applyCommand(store, resizeObjectsCommand, {
      resizes: [{ id: 'hug-child', to: { width: 113, height: 44 } }],
    });
    expectRect(store, 'hug', [0, 0, 113, 44]);
    expectRect(store, 'fill', [121, 0, 235, 44]);
    expectRect(store, 'fill-background', [0, 0, 235, 44]);
  });
});
