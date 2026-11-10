import { describe, expect, it } from 'vitest';

import { group, id, mapSource, rect, selectBoardObjects } from './__fixtures__/select-board.js';
import type { OrientedBox } from './oriented-box.js';
import { selectionBoxOf, selectionFrameOf } from './selection-frame.js';
import {
  groupsHoldingLocked,
  isAncestorOf,
  isResizable,
  orientedBoxOf,
  selectTargetOf,
  transformableIds,
  unlockedTopmostIds,
} from './selection-geometry.js';

const SOURCE = mapSource(selectBoardObjects());

function expectBox(actual: OrientedBox | undefined, expected: OrientedBox): void {
  expect(actual).toBeDefined();
  for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
    expect(actual?.[key], key).toBeCloseTo(expected[key], 9);
  }
}

describe('orientedBoxOf', () => {
  it('is a boxed object’s own box, turned with it, in world units', () => {
    expectBox(orientedBoxOf(id('rect-b'), SOURCE), {
      x: 200,
      y: 0,
      width: 100,
      height: 50,
      rotation: Math.PI / 2,
    });
  });

  it('places a child through its parents', () => {
    expectBox(orientedBoxOf(id('rect-c'), SOURCE), {
      x: 420,
      y: 20,
      width: 50,
      height: 50,
      rotation: 0,
    });
  });

  it('spans a line’s points in its own frame', () => {
    expectBox(orientedBoxOf(id('line-l'), SOURCE), {
      x: 0,
      y: 500,
      width: 100,
      height: 50,
      rotation: 0,
    });
  });

  it('spans a path’s vertices and handle points in its own frame', () => {
    const path = {
      ...selectBoardObjects()[11],
      id: id('path-curve'),
      x: 10,
      y: 20,
      vertices: [
        { id: 'v1', x: 0, y: 0, mirror: 'none' },
        { id: 'v2', x: 100, y: 0, mirror: 'none' },
      ],
      segments: [{ id: 's1', a: 'v1', b: 'v2', ha: { x: 0, y: -40 }, hb: { x: 0, y: -40 } }],
    };
    expectBox(orientedBoxOf(id('path-curve'), mapSource([path as never])), {
      x: 10,
      y: -20,
      width: 100,
      height: 40,
      rotation: 0,
    });
  });

  it('derives a group’s box from its descendants, nested groups included', () => {
    expectBox(orientedBoxOf(id('group-g'), SOURCE), {
      x: 0,
      y: 300,
      width: 100,
      height: 40,
      rotation: 0,
    });
  });

  it('follows a turned group: the box is in the group’s own frame', () => {
    const objects = selectBoardObjects().map((object) =>
      object.id === 'group-g' ? { ...object, rotation: Math.PI / 2 } : object,
    );
    expectBox(orientedBoxOf(id('group-g'), mapSource(objects)), {
      x: 0,
      y: 300,
      width: 100,
      height: 40,
      rotation: Math.PI / 2,
    });
  });

  it('has none for a missing object, a connector, an empty path or an empty group', () => {
    const objects = [...selectBoardObjects(), { ...selectBoardObjects()[4], id: id('group-x') }];
    const source = mapSource(objects as never);
    expect(orientedBoxOf(id('gone'), source)).toBeUndefined();
    expect(orientedBoxOf(id('connector-k'), source)).toBeUndefined();
    expect(orientedBoxOf(id('path-empty'), source)).toBeUndefined();
    expect(orientedBoxOf(id('group-x'), source)).toBeUndefined();
  });

  it('stops at a parent cycle instead of looping', () => {
    const loop = [
      { ...selectBoardObjects()[4], id: id('loop-a'), parentId: id('loop-b') },
      { ...selectBoardObjects()[4], id: id('loop-b'), parentId: id('loop-a') },
    ];
    const source = mapSource(loop as never);
    expect(orientedBoxOf(id('loop-a'), source)).toBeUndefined();
    expect(selectTargetOf(id('loop-a'), source)).toBe('loop-b');
  });
});

