// @vitest-environment jsdom
// Item 4 moved the notice into the one toast region (of
// 2026-10-07): each render is wrapped in a provider. Rewritten, assertions kept: "says nothing
// while nothing is stranded" (no region at all, rather than an empty one) and the dismissal
// (the toast goes, rather than its region emptying). Each copy is its own toast with the same
// name; Dismiss, which deletes the copy, is the toast's action, so neither Escape nor time takes it.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StrandedEdits } from '@canvas/collab';

import { ToastRegionProvider } from '../feedback/toast-region.js';
import { TOAST_DURATION_MS } from '../feedback/toast.js';

import type { BoardConnectionStatus } from './board-connection-status.js';
import { downloadRecoverySources } from './download-recovery-sources.js';
import {
  SAVED_COPY_DOWNLOAD_FAILED_MESSAGE,
  StrandedEditsNotice,
  type StrandedEditsSourceConnection,
} from './stranded-edits-notice.js';

vi.mock('./download-recovery-sources.js', () => ({ downloadRecoverySources: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const wrapper = ToastRegionProvider;

const EDITS: StrandedEdits = {
  boardId: 'board-7',
  source: 'canvas-board-cache:layout:2',
  fromLayoutVersion: 2,
  toLayoutVersion: 3,
  unsentChangeCount: 5,
};

/** A connection whose stranded edits the test sets. */
class FakeConnection implements StrandedEditsSourceConnection {
  #status: BoardConnectionStatus = {
    boardId: 'board-7',
    state: 'connected',
    isLocalOnly: false,
    isSavedOnDevice: true,
    pendingUpdateCount: 0,
    isAcknowledged: true,
    isReadOnly: false,
    rejectionReason: undefined,
    collaborators: [],
    strandedEdits: [],
  };
  readonly #listeners = new Set<() => void>();
  readonly dismissStrandedEdits = vi.fn((source: string) => {
    this.set(this.#status.strandedEdits.filter((e) => e.source !== source));
  });

  status(): BoardConnectionStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(strandedEdits: readonly StrandedEdits[]): void {
    this.#status = { ...this.#status, strandedEdits };
    for (const listener of this.#listeners) listener();
  }
}

describe('StrandedEditsNotice', () => {
  it('says nothing while nothing is stranded', () => {
    render(<StrandedEditsNotice connection={new FakeConnection()} />, { wrapper });
    expect(screen.queryByRole('status', { name: 'Changes not carried over' })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('tells the person what could not be carried over until they dismiss it', () => {
    const connection = new FakeConnection();
    vi.useFakeTimers();
    render(<StrandedEditsNotice connection={connection} boardName="Roadmap" />, { wrapper });
    act(() => {
      connection.set([EDITS]);
    });
    // A board-level state: neither time nor Escape takes it.
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 10);
    });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    const region = screen.getByRole('status', { name: 'Changes not carried over' });
    expect(region.textContent).toContain('5 unsent changes to “Roadmap”');
    expect(region.textContent).toContain('stored layout 2');
    expect(region.textContent).toContain('stored layout 3');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(connection.dismissStrandedEdits).toHaveBeenCalledWith('canvas-board-cache:layout:2');
    expect(screen.queryByRole('status', { name: 'Changes not carried over' })).toBeNull();
  });

  it('names the board by its id when the page gives no name', () => {
    const connection = new FakeConnection();
    connection.set([
      EDITS,
      { ...EDITS, source: 'canvas-board-cache', fromLayoutVersion: 1, unsentChangeCount: 1 },
    ]);
    render(<StrandedEditsNotice connection={connection} />, { wrapper });
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2);
    expect(screen.getByText(/1 unsent change to “board-7”/u)).toBeTruthy();
  });
});

it('exports manual sources without offering deletion and preserves the notice on failure', async () => {
  const connection = new FakeConnection();
  const board = { snapshot: undefined, updates: [new Uint8Array([0, 0])] };
  const exportSource = vi.fn(() =>
    Promise.resolve({
      source: 'manual',
      board,
      layoutVersion: 2,
      updateKeys: [7],
      snapshotVersion: undefined,
      isPreLayoutCache: false,
    }),
  );
  connection.set([{ ...EDITS, exportSource }]);
  render(<StrandedEditsNotice connection={connection} />, { wrapper });
  expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  expect(screen.getByText(/This notice appears again when you reopen the board/u)).toBeTruthy();
  vi.mocked(downloadRecoverySources).mockRejectedValueOnce(new Error('download failed'));
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getByRole('button', { name: 'Download saved copy' }));
  });
  expect(screen.getByRole('alert').textContent).toContain('still on this device');
  expect(connection.dismissStrandedEdits).not.toHaveBeenCalled();
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getByRole('button', { name: 'Download saved copy' }));
  });
  const source = vi.mocked(downloadRecoverySources).mock.calls.at(-1)?.[0];
  expect(await source?.exportSources()).toEqual([
    expect.objectContaining({ board, replayPolicy: 'manual', updateKeys: [7] }),
  ]);
  expect(exportSource).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('takes the download failure away when the person dismisses it, keeping the saved copy', async () => {
  const connection = new FakeConnection();
  const exportSource = vi.fn(() =>
    Promise.resolve({
      source: 'manual',
      board: { snapshot: undefined, updates: [] },
      layoutVersion: 2,
      updateKeys: [],
      snapshotVersion: undefined,
      isPreLayoutCache: false,
    }),
  );
  connection.set([{ ...EDITS, exportSource }]);
  render(<StrandedEditsNotice connection={connection} />, { wrapper });
  vi.mocked(downloadRecoverySources).mockRejectedValueOnce(new Error('download failed'));
  await act(async () => {
    await Promise.resolve();
    fireEvent.click(screen.getByRole('button', { name: 'Download saved copy' }));
  });
  expect(screen.getByRole('alert').textContent).toContain(SAVED_COPY_DOWNLOAD_FAILED_MESSAGE);
  fireEvent.click(
    screen.getByRole('button', { name: `Dismiss: ${SAVED_COPY_DOWNLOAD_FAILED_MESSAGE}` }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'Download saved copy' })).toBeTruthy();
  expect(connection.dismissStrandedEdits).not.toHaveBeenCalled();
});
