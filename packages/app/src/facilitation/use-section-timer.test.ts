// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SYSTEM_ORIGIN, YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import { DEFAULT_TIMER_DURATION_MS, type PrincipalId } from '@canvas/schema';

import type { BoardConnection } from '../collab/board-connection.js';
import { FRAME } from '../selection-popover/popover-viv-629-fixtures.js';

import { useSectionTimer } from './use-section-timer.js';

const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };
const NOW = 1_770_000_000_000;

/**
 * A connection over a board holding one section.
 *
 * @returns The connection and its store.
 */
function boardWithSection(): {
  readonly connection: BoardConnection;
  readonly store: YjsDocumentStore;
} {
  const store = new YjsDocumentStore();
  store.transact(SYSTEM_ORIGIN, (transaction) => {
    transaction.setObject(FRAME);
  });
  const serverClock = { now: () => NOW };
  const connection = { store, origin: ADA, serverClock } as unknown as BoardConnection;
  return { connection, store };
}

describe('useSectionTimer', () => {
  it('starts the board timer for the section with the default duration', () => {
    const { connection, store } = boardWithSection();
    const { result } = renderHook(() => useSectionTimer(connection));
    result.current?.(FRAME.id);
    expect(store.boardTimer.current).toMatchObject({
      status: 'running',
      durationMs: DEFAULT_TIMER_DURATION_MS,
      sectionId: FRAME.id,
      updatedBy: 'user:ada',
    });
  });

  it('offers nothing without a connection or a store', () => {
    expect(renderHook(() => useSectionTimer(undefined)).result.current).toBeUndefined();
    const storeless = { origin: ADA } as unknown as BoardConnection;
    expect(renderHook(() => useSectionTimer(storeless)).result.current).toBeUndefined();
  });
});
