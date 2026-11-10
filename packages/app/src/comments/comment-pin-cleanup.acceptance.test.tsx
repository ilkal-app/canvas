// CONTRACT: the cleanup removes adopted pins and only orphans present when the thread list was requested, in one non-undoable system transaction.
// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createHistory, createObjectCommand, runCommand, SYSTEM_ORIGIN } from '@canvas/document';
import { DEFAULT_PAGE_ID, type ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { commentRequest, type Thread } from './comment-api.js';
import { commentObjectIdsOf, useCleanDocumentPins } from './comment-pin-cleanup.js';

vi.mock('./comment-api.js', () => ({ commentRequest: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.mocked(commentRequest).mockReset());

const PIN = { pageId: DEFAULT_PAGE_ID, anchor: { kind: 'point' as const }, point: { x: 1, y: 2 } };
const threads: Thread[] = [
  { id: 'adopted', pinId: 'adopted-pin', isResolved: false, messages: [], pin: PIN },
  { id: 'legacy', pinId: 'legacy-pin', isResolved: false, messages: [], pin: null },
];

function addPin(connection: FakeBoardConnection, id: string, threadId: string): void {
  runCommand(
    connection.store,
    connection.origin,
    createObjectCommand,
    {
      object: {
        type: 'comment',
        id: id,
        x: 1,
        y: 2,
        threadId,
        anchor: { kind: 'point' },
      },
    },
    { clock: () => 1, createId: () => 'unused' as ObjectId },
  );
}

function setup(): FakeBoardConnection {
  const connection = new FakeBoardConnection('board');
  addPin(connection, 'adopted-pin', 'adopted');
  addPin(connection, 'adopted-copy', 'adopted');
  addPin(connection, 'orphan-pin', 'missing');
  addPin(connection, 'legacy-pin', 'legacy');
  return connection;
}

it('deletes adopted pins, their copies and orphans in one system transaction without a service delete or undo step', async () => {
  const connection = setup();
  const history = createHistory(connection.store, connection.origin.principalId);
  const checkedPinIds = commentObjectIdsOf(connection.store.read());
  const changes: { origin: unknown; deleted: readonly ObjectId[] }[] = [];
  const unsubscribe = connection.store.subscribe((change) => changes.push(change));
  const view = renderHook(() => {
    useCleanDocumentPins({ threads, checkedPinIds, connection, canEdit: true });
  });
  await waitFor(() => {
    expect(connection.store.get('adopted-pin' as ObjectId)).toBeUndefined();
  });
  expect(connection.store.get('adopted-copy' as ObjectId)).toBeUndefined();
  expect(connection.store.get('orphan-pin' as ObjectId)).toBeUndefined();
  expect(connection.store.get('legacy-pin' as ObjectId)?.type).toBe('comment');
  expect(changes).toHaveLength(1);
  expect(changes[0]?.origin).toEqual(SYSTEM_ORIGIN);
  expect(changes[0]?.deleted).toEqual(['adopted-copy', 'adopted-pin', 'orphan-pin']);
  expect(vi.mocked(commentRequest).mock.calls.some(([, method]) => method === 'DELETE')).toBe(
    false,
  );
  expect(history.undo()).toBe(false);
  view.unmount();
  unsubscribe();
  history.destroy();
  connection.store.destroy();
});

it('does nothing before the list loads or for a non-editor', () => {
  const connection = setup();
  const checkedPinIds = commentObjectIdsOf(connection.store.read());
  const view = renderHook(
    ({ checkedPinIds: checked, canEdit }) => {
      useCleanDocumentPins({ threads, checkedPinIds: checked, connection, canEdit });
    },
    {
      initialProps: { checkedPinIds: undefined as ReadonlySet<string> | undefined, canEdit: true },
    },
  );
  expect(connection.store.read().objects.size).toBe(4);
  view.rerender({ checkedPinIds, canEdit: false });
  expect(connection.store.read().objects.size).toBe(4);
  view.unmount();
  connection.store.destroy();
});

it('rechecks after the thread list or document changes, and skips an empty cleanup', async () => {
  const connection = new FakeBoardConnection('board');
  addPin(connection, 'legacy-pin', 'legacy');
  const checkedPinIds = commentObjectIdsOf(connection.store.read());
  const changes = vi.fn();
  const unsubscribe = connection.store.subscribe(changes);
  const view = renderHook(
    ({ listed, checked }) => {
      useCleanDocumentPins({ threads: listed, checkedPinIds: checked, connection, canEdit: true });
    },
    {
      initialProps: {
        listed: threads.filter((thread) => thread.id === 'legacy'),
        checked: checkedPinIds,
      },
    },
  );
  expect(changes).not.toHaveBeenCalled();
  addPin(connection, 'late-orphan', 'missing');
  expect(connection.store.get('late-orphan' as ObjectId)?.type).toBe('comment');
  expect(changes).toHaveBeenCalledTimes(1);
  view.rerender({ listed: [], checked: commentObjectIdsOf(connection.store.read()) });
  await waitFor(() => {
    expect(connection.store.get('legacy-pin' as ObjectId)).toBeUndefined();
    expect(connection.store.get('late-orphan' as ObjectId)).toBeUndefined();
  });
  view.unmount();
  unsubscribe();
  connection.store.destroy();
});

it('keeps an orphan written after a list request until a later check includes it', async () => {
  const connection = new FakeBoardConnection('board');
  const checkedPinIds = commentObjectIdsOf(connection.store.read());
  addPin(connection, 'new-orphan', 'missing');
  const view = renderHook(
    ({ checked }) => {
      useCleanDocumentPins({ threads: [], checkedPinIds: checked, connection, canEdit: true });
    },
    { initialProps: { checked: checkedPinIds } },
  );
  expect(connection.store.get('new-orphan' as ObjectId)?.type).toBe('comment');
  view.rerender({ checked: commentObjectIdsOf(connection.store.read()) });
  await waitFor(() => {
    expect(connection.store.get('new-orphan' as ObjectId)).toBeUndefined();
  });
  view.unmount();
  connection.store.destroy();
});

it('deletes an adopted pin written after the check while keeping an unchecked orphan', async () => {
  const connection = new FakeBoardConnection('board');
  const checkedPinIds = commentObjectIdsOf(connection.store.read());
  addPin(connection, 'adopted-copy', 'adopted');
  addPin(connection, 'late-orphan', 'missing');
  const view = renderHook(() => {
    useCleanDocumentPins({ threads, checkedPinIds, connection, canEdit: true });
  });
  await waitFor(() => {
    expect(connection.store.get('adopted-copy' as ObjectId)).toBeUndefined();
  });
  expect(connection.store.get('late-orphan' as ObjectId)?.type).toBe('comment');
  view.unmount();
  connection.store.destroy();
});
