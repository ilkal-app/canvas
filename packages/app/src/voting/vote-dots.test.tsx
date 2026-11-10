// @vitest-environment jsdom
// The dots on voted stickies (the design's frame B).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { voteSession } from './__fixtures__/vote-session.js';
import { voteContext, type BoardVote } from './vote-context.js';
import { VoteDots } from './vote-dots.js';

afterEach(cleanup);

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };

/**
 * A sticky 200 px square at a place.
 *
 * @param id - Its id.
 * @param x - Its left.
 * @returns The sticky.
 */
function sticky(id: string, x: number): BoardObject {
  return {
    id,
    type: 'sticky',
    parentId: null,
    x,
    y: 100,
    width: 200,
    height: 200,
    rotation: 0,
  } as unknown as BoardObject;
}

/**
 * An engine over two stickies and a shape, with one sticky being dragged if asked.
 *
 * @param moving - The id the person's gesture moves, if any.
 * @returns The engine.
 */
function engineOf(moving?: string): MountedEngine {
  const objects = new Map<string, BoardObject>([
    ['a', sticky('a', 0)],
    ['b', sticky('b', 300)],
    ['dragged', sticky('dragged', 600)],
    ['box', { ...sticky('box', 0), type: 'shape' } as unknown as BoardObject],
  ]);
  return {
    camera: () => CAMERA,
    board: {
      board: { get: (id: ObjectId) => objects.get(id) },
      isMoving: (id: ObjectId) => id === moving,
    },
  } as unknown as MountedEngine;
}

/**
 * The layer under a board's vote.
 *
 * @param vote - What differs from an editor's open hidden vote.
 * @param engine - The engine.
 * @returns The retract spy.
 */
function show(vote: Partial<BoardVote>, engine: MountedEngine | undefined = engineOf()) {
  const retract = vi.fn();
  const value: BoardVote = {
    session: voteSession(),
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast: vi.fn(),
    retract,
    finish: vi.fn(),
    ...vote,
  };
  render(
    <voteContext.Provider value={value}>
      <VoteDots engine={engine} />
    </voteContext.Provider>,
  );
  return retract;
}

describe('VoteDots', () => {
  it('puts the person’s own dots inside a sticky’s bottom-right corner, each taking one back', () => {
    const retract = show({ session: voteSession({ myVotes: ['a', 'a', 'gone', 'box'] }) });
    const dots = screen.getByRole('button', { name: 'Your 2 votes: take one back' });
    // The sticky's corner is at (200, 300): the dots end 8 px in and sit 10 px up.
    expect([dots.style.left, dots.style.top]).toEqual(['192px', '290px']);
    expect(dots.querySelectorAll('[data-vote-dot]')).toHaveLength(2);
    fireEvent.click(dots);
    expect(retract).toHaveBeenCalledWith('a');
    // A deleted object and anything but a sticky show none.
    expect(document.querySelectorAll('[data-vote-dots-for]')).toHaveLength(1);
  });

  it('shows everyone’s results once seen, five dots and the rest as a count', () => {
    show(
      {
        session: voteSession({
          status: 'revealed',
          results: [
            { objectId: 'b', count: 7 },
            { objectId: 'a', count: 1 },
            { objectId: 'dragged', count: 2 },
          ],
        }),
      },
      engineOf('dragged'),
    );
    const many = screen.getByRole('img', { name: '7 votes' });
    expect(many.querySelectorAll('[data-vote-dot]')).toHaveLength(5);
    expect(many.textContent).toBe('+2');
    expect(screen.getByRole('img', { name: '1 vote' })).toBeTruthy();
    // A sticky under the person's drag shows none until the drop.
    expect(screen.queryByRole('img', { name: '2 votes' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a viewer the dots without taking any back, and nothing without a vote', () => {
    show({
      canVote: false,
      session: voteSession({ isHidden: false, results: [{ objectId: 'a', count: 1 }] }),
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img', { name: '1 vote' })).toBeTruthy();
    cleanup();
    show({ session: null });
    expect(document.querySelector('[data-vote-dots]')).toBeNull();
    cleanup();
    render(<VoteDots engine={engineOf()} />);
    expect(document.querySelector('[data-vote-dots]')).toBeNull();
  });

  it('follows the camera every frame, and stops when unmounted', async () => {
    const frames = vi.spyOn(window, 'cancelAnimationFrame');
    show({ session: voteSession({ myVotes: ['a'] }) });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    cleanup();
    expect(frames).toHaveBeenCalled();
  });
});
