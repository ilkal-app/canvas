// @vitest-environment jsdom
// CONTRACT: the voting cursor captures only primary presses on stickies; once
// turned off it restores the canvas cursor and no longer handles Escape.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

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

it('ignores a right press and a primary press on a non-sticky, then ignores Escape after turning off', () => {
  const { store } = voteBoardStore();
  const cast = vi.fn();
  const retract = vi.fn();
  const setCursorOn = vi.fn();
  const vote: BoardVote = {
    session: voteSession(),
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast,
    retract,
    finish: vi.fn(),
    isCursorOn: true,
    setCursorOn,
  };
  const tree = (isOn: boolean) => (
    <voteContext.Provider value={{ ...vote, isCursorOn: isOn }}>
      <div>
        <canvas style={{ cursor: 'grab' }} />
        <VoteCursor engine={ENGINE} store={store} />
      </div>
    </voteContext.Provider>
  );
  const view = render(tree(true));
  const canvas = view.container.querySelector('canvas');
  if (canvas === null) throw new Error('No canvas');
  const down = (x: number, y: number, button = 0) => {
    const reached = vi.fn();
    canvas.addEventListener('pointerdown', reached);
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button,
        clientX: x,
        clientY: y,
      }),
    );
    canvas.removeEventListener('pointerdown', reached);
    return reached;
  };
  expect(canvas.style.cursor).toBe('crosshair');
  expect(down(350, 150, 2)).toHaveBeenCalledOnce();
  // Inside the frame, but outside every sticky: a frame is not a vote target.
  expect(down(550, 380)).not.toHaveBeenCalled();
  expect(cast).not.toHaveBeenCalled();
  expect(retract).not.toHaveBeenCalled();
  view.rerender(tree(false));
  expect(canvas.style.cursor).toBe('grab');
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(setCursorOn).not.toHaveBeenCalled();
});