describe('selectionFrameOf', () => {
  it('is the object’s own turned box for one object', () => {
    expectBox(selectionFrameOf([id('rect-b')], SOURCE), {
      x: 200,
      y: 0,
      width: 100,
      height: 50,
      rotation: Math.PI / 2,
    });
  });

  it('is the axis-aligned box around every object for several, turned ones included', () => {
    // rect-a spans x 0–100, y 0–50; the turned rect-b spans x 150–200, y 0–100.
    expectBox(selectionFrameOf([id('rect-a'), id('rect-b')], SOURCE), {
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      rotation: 0,
    });
  });

  it('is undefined when nothing selected has geometry', () => {
    expect(selectionFrameOf([], SOURCE)).toBeUndefined();
    expect(selectionFrameOf([id('path-empty')], SOURCE)).toBeUndefined();
  });

  it('frames a connector by the route it draws between its targets', () => {
    // From rect-a's right side (100, 25) to rect-c's left side (420, 45).
    const route = { x: 100, y: 25, width: 320, height: 20, rotation: 0 };
    expectBox(selectionFrameOf([id('connector-k')], SOURCE), route);
    // With rect-a (x 0–100, y 0–50) it joins the axis-aligned frame.
    expectBox(selectionFrameOf([id('connector-k'), id('rect-a')], SOURCE), {
      x: 0,
      y: 0,
      width: 420,
      height: 50,
      rotation: 0,
    });
  });
});

describe('selectionBoxOf', () => {
  it('is orientedBoxOf for anything but a connector', () => {
    expect(selectionBoxOf(id('rect-b'), SOURCE)).toEqual(orientedBoxOf(id('rect-b'), SOURCE));
    expect(selectionBoxOf(id('gone'), SOURCE)).toBeUndefined();
  });

  it('places a connector’s route box through its own frame, curve handles included', () => {
    const objects = selectBoardObjects().map((object) =>
      object.id === id('connector-k')
        ? {
            ...object,
            x: 10,
            y: 5,
            from: { kind: 'point', x: 0, y: 0 },
            to: { kind: 'point', x: 100, y: 0 },
            route: 'curved',
          }
        : object,
    );
    const source = mapSource(objects as never);
    const box = selectionBoxOf(id('connector-k'), source);
    // Two free ends with no side to leave along: the curve's handles lie on the chord.
    expectBox(box, { x: 10, y: 5, width: 100, height: 0, rotation: 0 });
    expect(orientedBoxOf(id('connector-k'), source)).toBeUndefined();
  });

  it('leaves out a connector the engine does not draw', () => {
    const source = { ...SOURCE, isDrawable: (objectId: string) => objectId !== 'connector-k' };
    expect(selectionBoxOf(id('connector-k'), source)).toBeUndefined();
  });
});

describe('isAncestorOf', () => {
  it('finds parents and their parents, never the object itself or a sibling', () => {
    expect(isAncestorOf(id('group-g'), id('rect-e'), SOURCE)).toBe(true);
    expect(isAncestorOf(id('group-h'), id('rect-e'), SOURCE)).toBe(true);
    expect(isAncestorOf(id('frame-f'), id('rect-c'), SOURCE)).toBe(true);
    expect(isAncestorOf(id('rect-e'), id('rect-e'), SOURCE)).toBe(false);
    expect(isAncestorOf(id('rect-d'), id('rect-e'), SOURCE)).toBe(false);
    expect(isAncestorOf(id('frame-f'), id('rect-a'), SOURCE)).toBe(false);
  });

  it('stops at a parent cycle', () => {
    const loop = [
      { ...selectBoardObjects()[4], id: id('loop-a'), parentId: id('loop-b') },
      { ...selectBoardObjects()[4], id: id('loop-b'), parentId: id('loop-a') },
    ];
    const source = mapSource(loop as never);
    expect(isAncestorOf(id('loop-b'), id('loop-a'), source)).toBe(true);
    expect(isAncestorOf(id('rect-a'), id('loop-a'), source)).toBe(false);
  });
});

