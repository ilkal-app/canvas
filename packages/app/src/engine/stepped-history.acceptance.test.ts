import { expect, it, vi } from 'vitest';

import type { RestoreReport } from '@canvas/document';
import { RunStoppedError } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { runHistoryCommand } from './engine-document-commands.js';
import type { EditHistory } from './engine-document-types.js';

const report = (changes: Partial<RestoreReport> = {}): RestoreReport => ({
  parts: 3,
  committedParts: 3,
  isChanged: true,
  omission: undefined,
  protection: undefined,
  omittedObjects: 0,
  ...changes,
});

function stepped(result: RestoreReport | undefined): {
  history: EditHistory;
  startRestore: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
} {
  const startRestore = vi.fn(() => (result === undefined ? undefined : Promise.resolve(result)));
  const undo = vi.fn(() => true);
  const redo = vi.fn(() => true);
  return {
    history: { canUndo: () => true, canRedo: () => true, undo, redo, startRestore },
    startRestore,
    undo,
    redo,
  };
}

it.each(['undo', 'redo'] as const)(
  'uses stepped %s and does not invoke the synchronous method',
  async (direction) => {
    const { history, startRestore, undo, redo } = stepped(report());
    runHistoryCommand(history, direction);
    await vi.waitFor(() => {
      expect(startRestore).toHaveBeenCalledWith(direction, expect.any(Object));
    });
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  },
);

it.each(['undo', 'redo'] as const)(
  'does not show a notice when stepped %s has no step',
  async (direction) => {
    const { history, startRestore, undo, redo } = stepped(undefined);
    const notice = vi.fn();
    runHistoryCommand(history, direction, notice);
    await Promise.resolve();
    expect(startRestore).toHaveBeenCalledWith(direction, expect.any(Object));
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  },
);

it.each([
  [
    report({ omittedObjects: 2 }),
    'Undo could not bring back 2 objects because their stored values are out of range.',
  ],
  [
    report({ omission: 'out-of-range' }),
    'Part of this could not be undone: it holds a value out of range.',
  ],
  [report({ isChanged: false }), 'Nothing to undo here: this has changed since.'],
] as const)('reads undo notices from the stepped report', async (result, message) => {
  const { history } = stepped(result);
  const notice = vi.fn();
  runHistoryCommand(history, 'undo', notice);
  await vi.waitFor(() => {
    expect(notice.mock.calls[0]?.[0]).toBe(message);
  });
});

it('includes protection in the nothing-changed stepped notice', async () => {
  const protection = { objectIds: ['shape' as ObjectId], writers: [77] };
  const { history } = stepped(report({ isChanged: false, protection }));
  const notice = vi.fn();
  runHistoryCommand(history, 'redo', notice);
  await vi.waitFor(() => {
    expect(notice).toHaveBeenCalledWith('Nothing to redo here: this has changed since.', {
      isUndo: false,
      protection,
    });
  });
});

it('shows the partial-change notice when a stepped restore stops', async () => {
  const { history } = stepped(report());
  history.startRestore = vi.fn(() =>
    Promise.reject(new RunStoppedError(1, undefined, new Error('stop'))),
  );
  const notice = vi.fn();
  runHistoryCommand(history, 'undo', notice);
  await vi.waitFor(() => {
    expect(notice.mock.calls[0]?.[0]).toBe('That change stopped partway: some of it was applied.');
  });
});
