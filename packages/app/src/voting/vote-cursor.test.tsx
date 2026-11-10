// @vitest-environment jsdom
// The voting cursor: a press on a sticky votes for it, ⌥ takes one back.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import { DEFAULT_PAGE_ID } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { voteBoardStore } from './__fixtures__/vote-board.js';
import { voteSession } from './__fixtures__/vote-session.js';
import { voteContext, type BoardVote } from './vote-context.js';
import { VoteCursor } from './vote-cursor.js';

afterEach(cleanup);

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

const ENGINE = {
  camera: () => CAMERA,
  pages: { current: () => DEFAULT_PAGE_ID },
} as unknown as MountedEngine;

/**
 * The cursor beside a canvas, under a board's vote.
 *
 * @param fields - What differs from an editor's open vote with the cursor on.
 * @returns The canvas, the vote's spies and a rerender.
 * @throws {Error} When the canvas is missing.
 */
function show(fields: Partial<BoardVote> = {}) {
  const { store } = voteBoardStore();
  const vote = (more: Partial<BoardVote>): BoardVote => ({
    session: voteSession(),
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast: vi.fn(),
    retract: vi.fn(),
    finish: vi.fn(),
    isCursorOn: true,
    setCursorOn: vi.fn(),
    ...more,
  });
  const tree = (value: BoardVote) => (
    <voteContext.Provider value={value}>
      <div>
        <canvas />
        <VoteCursor engine={ENGINE} store={store} />
      </div>
    </voteContext.Provider>
  );
  const value = vote(fields);
  const view = render(tree(value));
  const canvas = view.container.querySelector('canvas');
  if (canvas === null) throw new Error('No canvas.');
  return {
    canvas,
    value,
    rerender: (more: Partial<BoardVote>) => {
      const next = vote(more);
      view.rerender(tree(next));
      return next;
    },
  };
}

/**
 * Presses the canvas at a point.
 *
 * @param canvas - The canvas.
 * @param x - Across, CSS px.
 * @param y - Down.
 * @param init - The modifiers and button.
 * @returns Whether the press went on to the canvas's own handlers.
 */
function press(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  init: MouseEventInit = {},
): boolean {
  const reached = vi.fn();
  canvas.addEventListener('pointerdown', reached);
  canvas.dispatchEvent(
    new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      ...init,
    }),
  );
  canvas.removeEventListener('pointerdown', reached);
  return reached.mock.calls.length > 0;
}

describe('VoteCursor', () => {
  it('votes for the sticky pressed, takes one back with ⌥, and keeps the press from the canvas', () => {
    const { canvas, value } = show();
    expect(canvas.style.cursor).toBe('crosshair');
    expect(press(canvas, 350, 150)).toBe(false);
    expect(value.cast).toHaveBeenCalledWith('over');
    press(canvas, 50, 50, { altKey: true });
    expect(value.retract).toHaveBeenCalledWith('inside');
  });

  it('does nothing on empty board, or for another button', () => {
    const { canvas, value } = show();
    press(canvas, 550, 380);
    press(canvas, 350, 150, { button: 2 });
    expect(value.cast).not.toHaveBeenCalled();
  });

  it('turns off on Escape', () => {
    const { value } = show();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(value.setCursorOn).toHaveBeenCalledWith(false);
  });

  it('leaves the canvas alone while off', () => {
    const { canvas, rerender } = show({ isCursorOn: false });
    expect(canvas.style.cursor).toBe('');
    expect(press(canvas, 350, 150)).toBe(true);
    const on = rerender({ isCursorOn: true });
    expect(canvas.style.cursor).toBe('crosshair');
    press(canvas, 350, 150);
    expect(on.cast).toHaveBeenCalledWith('over');
    rerender({ isCursorOn: false });
    expect(canvas.style.cursor).toBe('');
  });
});
