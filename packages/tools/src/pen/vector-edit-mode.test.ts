// Vector editing's move sub-tool over a real document (the prototype's edit mode): the test
// path sits at (100, 100) with v1 (0, 0), v2 (100, 0) smooth ('both', handles ∓30 along x) and v3
// (200, 0), so world = local + (100, 100).
import { describe, expect, it } from 'vitest';

import { editNetworkCommand, runCommand } from '@canvas/document';
import type { ObjectId, PrincipalId } from '@canvas/schema';

import {
  click,
  createPenModeContext,
  drag,
  onlyPath,
  pointer,
  squarePath,
  testPath,
} from './__fixtures__/pen-mode-context.js';
import { PenMode } from './pen-mode.js';
import { createVectorEditMode } from './vector-modes.js';

/**
 * Vector edit of a path on a board holding it.
 *
 * @param path - The path; the three-vertex chain if absent.
 * @returns The mode, the store and the record.
 */
function setUp(path = testPath()) {
  const { store, context, record } = createPenModeContext([path]);
  return { store, record, mode: createVectorEditMode(context, path.id) };
}

describe('VectorEditMode: selecting and moving', () => {
  it('selects the path, selects a vertex on a click, and moves it on a drag in one command', () => {
    const { store, record, mode } = setUp();
    expect(record.selected).toEqual([['path-1']]);
    click(mode, { x: 200, y: 100 });
    expect([...mode.selectedVertices]).toEqual(['v2']);
    const before = record.changes.length;
    drag(mode, { x: 200, y: 100 }, { x: 210, y: 130 });
    expect(record.changes.length - before).toBe(1);
    expect(onlyPath(store).vertices[1]).toMatchObject({ x: 110, y: 30 });
  });

  it('adds to the selection with Shift and moves every selected vertex', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 300, y: 100 }, { isShift: true });
    expect([...mode.selectedVertices].sort()).toEqual(['v1', 'v3']);
    drag(mode, { x: 300, y: 100 }, { x: 300, y: 120 });
    expect(onlyPath(store).vertices.map(({ y }) => y)).toEqual([20, 0, 20]);
    click(mode, { x: 300, y: 120 }, { isShift: true });
    expect([...mode.selectedVertices]).toEqual(['v1']);
  });

  it('moves a segment’s two vertices on a drag of the segment', () => {
    const { store, mode } = setUp();
    drag(mode, { x: 150, y: 101 }, { x: 150, y: 141 });
    expect(onlyPath(store).vertices.map(({ y }) => y)).toEqual([40, 40, 0]);
  });

  it('writes nothing for a click that does not drag', () => {
    const { record, mode } = setUp();
    const before = record.changes.length;
    click(mode, { x: 200, y: 100 });
    drag(mode, { x: 200, y: 100 }, { x: 202, y: 100 });
    expect(record.changes.length).toBe(before);
  });
});

