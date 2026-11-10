import { describe, expect, it } from 'vitest';

import { buildChildIndex } from '../board/child-index.js';
import * as schema from '../index.js';
import type {
  Board,
  BoardObject,
  ComponentObject,
  InstanceObject,
  ObjectId,
  StackNode,
} from '../index.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

import {
  boardOf,
  component,
  frame,
  id,
  instance,
  line,
  shape,
  text,
} from './__fixtures__/component-board.js';
import { byId, resolve } from './__fixtures__/resolved-board.js';

const ROW = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
} as const;

// The new exports are absent on main. Keep the expected package-root contract typechecked here.
const { autoLayoutTree, laidInstanceSize } = schema as unknown as {
  autoLayoutTree: (
    reader: {
      get(id: ObjectId): BoardObject | undefined;
      childrenOf(id: ObjectId): Iterable<ObjectId>;
    },
    container: ComponentObject | BoardObject,
    records?: Record<
      string,
      { isHidden?: boolean; measuredSize?: { width: number; height: number; fonts?: string } }
    >,
  ) => StackNode;
  laidInstanceSize: (
    reader: {
      get(id: ObjectId): BoardObject | undefined;
      childrenOf(id: ObjectId): Iterable<ObjectId>;
    },
    instance: InstanceObject,
    main: ComponentObject,
  ) => { width: number; height: number };
};

function reader(board: Board) {
  const children = buildChildIndex(board);
  return {
    get: (objectId: ObjectId) => board.objects.get(objectId),
    childrenOf: (objectId: ObjectId) => children.get(objectId) ?? [],
  };
}

function rowBoard(overrides: Record<string, unknown> = {}) {
  return boardOf([
    component('main', { width: 140, height: 30, autoLayout: ROW }),
    shape('first', 'main', { width: 40, height: 20, z: 'a0', x: 5, y: 5 }),
    text('label', 'main', { width: 30, height: 20, z: 'a1', x: 55, y: 5 }),
    shape('last', 'main', { width: 40, height: 20, z: 'a2', x: 95, y: 5 }),
    instance('inst', 'main', { width: 140, height: 30, overrides }),
  ]);
}

function mainOf(board: Board): ComponentObject {
  return board.objects.get(id('main')) as ComponentObject;
}
function instanceOf(board: Board): InstanceObject {
  return board.objects.get(id('inst')) as InstanceObject;
}

describe('instance auto-layout tree', () => {
  it('takes only box children in z order and preserves fill on a child', () => {
    const board = boardOf([
      component('main', { autoLayout: ROW }),
      shape('later', 'main', { z: 'a2', layoutChild: { fill: true } }),
      line('non-box', 'main', { z: 'a1' }),
      shape('earlier', 'main', { z: 'a0' }),
    ]);
    const tree = autoLayoutTree(reader(board), mainOf(board));
    expect(tree.children?.map(({ key }) => key)).toEqual(['earlier', 'later']);
    expect(tree.children?.[1]?.isFilling).toBe(true);
  });

  it('uses even a stale measured size and removes hidden children from flow', () => {
    const board = rowBoard();
    const tree = autoLayoutTree(reader(board), mainOf(board), {
      first: { isHidden: true },
      label: { measuredSize: { width: 70, height: 24, fonts: 'old-fonts' } },
    });
    expect(tree.children?.[0]?.isHidden).toBe(true);
    expect(tree.children?.[1]).toMatchObject({ width: 70, height: 24 });
  });

  it('makes a nested auto-layout frame a sub-stack and hides its descendants with it', () => {
    const board = boardOf([
      component('main', { autoLayout: ROW }),
      frame('nested', 'main', { autoLayout: ROW, z: 'a0' }),
      shape('inside', 'nested'),
    ]);
    const tree = autoLayoutTree(reader(board), mainOf(board), { nested: { isHidden: true } });
    expect(tree.children?.[0]).toMatchObject({
      key: 'nested',
      isHidden: true,
      layout: { direction: 'row' },
    });
    expect(tree.children?.[0]?.children?.[0]).toMatchObject({ key: 'inside', isHidden: true });
  });
});

describe('instance auto-layout resolution', () => {
  it('closes the hidden child gap and moves a later sibling after an overridden label grows', () => {
    const board = rowBoard({
      first: { isHidden: true },
      label: { text: 'Longer label', measuredSize: { width: 70, height: 24 } },
    });
    const { objects } = resolve(board);
    expect(objects.some(({ id: objectId }) => objectId === 'inst/first')).toBe(false);
    expect(byId(objects, 'inst/label')).toMatchObject({ x: 5, y: 5, width: 70, height: 24 });
    expect(byId(objects, 'inst/last')).toMatchObject({ x: 85, y: 5 });
    expect(laidInstanceSize(reader(board), instanceOf(board), mainOf(board))).toEqual({
      width: 130,
      height: 34,
    });
  });

  it('keeps a fixed instance axis while its other axis hugs overridden content', () => {
    const board = rowBoard({ label: { measuredSize: { width: 70, height: 24 } } });
    const fixed = instance('fixed', 'main', {
      width: 300,
      height: 30,
      isWidthFixed: true,
      overrides: instanceOf(board).overrides,
    });
    const withFixed = boardOf([...board.objects.values(), fixed]);
    expect(laidInstanceSize(reader(withFixed), fixed, mainOf(withFixed))).toEqual({
      width: 300,
      height: 34,
    });
  });

  it('does not patch one child when the main or an ancestor uses auto-layout', () => {
    const board = rowBoard();
    expect(schema.resolveInstanceChild(board, instanceOf(board), id('last'))).toBeUndefined();
    const nested = boardOf([
      component('main'),
      frame('nested', 'main', { autoLayout: ROW }),
      shape('leaf', 'nested'),
      instance('inst', 'main'),
    ]);
    expect(schema.resolveInstanceChild(nested, instanceOf(nested), id('leaf'))).toBeUndefined();
  });

  it('does not mutate a frozen board while laying out its instance', () => {
    const board = deepFreeze(rowBoard({ first: { isHidden: true } }));
    const before = [...board.objects.values()];
    resolve(board);
    laidInstanceSize(reader(board), instanceOf(board), mainOf(board));
    expect([...board.objects.values()]).toEqual(before);
  });
});
