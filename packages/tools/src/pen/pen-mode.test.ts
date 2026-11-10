// The pen tool's state machine over a real document (the prototype's pen behaviour): each
// press is one command written on release, drags preview without writing, and the chain, closing,
// branching, inserting, Backspace, Enter and Escape follow the prototype.
import { describe, expect, it } from 'vitest';

import { closedLoops, indexNetwork } from '@canvas/engine';

import {
  click,
  createPenModeContext,
  drag,
  onlyPath,
  pointer,
} from './__fixtures__/pen-mode-context.js';
import { PenMode } from './pen-mode.js';
import { VectorEditMode } from './vector-edit-mode.js';
import { createPenMode } from './vector-modes.js';

const ZERO = { x: 0, y: 0 };

/**
 * A pen tool on an empty board.
 *
 * @returns The mode, the store and the record.
 */
function setUp() {
  const { store, context, record } = createPenModeContext();
  return { store, record, mode: createPenMode(context, { kind: 'create' }) };
}

/**
 * The vertices of the only path, as local `[x, y, mirror]`.
 *
 * @param store - The store.
 * @returns The vertices.
 */
function verticesOf(store: ReturnType<typeof setUp>['store']) {
  return onlyPath(store).vertices.map(({ x, y, mirror }) => [x, y, mirror]);
}

describe('PenMode: placing points', () => {
  it('holds the first click, creates the path with its first segment, then one command a click', () => {
    const { store, record, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    // The first point is shown (the chain's vertex, a solid square), not written.
    expect(store.read().objects.size).toBe(0);
    expect(record.changes).toHaveLength(0);
    expect(mode.overlay().toolRects).toHaveLength(1);
    click(mode, { x: 200, y: 100 });
    expect(onlyPath(store)).toMatchObject({ x: 100, y: 100, stroke: { width: 2 }, fill: null });
    expect(record.selected.at(-1)).toEqual([onlyPath(store).id]);
    click(mode, { x: 200, y: 150 });
    expect(record.changes).toHaveLength(2);
    expect(verticesOf(store)).toEqual([
      [0, 0, 'none'],
      [100, 0, 'none'],
      [100, 50, 'none'],
    ]);
    const path = onlyPath(store);
    expect(path.segments.map(({ a, b, ha, hb }) => [a, b, ha, hb])).toEqual([
      [path.vertices[0]?.id, path.vertices[1]?.id, ZERO, ZERO],
      [path.vertices[1]?.id, path.vertices[2]?.id, ZERO, ZERO],
    ]);
  });

  it('makes a smooth point on a click-drag: the incoming handle mirrors the drag', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    drag(mode, { x: 200, y: 100 }, { x: 230, y: 120 });
    const path = onlyPath(store);
    expect(path.vertices[1]?.mirror).toBe('both');
    expect(path.segments[0]?.hb).toEqual({ x: -30, y: -20 });
    // The outgoing handle is the next segment's start handle.
    click(mode, { x: 300, y: 200 });
    expect(onlyPath(store).segments[1]?.ha).toEqual({ x: 30, y: 20 });
  });

  it('breaks the mirror with Alt: only the outgoing handle follows', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    drag(mode, { x: 200, y: 100 }, { x: 230, y: 120 }, { isAlt: true });
    const path = onlyPath(store);
    expect(path.vertices[1]?.mirror).toBe('none');
    expect(path.segments[0]?.hb).toEqual(ZERO);
    click(mode, { x: 300, y: 200 });
    expect(onlyPath(store).segments[1]?.ha).toEqual({ x: 30, y: 20 });
  });

  it('keeps a Shift-placed point on a 45° step from the previous one', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 108 }, { isShift: true });
    const [, second] = onlyPath(store).vertices;
    expect(second?.y).toBeCloseTo(0, 9);
    expect(second?.x).toBeCloseTo(Math.hypot(100, 8), 9);
  });

  it('reads a press moved less than 3 px as a click, and 3 px as a drag', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    drag(mode, { x: 200, y: 100 }, { x: 202, y: 100 });
    expect(onlyPath(store).vertices[1]?.mirror).toBe('none');
    drag(mode, { x: 300, y: 100 }, { x: 303, y: 100 });
    expect(onlyPath(store).vertices[2]?.mirror).toBe('both');
  });

  it('previews a drag without writing, and a cancelled press writes nothing', () => {
    const { store, record, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    const before = store.encodeState();
    const draftId = mode.pathId;
    if (draftId === undefined) throw new Error('no draft');
    mode.onPointer(pointer('pointerDown', { x: 200, y: 100 }));
    mode.onPointer(pointer('pointerMove', { x: 240, y: 100 }));
    expect(store.encodeState()).toEqual(before);
    const previewed = record.previews.get(draftId);
    expect(previewed?.type === 'path' && previewed.vertices).toHaveLength(2);
    mode.onPointer({ kind: 'pointerCancel' });
    expect(record.previews.get(draftId)).toBeUndefined();
    expect(store.encodeState()).toEqual(before);
    click(mode, { x: 300, y: 100 });
    // The cancelled point never joined the chain: the chain still ends at the first vertex.
    expect(onlyPath(store).segments.map(({ a }) => a)).toEqual([onlyPath(store).vertices[0]?.id]);
  });
});