describe('VectorEditMode: handles', () => {
  it('drags a selected vertex’s handle, mirrored by its mode, and breaks the mirror with Alt', () => {
    const { store, mode } = setUp();
    click(mode, { x: 200, y: 100 });
    drag(mode, { x: 230, y: 100 }, { x: 230, y: 140 });
    let [first, second] = onlyPath(store).segments;
    expect(second?.ha).toEqual({ x: 30, y: 40 });
    expect(first?.hb).toEqual({ x: -30, y: -40 });
    drag(mode, { x: 230, y: 140 }, { x: 250, y: 100 }, { isAlt: true });
    [first, second] = onlyPath(store).segments;
    expect(second?.ha).toEqual({ x: 50, y: 0 });
    expect(first?.hb).toEqual({ x: -30, y: -40 });
    expect(onlyPath(store).vertices[1]?.mirror).toBe('none');
  });

  it('toggles corner and smooth with Alt-click', () => {
    const { store, mode } = setUp();
    click(mode, { x: 200, y: 100 }, { isAlt: true });
    expect(onlyPath(store).vertices[1]?.mirror).toBe('none');
    expect(
      onlyPath(store)
        .segments.map(({ ha, hb }) => [ha, hb])
        .flat(),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
    click(mode, { x: 200, y: 100 }, { isAlt: true });
    expect(onlyPath(store).vertices[1]?.mirror).toBe('both');
    expect(onlyPath(store).segments[1]?.ha.x).toBeCloseTo(100 / 3, 9);
  });
});

describe('VectorEditMode: deleting and leaving', () => {
  it('Delete removes the selected vertices and their segments, Shift+Delete heals', () => {
    const gap = setUp();
    click(gap.mode, { x: 200, y: 100 });
    gap.mode.onKey({ kind: 'delete' });
    expect(gap.store.read().objects.size).toBe(0);
    expect(gap.record.exitRequests).toBe(1);
    const healed = setUp();
    click(healed.mode, { x: 200, y: 100 });
    healed.mode.onKey({ kind: 'delete', isHealing: true });
    const path = onlyPath(healed.store);
    expect(path.vertices.map(({ id }) => id)).toEqual(['v1', 'v3']);
    expect(path.segments).toHaveLength(1);
    expect(path.segments[0]).toMatchObject({ a: 'v1', b: 'v3' });
  });

  it('keeps the rest when one end is deleted', () => {
    const { store, mode } = setUp();
    click(mode, { x: 300, y: 100 });
    mode.onKey({ kind: 'delete' });
    expect(onlyPath(store).vertices.map(({ id }) => id)).toEqual(['v1', 'v2']);
  });

  it('clears the vertex selection inside the fill and ends on a click off the path', () => {
    const { mode } = setUp(squarePath());
    click(mode, { x: 100, y: 100 });
    expect(mode.selectedVertices.size).toBe(1);
    click(mode, { x: 150, y: 150 });
    expect(mode.selectedVertices.size).toBe(0);
    expect(mode.onPointer(pointer('pointerDown', { x: 400, y: 400 }))).toEqual({ isDone: true });
  });

  it('ends on a click inside a closed loop with no fill: only a painted fill is the path', () => {
    const { mode } = setUp({ ...squarePath(), fill: null });
    expect(mode.onPointer(pointer('pointerDown', { x: 150, y: 150 }))).toEqual({ isDone: true });
  });

  it('asks to end on Escape and Enter, and switches to the pen on P', () => {
    const { record, mode } = setUp();
    mode.onKey({ kind: 'escape' });
    mode.onKey({ kind: 'enter' });
    expect(record.exitRequests).toBe(2);
    expect(mode.onToolSwitch('pen')).toBeInstanceOf(PenMode);
    expect(mode.onToolSwitch('text')).toBeUndefined();
  });

  it('refuses to edit a locked path and says so', () => {
    const { store, record, mode } = setUp(testPath({ locked: true }));
    const before = store.encodeState();
    expect(mode.onPointer(pointer('pointerDown', { x: 200, y: 100 }))).toEqual({ isDone: true });
    expect(record.notices).toHaveLength(1);
    expect(store.encodeState()).toEqual(before);
  });

  it('drops a drag cancelled by a second finger', () => {
    const { store, mode } = setUp();
    click(mode, { x: 200, y: 100 });
    const before = store.encodeState();
    mode.onPointer(pointer('pointerDown', { x: 200, y: 100 }));
    mode.onPointer(pointer('pointerMove', { x: 240, y: 140 }));
    mode.onPointer({ kind: 'pointerCancel' });
    mode.onPointer(pointer('pointerUp', { x: 240, y: 140 }));
    expect(store.encodeState()).toEqual(before);
  });
});

describe('VectorEditMode: hover and cursor', () => {
  it('draws the segment under the pointer thicker and points over vertices and handles', () => {
    const { mode } = setUp();
    const hover = (x: number, y: number) => mode.onPointer(pointer('pointerMove', { x, y }));
    // The two 1 px lines of the skeleton, then the hovered segment's 2 px line over its own.
    const lineHeights = () =>
      (mode.overlay().toolRects ?? [])
        .filter(({ box }) => box.rotation === 0 && box.height <= 2)
        .map(({ box }) => [box.x, box.height]);
    expect(mode.cursor).toBe('default');
    hover(150, 102);
    expect(mode.cursor).toBe('move');
    expect(lineHeights()).toEqual([
      [100, 1],
      [200, 1],
      [100, 2],
    ]);
    // Over a vertex, the segment under it is not highlighted.
    hover(200, 101);
    expect(mode.cursor).toBe('pointer');
    expect(lineHeights()).toEqual([
      [100, 1],
      [200, 1],
    ]);
    // The selected smooth vertex's handle tip, 30 px to its right.
    click(mode, { x: 200, y: 100 });
    hover(230, 100);
    expect(mode.cursor).toBe('pointer');
    hover(260, 160);
    expect(mode.cursor).toBe('default');
  });

  it('shows move for the whole of a drag, from wherever it starts', () => {
    const { mode } = setUp();
    mode.onPointer(pointer('pointerDown', { x: 200, y: 100 }));
    expect(mode.cursor).toBe('default');
    mode.onPointer(pointer('pointerMove', { x: 240, y: 140 }));
    expect(mode.cursor).toBe('move');
    mode.onPointer(pointer('pointerUp', { x: 240, y: 140 }));
    expect(mode.cursor).toBe('default');
  });

  it('shows an unstroked, unfilled path by its segments while it is edited', () => {
    const { mode } = setUp(testPath({ stroke: null, fill: null }));
    const lines = (mode.overlay().toolRects ?? []).filter(({ box }) => box.height === 1);
    expect(lines.map(({ box }) => box.width)).toEqual([100, 100]);
  });
});

describe('VectorEditMode: a path with no segment', () => {
  it('shows its vertices while edited and deletes it on leaving', () => {
    const { store, mode } = setUp(testPath({ segments: [] }));
    // Three hollow vertex squares, no lines.
    expect(mode.overlay().toolRects).toHaveLength(6);
    mode.exit();
    expect(store.read().objects.size).toBe(0);
  });

  it('keeps it on leaving when a collaborator joined two of its vertices meanwhile', () => {
    const { store, record, mode } = setUp(testPath({ segments: [] }));
    const bob = { kind: 'user', principalId: 'user:bob' as PrincipalId } as const;
    const segment = { id: 'bob-s', a: 'v1', b: 'v2', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } };
    const input = { id: 'path-1', setSegments: [segment] };
    const environment = { clock: () => 1, createId: () => 'bob-id' as ObjectId };
    expect(runCommand(store, bob, editNetworkCommand, input, environment).status).toBe('applied');
    mode.exit();
    expect(onlyPath(store).segments).toEqual([segment]);
    expect(record.selected.at(-1)).toEqual(['path-1']);
  });

  it('ignores the pointer once the path is gone', () => {
    const { store, mode } = setUp();
    store.transact({ kind: 'user', principalId: 'user:bob' as never }, (transaction) => {
      transaction.deleteObject('path-1' as never);
    });
    mode.onPointer(pointer('pointerMove', { x: 150, y: 100 }));
    expect(mode.cursor).toBe('default');
  });
});

describe('VectorEditMode.abandon', () => {
  it('writes nothing, even for a path left without a segment', () => {
    const { store, mode } = setUp();
    store.transact({ kind: 'user', principalId: 'user:bob' as PrincipalId }, (transaction) => {
      transaction.patchObject('path-1' as ObjectId, { segments: [] });
    });
    const before = store.read();
    mode.abandon();
    mode.abandon();
    expect(store.read()).toBe(before);
  });
});
