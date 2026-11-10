// @vitest-environment jsdom
// Reactions over the board: placed where dropped, on the page shown, and a press on the
// board drops the armed emoji there.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { boardReactions } from './__fixtures__/board-reactions.js';
import { ReactionLayer } from './reaction-layer.js';
import { reactionsContext, type BoardReactions } from './reactions-context.js';

afterEach(cleanup);

const CAMERA: Camera = {
  x: 100,
  y: 50,
  zoom: 2,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

/**
 * An engine with a camera at (100, 50), zoom 2, on a page.
 *
 * @param page - The page shown; none for a board without pages.
 * @returns The engine.
 */
function engineOf(page?: string): MountedEngine {
  return {
    camera: () => CAMERA,
    ...(page === undefined ? {} : { pages: { current: () => page } }),
  } as unknown as MountedEngine;
}

/**
 * The layer in a canvas mount, under the board's reactions.
 *
 * @param reactions - The reactions.
 * @param engine - The engine.
 * @returns The canvas and the view.
 * @throws {Error} When the canvas is missing.
 */
function show(reactions: BoardReactions, engine: MountedEngine | undefined) {
  const tree = (value: BoardReactions) => (
    <div>
      <canvas />
      <reactionsContext.Provider value={value}>
        <ReactionLayer engine={engine} />
      </reactionsContext.Provider>
    </div>
  );
  const view = render(tree(reactions));
  const canvas = view.container.querySelector('canvas');
  if (canvas === null) throw new Error('No canvas.');
  return {
    canvas,
    view,
    rerender: (value: BoardReactions) => {
      view.rerender(tree(value));
    },
  };
}

/** Runs the pending animation frames. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe('ReactionLayer', () => {
  it('shows each reaction on the page shown where it was dropped, following the camera', async () => {
    show(
      boardReactions({
        shown: [
          { id: 1, emoji: '🎉', x: 150, y: 100, pageId: 'page-1', isOwn: false },
          { id: 2, emoji: '👀', x: 0, y: 0, pageId: 'page-2', isOwn: true },
        ],
      }),
      engineOf('page-1'),
    );
    await nextFrame();
    const spots = document.querySelectorAll<HTMLElement>('[data-reaction]');
    expect(spots).toHaveLength(1);
    // (150, 100) under a camera at (100, 50), zoom 2: (100, 100) on screen.
    expect([spots[0]?.textContent, spots[0]?.style.left, spots[0]?.style.top]).toEqual([
      '🎉',
      '100px',
      '100px',
    ]);
  });

  it('takes a board without pages as its one page, and drops on the page shown', async () => {
    const shownOnly = boardReactions({
      shown: [{ id: 1, emoji: '🙌', x: 100, y: 50, pageId: 'page-1', isOwn: true }],
    });
    show(shownOnly, engineOf());
    await nextFrame();
    expect(document.querySelectorAll('[data-reaction]')).toHaveLength(1);
    cleanup();
    const reactions = boardReactions({ armed: '😂' });
    const { canvas } = show(reactions, engineOf('page-2'));
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    fireEvent.pointerDown(canvas, { button: 0, clientX: 0, clientY: 0 });
    expect(reactions.drop).toHaveBeenCalledWith({ x: 100, y: 50, pageId: 'page-2' });
  });

  it('drops the armed emoji where the board is pressed, with a crosshair meanwhile', () => {
    const reactions = boardReactions({ armed: '👍' });
    const { canvas, rerender } = show(reactions, engineOf());
    expect(canvas.style.cursor).toBe('crosshair');
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    fireEvent.pointerDown(canvas, { button: 2, clientX: 0, clientY: 0 });
    expect(reactions.drop).not.toHaveBeenCalled();
    fireEvent.pointerDown(canvas, { button: 0, clientX: 210, clientY: 120 });
    // (200, 100) on screen under the camera: (200, 100) on the board, on the board's one page.
    expect(reactions.drop).toHaveBeenCalledWith({ x: 200, y: 100, pageId: 'page-1' });
    rerender(boardReactions());
    expect(canvas.style.cursor).toBe('');
  });

  it('gives the reactions the view’s centre while the engine runs, and takes it back', () => {
    const reactions = boardReactions();
    const { view } = show(reactions, engineOf('page-2'));
    const [[centre]] = vi.mocked(reactions.provideCentre).mock.calls as [
      [(() => unknown) | undefined],
    ];
    // The screen's centre (400, 300) under the camera: (300, 200) on the board.
    expect(centre?.()).toEqual({ x: 300, y: 200, pageId: 'page-2' });
    view.unmount();
    expect(reactions.provideCentre).toHaveBeenLastCalledWith(undefined);
  });

  it('shows nothing and drops nothing without the board’s reactions or an engine', () => {
    const { canvas } = show(boardReactions({ armed: '🤔' }), undefined);
    expect(canvas.style.cursor).toBe('');
    cleanup();
    render(<ReactionLayer engine={engineOf()} />);
    expect(document.querySelectorAll('[data-reaction]')).toHaveLength(0);
  });
});