describe('PenMode: connecting, closing, branching, inserting', () => {
  it('closes a loop by clicking the chain’s start, which ends the chain', () => {
    const { store, mode } = setUp();
    for (const point of [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 101, y: 102 },
    ]) {
      click(mode, point);
    }
    const path = onlyPath(store);
    expect(path.vertices).toHaveLength(3);
    expect(closedLoops(indexNetwork(path))).toHaveLength(1);
    expect(mode.currentChain.vertexId).toBeUndefined();
  });

  it('closes by a drag that shapes the arriving handle, mirrored into a smooth start', () => {
    const { store, mode } = setUp();
    drag(mode, { x: 100, y: 100 }, { x: 100, y: 60 });
    click(mode, { x: 200, y: 100 });
    click(mode, { x: 150, y: 200 });
    drag(mode, { x: 100, y: 100 }, { x: 100, y: 130 });
    const path = onlyPath(store);
    const start = path.vertices[0];
    const closing = path.segments.find(({ b }) => b === start?.id);
    expect(closing?.hb).toEqual({ x: 0, y: -30 });
    // The start is smooth ('both'): its own handle mirrors the arriving one.
    expect(path.segments[0]?.ha).toEqual({ x: 0, y: 30 });
  });

  it('continues smoothly from an open smooth end, and branches from a middle vertex', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    drag(mode, { x: 200, y: 100 }, { x: 240, y: 100 });
    mode.onKey({ kind: 'enter' });
    // Continue from the smooth end: the new segment leaves opposite its handle.
    click(mode, { x: 200, y: 100 });
    click(mode, { x: 300, y: 150 });
    const continued = onlyPath(store).segments[1];
    expect(continued?.ha).toEqual({ x: 40, y: 0 });
    mode.onKey({ kind: 'enter' });
    click(mode, { x: 200, y: 100 });
    click(mode, { x: 200, y: 250 });
    const path = onlyPath(store);
    const junction = path.vertices[1]?.id;
    expect(path.segments.filter(({ a, b }) => a === junction || b === junction)).toHaveLength(3);
  });

  it('inserts a vertex on a segment without moving the curve and starts no chain', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 300, y: 100 });
    mode.onKey({ kind: 'escape' });
    click(mode, { x: 200, y: 101 });
    const path = onlyPath(store);
    expect(path.vertices).toHaveLength(3);
    expect(path.vertices[2]).toMatchObject({ y: 0, mirror: 'none' });
    expect(path.vertices[2]?.x).toBeCloseTo(100, 1);
    expect(path.segments).toHaveLength(2);
    expect(mode.currentChain.vertexId).toBeUndefined();
  });
});

