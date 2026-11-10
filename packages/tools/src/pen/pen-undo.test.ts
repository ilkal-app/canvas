// Undo and redo of the pen and vector edit over a real document and its history (fix
// round 2): each press is one undo step, and undo and redo walk those steps both ways, again
// after a round trip (an undo or redo re-creates a network member that the next step must be
// able to remove, which the undo guard allows since).
import { describe, expect, it } from 'vitest';

import { createHistory } from '@canvas/document';

import {
  ADA,
  click,
  createPenModeContext,
  onlyPath,
  testPath,
} from './__fixtures__/pen-mode-context.js';
import { createPenMode, createVectorEditMode } from './vector-modes.js';

/**
 * The shape of the only path on a board: its vertex and segment counts.
 *
 * @param store - The store.
 * @returns `[vertices, segments]`, or `undefined` when the board holds no path.
 */
function shapeOf(store: ReturnType<typeof createPenModeContext>['store']) {
  if (store.read().objects.size === 0) return undefined;
  const path = onlyPath(store);
  return [path.vertices.length, path.segments.length];
}

describe('undo and redo of the pen', () => {
  it('undoes the third point of a drawn path', () => {
    const { store, context } = createPenModeContext();
    const history = createHistory(store, ADA.principalId);
    const mode = createPenMode(context, { kind: 'create' });
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 100 });
    click(mode, { x: 200, y: 200 });
    mode.exit();
    expect(shapeOf(store)).toEqual([3, 2]);
    history.undo();
    expect(shapeOf(store)).toEqual([2, 1]);
    history.redo();
    expect(shapeOf(store)).toEqual([3, 2]);
  });

  it('undoes the third point again after an undo and a redo', () => {
    const { store, context } = createPenModeContext();
    const history = createHistory(store, ADA.principalId);
    const mode = createPenMode(context, { kind: 'create' });
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 100 });
    click(mode, { x: 200, y: 200 });
    mode.exit();
    history.undo();
    history.redo();
    history.undo();
    expect(shapeOf(store)).toEqual([2, 1]);
  });

  /**
   * Draws three points, then Backspace and a click elsewhere.
   *
   * @returns The store, its history, and the path before the Backspace and after the click.
   */
  function backspaceAndClick() {
    const { store, context } = createPenModeContext();
    const history = createHistory(store, ADA.principalId);
    const mode = createPenMode(context, { kind: 'create' });
    click(mode, { x: 100, y: 100 });
    click(mode, { x: 200, y: 100 });
    click(mode, { x: 200, y: 200 });
    const drawn = onlyPath(store);
    mode.onKey({ kind: 'delete' });
    click(mode, { x: 300, y: 300 });
    return { store, history, drawn, after: onlyPath(store) };
  }

  it('undoes a Backspace and the click after it', () => {
    const { store, history, drawn } = backspaceAndClick();
    history.undo();
    history.undo();
    expect(onlyPath(store)).toEqual(drawn);
  });

  it('redoes both after undoing them', () => {
    const { store, history, after } = backspaceAndClick();
    history.undo();
    history.undo();
    history.redo();
    history.redo();
    expect(onlyPath(store)).toEqual(after);
  });
});

describe('undo and redo of vector edit', () => {
  it('undoes a vertex delete', () => {
    const { store, context } = createPenModeContext([testPath()]);
    const history = createHistory(store, ADA.principalId);
    const mode = createVectorEditMode(context, testPath().id);
    click(mode, { x: 300, y: 100 });
    mode.onKey({ kind: 'delete' });
    expect(shapeOf(store)).toEqual([2, 1]);
    history.undo();
    // Placement is written as one group, so the path's page is now stored: page 1.
    expect(onlyPath(store)).toEqual({ ...testPath(), pageId: 'page-1' });
  });

  it('redoes a vertex delete it undid', () => {
    const { store, context } = createPenModeContext([testPath()]);
    const history = createHistory(store, ADA.principalId);
    const mode = createVectorEditMode(context, testPath().id);
    click(mode, { x: 300, y: 100 });
    mode.onKey({ kind: 'delete' });
    history.undo();
    history.redo();
    expect(shapeOf(store)).toEqual([2, 1]);
  });

  it('undoes leaving a path with no segment, which deleted it', () => {
    const lone = testPath({ segments: [] });
    const { store, context } = createPenModeContext([lone]);
    const history = createHistory(store, ADA.principalId);
    const mode = createVectorEditMode(context, lone.id);
    mode.exit();
    expect(store.read().objects.size).toBe(0);
    history.undo();
    // Undo writes the path back with its placement, the page it was on included.
    expect(onlyPath(store)).toEqual({ ...lone, pageId: 'page-1' });
  });
});
