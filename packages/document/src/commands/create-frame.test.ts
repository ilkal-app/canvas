import { describe, expect, it } from 'vitest';

import { ADA_ID } from '../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../history/undo-manager.js';
import { sortedSiblings } from '../z-order/sibling-order.js';

import { boardPlacement, expectSamePlacement } from './__fixtures__/board-geometry.js';
import {
  applyCommand,
  expectDiff,
  expectRejected,
  mustGet,
  NOW,
} from './__fixtures__/command-fixtures.js';
import { createNestedFramesStore } from './__fixtures__/nested-frames.js';
import { createFrameCommand } from './create-frame.js';
import { COMMANDS } from './registry.js';

// `createFrame`: the frame tool's one command, creating a frame and taking the
// objects drawn over into it, as one transaction and one undo step.

const closeTo = (actual: number, expected: number) => {
  expect(actual).toBeCloseTo(expected, 9);
};

/**
 * A frame's own fields, as the frame tool sends them.
 *
 * @param fields - Fields to change.
 * @returns The fields.
 */
function frameInput(fields: Record<string, unknown> = {}) {
  return {
    type: 'frame' as const,
    id: 'frame-new',
    x: 550,
    y: 350,
    width: 200,
    height: 200,
    name: 'Frame 1',
    clip: false,
    background: [1, 1, 1, 1] as [number, number, number, number],
    ...fields,
  };
}

describe('createFrame', () => {
  it('is registered under its name', () => {
    expect(COMMANDS.createFrame).toBe(createFrameCommand);
  });

  it('creates a frame on top of its parent, stamped by the origin and the clock', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, createFrameCommand, { frame: frameInput() });
    expect(result).toEqual({ id: 'frame-new', childIds: [] });
    expectDiff(before, store.read(), changes, { created: ['frame-new'] });
    const frame = mustGet(store, 'frame-new');
    expect(frame).toMatchObject({
      type: 'frame',
      parentId: null,
      name: 'Frame 1',
      createdBy: 'user:ada',
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(sortedSiblings(store, null).at(-1)).toBe('frame-new');
  });

  it('takes objects in without moving them on the board, in the order they were painted', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    const { result, changes } = applyCommand(store, createFrameCommand, {
      frame: frameInput({ x: 500, y: 300, width: 800, height: 400, rotation: 0.3 }),
      childIds: ['rect-free', 'frame-side'],
    });
    expect(result).toEqual({ id: 'frame-new', childIds: ['rect-free', 'frame-side'] });
    expectDiff(before, store.read(), changes, {
      created: ['frame-new'],
      updated: ['rect-free', 'frame-side'],
    });
    const after = store.read();
    for (const id of ['rect-free', 'frame-side', 'rect-side']) {
      expectSamePlacement(boardPlacement(after, id), boardPlacement(before, id), closeTo);
    }
    expect(mustGet(store, 'rect-free').parentId).toBe('frame-new');
    expect(mustGet(store, 'frame-side').parentId).toBe('frame-new');
    // frame-side (z a1) was painted below rect-free (z a2) on the root, and still is.
    expect(sortedSiblings(store, result.id)).toEqual(['frame-side', 'rect-free']);
  });

  it('takes objects of a turned parent frame into a frame created inside it', () => {
    const store = createNestedFramesStore();
    const before = store.read();
    applyCommand(store, createFrameCommand, {
      frame: frameInput({ parentId: 'frame-outer', x: 200, y: 150, rotation: -0.4 }),
      childIds: ['rect-outer'],
    });
    const after = store.read();
    expect(mustGet(store, 'rect-outer').parentId).toBe('frame-new');
    expect(mustGet(store, 'frame-new').parentId).toBe('frame-outer');
    expectSamePlacement(
      boardPlacement(after, 'rect-outer'),
      boardPlacement(before, 'rect-outer'),
      closeTo,
    );
  });

  it('is one undo step that removes the frame and puts every object back exactly', () => {
    const store = createNestedFramesStore();
    const history = createHistory(store, ADA_ID);
    const before = new Map(store.read().objects);
    applyCommand(store, createFrameCommand, {
      frame: frameInput({ width: 800, height: 600 }),
      childIds: ['rect-free', 'frame-side'],
    });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(new Map(store.read().objects)).toEqual(before);
  });

  it('refuses, writing nothing, children that are missing, listed twice, locked or grouped', () => {
    const store = createNestedFramesStore();
    const errors = expectRejected(store, createFrameCommand, {
      frame: frameInput(),
      childIds: ['gone', 'rect-free', 'rect-free', 'rect-locked'],
    });
    expect(errors.map((error) => [error.code, error.objectId, error.path])).toEqual([
      ['missing-object', 'gone', ['childIds', 0]],
      ['duplicate-id', 'rect-free', ['childIds', 2]],
    ]);
    const locked = expectRejected(store, createFrameCommand, {
      frame: frameInput(),
      childIds: ['rect-locked'],
    });
    expect(locked.map((error) => [error.code, error.objectId])).toEqual([
      ['locked', 'rect-locked'],
    ]);
    const grouped = expectRejected(store, createFrameCommand, {
      frame: frameInput(),
      childIds: ['rect-grouped'],
    });
    expect(grouped.map((error) => [error.code, error.objectId])).toEqual([
      ['invalid-parent', 'rect-grouped'],
    ]);
  });

  it('refuses an object listed with its ancestor, and the frame’s own parent', () => {
    const store = createNestedFramesStore();
    const nested = expectRejected(store, createFrameCommand, {
      frame: frameInput(),
      childIds: ['frame-side', 'rect-side'],
    });
    expect(nested.map((error) => [error.code, error.objectId])).toEqual([
      ['overlapping-selection', 'rect-side'],
    ]);
    const cycle = expectRejected(store, createFrameCommand, {
      frame: frameInput({ parentId: 'frame-outer' }),
      childIds: ['frame-outer'],
    });
    expect(cycle.map((error) => [error.code, error.objectId])).toEqual([
      ['parent-cycle', 'frame-outer'],
    ]);
  });

  it('refuses a frame that cannot be created: an id in use, a missing parent, a bad field', () => {
    const store = createNestedFramesStore();
    const taken = expectRejected(store, createFrameCommand, {
      frame: frameInput({ id: 'rect-free' }),
    });
    expect(taken.map((error) => [error.code, error.path])).toEqual([
      ['duplicate-id', ['frame', 'id']],
    ]);
    const orphan = expectRejected(store, createFrameCommand, {
      frame: frameInput({ parentId: 'gone' }),
    });
    expect(orphan.map((error) => error.code)).toEqual(['missing-parent']);
    const long = expectRejected(store, createFrameCommand, {
      frame: frameInput({ name: 'x'.repeat(201) }),
    });
    expect(long.map((error) => error.code)).toEqual(['invalid-input']);
  });

  it('generates the frame id when none is given', () => {
    const store = createNestedFramesStore();
    const { id, ...frame } = frameInput();
    const { result } = applyCommand(store, createFrameCommand, { frame });
    expect(result.id).not.toBe(id);
    expect(mustGet(store, result.id).type).toBe('frame');
  });
});