describe('PenMode: keys', () => {
  it('Backspace removes the last vertex; a lone first point is held, not left in the document', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 100 });
    mode.onKey({ kind: 'delete' });
    // The path had one segment: it goes, and the pen holds its first point where it was.
    expect(store.read().objects.size).toBe(0);
    expect(mode.currentChain.vertexId).toBeDefined();
    click(mode, { x: 100, y: 200 });
    expect(onlyPath(store)).toMatchObject({ x: 100, y: 100 });
    expect(verticesOf(store)).toEqual([
      [0, 0, 'none'],
      [0, 100, 'none'],
    ]);
    mode.onKey({ kind: 'delete' });
    mode.onKey({ kind: 'delete' });
    expect(store.read().objects.size).toBe(0);
    expect(mode.currentChain.vertexId).toBeUndefined();
    // The pen stays: the next segment starts a new path.
    click(mode, { x: 50, y: 50 });
    click(mode, { x: 60, y: 50 });
    expect(onlyPath(store)).toMatchObject({ x: 50, y: 50 });
  });

  it('writes nothing for one click and Escape, so there is nothing to undo', () => {
    const { store, record, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    mode.onKey({ kind: 'escape' });
    expect(mode.currentChain.vertexId).toBeUndefined();
    mode.onKey({ kind: 'escape' });
    expect(store.read().objects.size).toBe(0);
    expect(record.changes).toHaveLength(0);
    expect(mode.pathId).toBeUndefined();
  });

  it('Enter ends the chain, then leaves the path; a lone point is dropped; Escape then exits', () => {
    const { store, record, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 100 });
    mode.onKey({ kind: 'enter' });
    expect(mode.currentChain.vertexId).toBeUndefined();
    click(mode, { x: 400, y: 400 });
    mode.onKey({ kind: 'enter' });
    mode.onKey({ kind: 'enter' });
    expect(onlyPath(store).vertices).toHaveLength(2);
    expect(mode.pathId).toBeUndefined();
    expect(record.exitRequests).toBe(0);
    mode.onKey({ kind: 'escape' });
    expect(record.exitRequests).toBe(1);
  });

  it('switches to vector edit on V only once the path has a segment', () => {
    const { mode } = setUp();
    expect(mode.onToolSwitch('select')).toBeUndefined();
    click(mode, { x: 100, y: 100 });
    expect(mode.onToolSwitch('select')).toBe(mode);
    click(mode, { x: 200, y: 100 });
    expect(mode.onToolSwitch('select')).toBeInstanceOf(VectorEditMode);
    expect(mode.onToolSwitch('text')).toBeUndefined();
  });

  it('refuses to draw on a path locked meanwhile, says so and ends', () => {
    const { store, record, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 100 });
    const { id } = onlyPath(store);
    store.transact({ kind: 'user', principalId: 'user:bob' as never }, (transaction) => {
      transaction.patchObject(id, { locked: true });
    });
    click(mode, { x: 200, y: 200 });
    expect(onlyPath(store).vertices).toHaveLength(2);
    expect(record.notices).toHaveLength(1);
    expect(record.exitRequests).toBe(1);
  });

  it('prunes stray vertices and drops a path without segments on exit', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    mode.exit();
    expect(store.read().objects.size).toBe(0);
    expect(mode).toBeInstanceOf(PenMode);
  });
});

describe('PenMode.abandon', () => {
  it('leaves a path as written, deleting none left without a segment', () => {
    const { store, mode } = setUp();
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 100 });
    const { id } = onlyPath(store);
    store.transact({ kind: 'user', principalId: 'user:bob' as never }, (transaction) => {
      transaction.patchObject(id, { segments: [] });
    });
    const before = store.read();
    mode.abandon();
    mode.abandon();
    expect(store.read()).toBe(before);
    mode.exit();
    expect(store.read()).toBe(before);
  });
});
