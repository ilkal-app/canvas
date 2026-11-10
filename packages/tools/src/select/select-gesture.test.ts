import { describe, expect, it, vi } from 'vitest';

import { runCommand, setLockedCommand, type ChangeSet, type CommandError } from '@canvas/document';

import { id, indexOf, selectBoardObjects } from './__fixtures__/select-board.js';
import { ADA, createSelectStore, ENVIRONMENT, storeSource } from './__fixtures__/select-store.js';
import { SelectGesture, type TransformIntent } from './select-gesture.js';
import { createSelectHitTester } from './select-hit-tester.js';
import { selectionOf } from './selection-state.js';

// rect-a: 100 × 50 at (0, 0); rect-locked: 50 × 50 at (800, 0), locked.
const RECT_A_FRAME = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };

function setUp() {
  const store = createSelectStore();
  const changeSets: ChangeSet[] = [];
  store.subscribe((changes) => changeSets.push(changes));
  const refusals: (readonly CommandError[])[] = [];
  const document = storeSource(store);
  const gesture = new SelectGesture({
    store,
    document,
    origin: ADA,
    environment: ENVIRONMENT,
    hitTester: createSelectHitTester(indexOf(selectBoardObjects()), document),
    onCommandRefused: (errors) => refusals.push(errors),
  });
  return { store, gesture, changeSets, refusals };
}

const move = (x: number, y: number): TransformIntent => ({
  type: 'move',
  delta: { x, y },
  isAxisLocked: false,
});

describe('SelectGesture', () => {
  it('previews a move and its frame, writing nothing until the commit', () => {
    const { store, gesture, changeSets } = setUp();
    const selection = selectionOf([id('rect-a')]);
    expect(gesture.update(move(20, 10), selection, RECT_A_FRAME)).toEqual(['rect-a']);
    expect(gesture.previewOf(id('rect-a'))).toMatchObject({ x: 20, y: 10 });
    expect(gesture.frame).toEqual({ ...RECT_A_FRAME, x: 20, y: 10 });
    expect(changeSets).toEqual([]);
    expect(gesture.end(true, selection.ids)).toEqual(['rect-a']);
    expect(store.get(id('rect-a'))).toMatchObject({ x: 20, y: 10 });
    expect(changeSets).toHaveLength(1);
    expect(gesture.previewOf(id('rect-a'))).toBeUndefined();
    expect(gesture.frame).toBeUndefined();
  });

  it('writes nothing on cancel and drops the preview', () => {
    const { store, gesture, changeSets } = setUp();
    const selection = selectionOf([id('rect-a')]);
    gesture.update(move(20, 10), selection, RECT_A_FRAME);
    expect(gesture.end(false, selection.ids)).toEqual(['rect-a']);
    expect(store.get(id('rect-a'))).toMatchObject({ x: 0, y: 0 });
    expect(changeSets).toEqual([]);
  });

  it('previews nothing and keeps no frame for a locked selection', () => {
    const { gesture, changeSets } = setUp();
    const selection = selectionOf([id('rect-locked')]);
    const start = { x: 800, y: 0, width: 50, height: 50, rotation: 0 };
    expect(gesture.update(move(20, 10), selection, start)).toEqual([]);
    expect(gesture.frame).toBeUndefined();
    gesture.end(true, selection.ids);
    expect(changeSets).toEqual([]);
  });

  it('leaves out at commit an object a collaborator locked during the drag', () => {
    const { store, gesture, refusals } = setUp();
    const selection = selectionOf([id('rect-a'), id('rect-b')]);
    gesture.update(move(20, 0), selection, RECT_A_FRAME);
    runCommand(store, ADA, setLockedCommand, { ids: ['rect-a'], locked: true }, ENVIRONMENT);
    gesture.end(true, selection.ids);
    expect(store.get(id('rect-a'))).toMatchObject({ x: 0, y: 0 });
    expect(store.get(id('rect-b'))).toMatchObject({ x: 220, y: 0 });
    expect(refusals).toEqual([]);
  });

  it('outlines the frame a move would drop the selection into', () => {
    const { gesture } = setUp();
    // rect-a's centre (50, 25) moved by (400, 50) lands in frame-f (400–700, 0–200).
    gesture.update(move(400, 50), selectionOf([id('rect-a')]), RECT_A_FRAME);
    expect(gesture.dropTarget).toEqual({ x: 400, y: 0, width: 300, height: 200, rotation: 0 });
    gesture.update(move(0, 100), selectionOf([id('rect-a')]), RECT_A_FRAME);
    expect(gesture.dropTarget).toBeUndefined();
  });
});

