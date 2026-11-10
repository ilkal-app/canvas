// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addPageCommand, runCommand } from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { FAKE_PERSON, FakeMemberDirectory } from './__fixtures__/fake-member-directory.js';
import { commentRequest, type Thread } from './comment-api.js';
import { commentDataContext } from './comment-data-context.js';
import { CommentOverlay } from './comment-overlay.js';
import { placeThreadPin } from './comment-placement.js';
import { CommentProvider } from './comment-provider.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
beforeEach(() => {
  vi.mocked(commentRequest).mockReset();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

function Selection() {
  const data = useContext(commentDataContext);
  return (
    <>
      <output data-testid="selected-thread">{data?.selectedId ?? ''}</output>
      <output data-testid="loaded-threads">{data?.threads.length ?? 0}</output>
    </>
  );
}

function open(
  threadId: string,
  threads: Thread[],
  engine?: MountedEngine,
  existingConnection?: FakeBoardConnection,
) {
  window.history.replaceState(
    null,
    '',
    `/b/${'A'.repeat(22)}?thread=${encodeURIComponent(threadId)}`,
  );
  vi.mocked(commentRequest).mockResolvedValue({ threads });
  const connection = existingConnection ?? new FakeBoardConnection('A'.repeat(22));
  const view = render(
    <CommentProvider
      connection={connection}
      boardId={'A'.repeat(22)}
      user={FAKE_PERSON}
      client={new FakeMemberDirectory()}
      onSessionError={() => false}
    >
      <Selection />
      {engine === undefined ? null : <CommentOverlay engine={engine} />}
    </CommentProvider>,
  );
  return { ...view, connection };
}

describe('board comment deep link', () => {
  it('selects the requested thread once the service loads it', async () => {
    const { connection } = open('thread-a', [
      { id: 'thread-a', pinId: 'pin-a', isResolved: false, messages: [] },
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('selected-thread').textContent).toBe('thread-a');
    });
    connection.store.destroy();
  });

  it('shows the linked thread’s page before opening its card', async () => {
    const connection = new FakeBoardConnection('A'.repeat(22));
    runCommand(
      connection.store,
      connection.origin,
      addPageCommand,
      { name: 'Second' },
      {
        clock: () => 1,
        createId: () => 'second' as ObjectId,
      },
    );
    const second = [...connection.store.readPages().keys()].find((id) => id !== DEFAULT_PAGE_ID);
    if (second === undefined) throw new Error('no second page');
    placeThreadPin(
      connection,
      {
        id: 'pin-a' as ObjectId,
        point: { x: 10, y: 20 },
        anchor: { kind: 'point' },
        pageId: second,
      },
      'thread-a',
    );
    const show = vi.fn();
    const engine = {
      camera: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 400, viewportHeightPx: 300, dpr: 1 }),
      pages: { current: () => DEFAULT_PAGE_ID, subscribe: () => () => undefined, show },
    } as unknown as MountedEngine;
    const opened = open(
      'thread-a',
      [{ id: 'thread-a', pinId: 'pin-a', isResolved: false, messages: [] }],
      engine,
      connection,
    );
    await waitFor(() => {
      expect(screen.getByTestId('selected-thread').textContent).toBe('thread-a');
    });
    expect(show).toHaveBeenCalledWith(second);
    opened.connection.store.destroy();
  });

  it('does nothing for an unknown thread id', async () => {
    const { connection } = open('unknown', [
      { id: 'thread-a', pinId: 'pin-a', isResolved: false, messages: [] },
    ]);
    await waitFor(() => {
      expect(screen.getByTestId('loaded-threads').textContent).toBe('1');
    });
    expect(screen.getByTestId('selected-thread').textContent).toBe('');
    connection.store.destroy();
  });
});