describe('selectTargetOf', () => {
  it('selects the outermost group around a hit, and a frame’s child itself', () => {
    expect(selectTargetOf(id('rect-e'), SOURCE)).toBe('group-g');
    expect(selectTargetOf(id('rect-c'), SOURCE)).toBe('rect-c');
    expect(selectTargetOf(id('gone'), SOURCE)).toBe('gone');
  });
});

describe('transformableIds and isResizable', () => {
  it('drops locked and missing objects and objects whose ancestor is selected too', () => {
    const ids = ['frame-f', 'rect-c', 'rect-locked', 'gone', 'rect-a'].map(id);
    expect(transformableIds(ids, SOURCE)).toEqual(['frame-f', 'rect-a']);
  });

  it('resizes only selections whose every movable object stores a box or is a group', () => {
    expect(isResizable([id('rect-a'), id('frame-f')], SOURCE)).toBe(true);
    // A group resize scales its descendants.
    expect(isResizable([id('rect-a'), id('group-g')], SOURCE)).toBe(true);
    expect(isResizable([id('group-g')], SOURCE)).toBe(true);
    expect(isResizable([id('rect-a'), id('line-l')], SOURCE)).toBe(false);
    expect(isResizable([id('line-l')], SOURCE)).toBe(false);
    expect(isResizable([id('rect-locked')], SOURCE)).toBe(false);
  });

  it('leaves out a group holding a locked object, which a locked child locks', () => {
    const source = mapSource([
      ...selectBoardObjects(),
      group('group-locked', null, 0, 900),
      rect('rect-free-child', 'group-locked', { x: 0, y: 0, width: 10, height: 10 }),
      group('group-inner-locked', 'group-locked', 50, 0),
      rect('rect-stuck', 'group-inner-locked', {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        isLocked: true,
      }),
    ]);
    expect(transformableIds([id('group-locked'), id('rect-a')], source)).toEqual([id('rect-a')]);
    expect(isResizable([id('group-locked')], source)).toBe(false);
    // Only transforms leave it out: a marquee keeps it (`unlockedTopmostIds`), and Delete is
    // told which groups it left (`groupsHoldingLocked`).
    const both = [id('group-locked'), id('rect-a')];
    expect(unlockedTopmostIds(both, source)).toEqual(both);
    expect(groupsHoldingLocked(both, source)).toEqual([id('group-locked')]);
  });

  it('offers only one axis’s handles for a lone group with no length along the other', () => {
    const source = mapSource([
      group('group-tall', null, 0, 0),
      rect('rect-tall', 'group-tall', { x: 0, y: 0, width: 0, height: 50 }),
      group('group-wide', null, 0, 100),
      rect('rect-wide', 'group-wide', { x: 0, y: 0, width: 50, height: 0 }),
      group('group-dot', null, 0, 200),
      rect('rect-dot', 'group-dot', { x: 0, y: 0, width: 0, height: 0 }),
      rect('rect-flat', null, { x: 0, y: 300, width: 0, height: 50 }),
    ]);
    expect(isResizable([id('group-tall')], source)).toBe('y');
    expect(isResizable([id('group-wide')], source)).toBe('x');
    expect(isResizable([id('group-dot')], source)).toBe(false);
    // A boxed object of zero width can still grow, and a multi-selection keeps all handles.
    expect(isResizable([id('rect-flat')], source)).toBe(true);
    expect(isResizable([id('group-tall'), id('group-wide')], source)).toBe(true);
  });

  it('never changes the objects it reads', () => {
    const objects = [Object.freeze(rect('r', null, { x: 1, y: 2, width: 3, height: 4 }))];
    const source = mapSource(objects);
    orientedBoxOf(id('r'), source);
    selectionFrameOf([id('r')], source);
    expect(objects[0]).toMatchObject({ x: 1, y: 2, width: 3, height: 4 });
  });
});
