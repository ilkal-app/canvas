// The preset preview lays the main out as its instances do: a
// preset that widens a child or patches the main's auto-layout moves the siblings in the preview.
import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { createComponentBoard, mustRun } from './__fixtures__/component-board.js';
import { presetPreviewObjects, type PreviewSource } from './preset-preview.js';

const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
} as const;

/**
 * The card main laid out as a row, and the x of each child after layout.
 *
 * @returns The store, and a reader of a child's x in a preview or as stored.
 */
function rowCard() {
  const { store } = createComponentBoard();
  mustRun(store, 'setAutoLayout', { ids: ['card'], autoLayout: ROW });
  const children = [...store.references.childrenOf('card' as ObjectId)];
  const xOf = (objects: readonly BoardObject[], id: ObjectId): number => {
    const object = objects.find((candidate) => candidate.id === id) ?? store.get(id);
    return object?.x ?? Number.NaN;
  };
  return { store, children, xOf };
}

describe('presetPreviewObjects lays the main out', () => {
  it('moves the next sibling when a record widens a child', () => {
    const { store, children, xOf } = rowCard();
    const [first, second] = children;
    if (first === undefined || second === undefined) throw new Error('the card has no children');
    const width = (store.get(first) as { width: number }).width;
    const { objects } = presetPreviewObjects(store, { [first]: { width: width + 40 } });
    expect(xOf(objects, second)).toBe(xOf([], second) + 40);
  });

  it('moves the siblings when a record patches the main gap', () => {
    const { store, children, xOf } = rowCard();
    const second = children[1];
    if (second === undefined) throw new Error('the card has no second child');
    const { objects } = presetPreviewObjects(store, { card: { autoLayout: { gap: 30 } } });
    expect(xOf(objects, second)).toBe(xOf([], second) + 20);
  });

  it('changes nothing for a record that only recolours', () => {
    const { store } = rowCard();
    const { objects } = presetPreviewObjects(store, { body: { fill: [1, 0, 0, 1] } });
    expect(objects.map(({ id }) => id)).toEqual(['body']);
  });
});

/**
 * A preview source over plain objects.
 *
 * @param objects - The objects.
 * @returns The source.
 */
function sourceOf(objects: readonly Record<string, unknown>[]): PreviewSource {
  const byId = new Map(objects.map((object) => [object.id as ObjectId, object as BoardObject]));
  return {
    get: (id) => byId.get(id),
    references: {
      childrenOf: (id) =>
        [...byId.values()].filter(({ parentId }) => parentId === id).map(({ id: child }) => child),
    },
  };
}

const BASE = {
  pageId: null,
  rotation: 0,
  locked: false,
  createdBy: 'user:test',
  createdAt: 0,
  updatedAt: 0,
};
const STROKE = { color: [0, 0, 0, 1], width: 2 };
const END = { x: 'end', y: 'start' };

describe('presetPreviewObjects with a variant size', () => {
  it('moves a group, a line and a connector into the wider variant, ends on real targets', () => {
    const source = sourceOf([
      {
        ...BASE,
        id: 'main',
        type: 'component',
        parentId: null,
        pageId: 'page-1',
        x: 0,
        y: 0,
        z: 'a0',
        width: 100,
        height: 40,
        name: 'Main',
        retired: false,
      },
      {
        ...BASE,
        id: 'group',
        type: 'group',
        parentId: 'main',
        x: 60,
        y: 0,
        z: 'a0',
        constraints: END,
      },
      {
        ...BASE,
        id: 'dot',
        type: 'shape',
        kind: 'rectangle',
        parentId: 'group',
        x: 0,
        y: 0,
        z: 'a0',
        width: 20,
        height: 20,
        fill: [1, 0, 0, 1],
        stroke: null,
        cornerRadius: 0,
        sides: 4,
        label: null,
      },
      {
        ...BASE,
        id: 'rule',
        type: 'line',
        parentId: 'main',
        x: 70,
        y: 30,
        z: 'a1',
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
        ],
        route: 'straight',
        stroke: STROKE,
        startCap: 'none',
        endCap: 'none',
        constraints: END,
      },
      {
        ...BASE,
        id: 'box',
        type: 'shape',
        kind: 'rectangle',
        parentId: 'main',
        x: 0,
        y: 0,
        z: 'a2',
        width: 20,
        height: 20,
        fill: [0, 0, 1, 1],
        stroke: null,
        cornerRadius: 0,
        sides: 4,
        label: null,
      },
      {
        ...BASE,
        id: 'link',
        type: 'connector',
        parentId: 'main',
        x: 20,
        y: 10,
        z: 'a3',
        from: { kind: 'object', objectId: 'box', anchor: null },
        to: { kind: 'point', x: 60, y: 0 },
        route: 'straight',
        stroke: STROKE,
        startCap: 'none',
        endCap: 'none',
        label: null,
        constraints: END,
      },
    ]);
    const { objects } = presetPreviewObjects(source, { main: { width: 160 } });
    const byId = new Map(objects.map((object) => [object.id, object]));
    expect(byId.get('main' as ObjectId)).toMatchObject({ width: 160 });
    // An attached end keeps naming the real box, not the resolver's virtual copy of it.
    expect(byId.get('link' as ObjectId)).toMatchObject({
      x: 80,
      from: { kind: 'object', objectId: 'box' },
      to: { kind: 'point' },
    });
    expect(byId.get('group' as ObjectId)).toMatchObject({ x: 120, parentId: 'main' });
    expect(byId.get('rule' as ObjectId)).toMatchObject({ x: 130, parentId: 'main' });
  });
});
