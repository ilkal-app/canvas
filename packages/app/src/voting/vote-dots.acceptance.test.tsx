// @vitest-environment jsdom
// CONTRACT: vote dots track the camera in CSS pixels at non-unit zoom, and
// disappear with an ended session. Revealed dots are read-only for every role.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import type { Camera } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import type { MountedEngine } from '../engine/mounted-engine.js';

import { voteSession } from './__fixtures__/vote-session.js';
import { voteContext, type BoardVote } from './vote-context.js';
import { VoteDots } from './vote-dots.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('places the rightmost dot from worldToScreen at zoom 2 and follows a camera move', () => {
  let nextFrame: FrameRequestCallback | undefined;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let camera: Camera = {
    x: 25,
    y: 40,
    zoom: 2,
    viewportWidthPx: 800,
    viewportHeightPx: 600,
    dpr: 1,
  };
  const sticky = {
    id: 'a',
    type: 'sticky',
    parentId: null,
    x: 100,
    y: 150,
    width: 200,
    height: 200,
    rotation: 0,
  } as BoardObject;
  const engine = {
    camera: () => camera,
    board: {
      board: { get: (id: ObjectId) => (id === 'a' ? sticky : undefined) },
      isMoving: () => false,
    },
  } as unknown as MountedEngine;
  const vote: BoardVote = {
    session: voteSession({ myVotes: ['a'] }),
    canVote: true,
    notice: undefined,
    start: vi.fn(),
    cast: vi.fn(),
    retract: vi.fn(),
    finish: vi.fn(),
  };
  render(
    <voteContext.Provider value={vote}>
      <VoteDots engine={engine} />
    </voteContext.Provider>,
  );
  const dots = screen.getByRole('button', { name: 'Your 1 vote: take one back' });
  expect([dots.style.left, dots.style.top]).toEqual(['542px', '610px']);
  act(() => {
    camera = { ...camera, x: 50, y: 60 };
    nextFrame?.(0);
  });
  expect([dots.style.left, dots.style.top]).toEqual(['492px', '570px']);
  cleanup();
  render(
    <voteContext.Provider value={{ ...vote, session: null }}>
      <VoteDots engine={engine} />
    </voteContext.Provider>,
  );
  expect(document.querySelector('[data-vote-dots-for]')).toBeNull();
});

it('shows a commenter the revealed total as a noninteractive image', () => {
  const camera: Camera = {
    x: 0,
    y: 0,
    zoom: 1,
    viewportWidthPx: 800,
    viewportHeightPx: 600,
    dpr: 1,
  };
  const sticky = {
    id: 'a',
    type: 'sticky',
    parentId: null,
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
  } as BoardObject;
  const engine = {
    camera: () => camera,
    board: { board: { get: () => sticky } },
  } as unknown as MountedEngine;
  const vote: BoardVote = {
    session: voteSession({
      status: 'revealed',
      myVotes: [],
      results: [{ objectId: 'a', count: 2 }],
    }),
    canVote: false,
    notice: undefined,
    start: vi.fn(),
    cast: vi.fn(),
    retract: vi.fn(),
    finish: vi.fn(),
  };
  render(
    <voteContext.Provider value={vote}>
      <VoteDots engine={engine} />
    </voteContext.Provider>,
  );
  expect(screen.getByRole('img', { name: '2 votes' })).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
