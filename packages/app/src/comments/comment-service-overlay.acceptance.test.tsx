// CONTRACT: the overlay draws service pins on their stored page without a document comment object.
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { DEFAULT_PAGE_ID } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import type { Thread } from './comment-api.js';
import { commentContext } from './comment-context.js';
import { commentDataContext, type CommentData } from './comment-data-context.js';
import { CommentOverlay } from './comment-overlay.js';

beforeEach(() => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const thread: Thread = {
  id: 'service-thread',
  pinId: 'missing-document-pin',
  isResolved: false,
  pin: { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' }, point: { x: 50, y: 60 } },
  messages: [
    {
      id: 'message',
      authorId: 'other',
      authorName: 'Other',
      text: 'Service pin',
      mentions: [],
      createdAt: new Date(0).toISOString(),
    },
  ],
};

it('shows the pin on its page and hides it on another page', () => {
  const connection = new FakeBoardConnection('board');
  const data = {
    connection,
    user: FAKE_PERSON,
    members: [],
    threads: [thread],
    selectedId: undefined,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard: true,
    deleteThread: vi.fn(),
    change: vi.fn(),
    refresh: vi.fn(),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
  } satisfies CommentData;
  const mode = {
    canWrite: true,
    isPlacing: false,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  const engine = (page: string) =>
    ({
      camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 }),
      pages: { current: () => page, subscribe: () => () => undefined },
    }) as unknown as MountedEngine;
  const view = render(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={data}>
        <canvas />
        <CommentOverlay engine={engine(DEFAULT_PAGE_ID)} />
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  expect(screen.getByRole('button', { name: 'Comment thread: Service pin' })).toBeDefined();
  view.rerender(
    <commentContext.Provider value={mode}>
      <commentDataContext.Provider value={data}>
        <canvas />
        <CommentOverlay engine={engine('other-page')} />
      </commentDataContext.Provider>
    </commentContext.Provider>,
  );
  expect(screen.queryByRole('button', { name: 'Comment thread: Service pin' })).toBeNull();
  connection.store.destroy();
});