it('retains root move membership and drops it on cancellation or ordinary fallback', () => {
  const { gesture } = setUp();
  const selection = selectionOf([id('rect-a')]);
  gesture.update(move(20, 10), selection, RECT_A_FRAME);
  const first = gesture.movePreview;
  if (!first) throw new Error('Expected a retained move');
  expect([...first.positions]).toEqual([20, 10]);
  gesture.update(move(30, 15), selection, RECT_A_FRAME);
  expect(gesture.movePreview?.ids).toBe(first.ids);
  expect(gesture.movePreview?.objects).toBe(first.objects);
  expect([...first.positions]).toEqual([20, 10]);
  expect(gesture.previewOf(id('rect-a'))).toMatchObject({ x: 30, y: 15 });
  expect(gesture.end(false, selection.ids)).toEqual(['rect-a']);
  expect(gesture.movePreview).toBeUndefined();
});

it('materializes retained positions without changing their picture before an ordinary update', () => {
  const { gesture } = setUp();
  gesture.update(move(20, 10), selectionOf([id('rect-a')]), RECT_A_FRAME);
  const before = gesture.previewOf(id('rect-a'));
  expect(gesture.materializeMove()).toEqual(['rect-a']);
  expect(gesture.movePreview).toBeUndefined();
  expect(gesture.previewOf(id('rect-a'))).toBe(before);
  expect(gesture.end(false, [id('rect-a')])).toEqual(['rect-a']);
});

it('keeps the retained session when an active move returns to its unchanged origin', () => {
  const { gesture, changeSets } = setUp();
  const selection = selectionOf([id('rect-a')]);
  gesture.update(move(20, 10), selection, RECT_A_FRAME);
  const first = gesture.movePreview;
  if (!first) throw new Error('Expected a retained move');
  gesture.update(move(0, 0), selection, RECT_A_FRAME);
  expect(gesture.movePreview?.ids).toBe(first.ids);
  expect(gesture.previewOf(id('rect-a'))).toMatchObject({ x: 0, y: 0 });
  expect(gesture.end(true, selection.ids)).toEqual(['rect-a']);
  expect(gesture.movePreview).toBeUndefined();
  expect(changeSets).toEqual([]);
});

it('does not retain stale membership when a collaborator locks an object before origin return', () => {
  const { gesture, store } = setUp();
  const selection = selectionOf([id('rect-a')]);
  gesture.update(move(20, 10), selection, RECT_A_FRAME);
  runCommand(store, ADA, setLockedCommand, { ids: ['rect-a'], locked: true }, ENVIRONMENT);
  gesture.update(move(0, 0), selection, RECT_A_FRAME);
  expect(gesture.movePreview).toBeUndefined();
});

it('copies unchanged retained membership once without rebuilding a union', () => {
  const { gesture } = setUp();
  const selection = selectionOf([id('rect-a')]);
  gesture.update(move(20, 10), selection, RECT_A_FRAME);
  const first = gesture.movePreview;
  if (!first) throw new Error('Expected a retained move');
  const iterator = vi.spyOn(first.ids, Symbol.iterator);
  const changed = gesture.update(move(30, 15), selection, RECT_A_FRAME);
  const reads = iterator.mock.calls.length;
  iterator.mockRestore();
  expect(reads).toBe(1);
  expect(changed).toEqual(first.ids);
  expect(changed).not.toBe(first.ids);
  expect(gesture.previewOf(id('rect-a'))).toMatchObject({ x: 30, y: 15 });
});
