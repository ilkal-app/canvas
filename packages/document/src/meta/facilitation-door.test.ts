import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { fixtureGateBoard, rawUpdate } from './__fixtures__/gate-boards.js';
import { UpdateStampCheck } from './update-stamp-check.js';

// The door judges writes into the `facilitation` map: the key `timer`, holding a board
// timer as `boardTimerSchema` reads it (and, since, `stickyAuthors` as a boolean: see
// facilitation-sticky-authors-door.acceptance.test.ts). Anything else is refused, so no reader is
// left with a value it reads as no timer.

/**
 * Checks an update written by the fixture writer.
 *
 * @param write - The raw write.
 * @returns The verdict.
 */
function verdictOf(write: Parameters<typeof rawUpdate>[1]): ReturnType<UpdateStampCheck['check']> {
  const board = fixtureGateBoard();
  try {
    return new UpdateStampCheck(board.hub).check(rawUpdate(board, write));
  } finally {
    board.hub.destroy();
    board.writer.destroy();
  }
}

const facilitationWrite = (key: string, value: unknown) =>
  verdictOf((objects, doc) => {
    doc.getMap('facilitation').set(key, value);
  });

const RUNNING = {
  status: 'running',
  durationMs: 60_000,
  remainingMs: 30_000,
  startedAt: 1_770_000_000_000,
  sectionId: null,
  updatedBy: 'user:ada',
};

describe('the door on the facilitation map', () => {
  it.each([
    ['running', RUNNING],
    ['paused', { ...RUNNING, status: 'paused', startedAt: undefined, sectionId: 'frame-1' }],
    ['idle', { status: 'idle', durationMs: 1000, sectionId: null, updatedBy: 'system' }],
  ])('accepts a %s timer', (status, value) => {
    expect(value.status).toBe(status);
    const timer = JSON.parse(JSON.stringify(value)) as unknown;
    expect(facilitationWrite('timer', timer)).toEqual({ kind: 'accepted' });
  });

  it('accepts deleting the timer', () => {
    const board = fixtureGateBoard();
    try {
      board.hub.getMap('facilitation').set('timer', RUNNING);
      const removal = rawUpdate(board, (objects, doc) => {
        doc.getMap('facilitation').delete('timer');
      });
      expect(new UpdateStampCheck(board.hub).check(removal)).toEqual({ kind: 'accepted' });
    } finally {
      board.hub.destroy();
      board.writer.destroy();
    }
  });

  it('refuses writes inside a type an older relay let in, and accepts replacing it', () => {
    const board = fixtureGateBoard();
    try {
      const legacy = new Y.Map<unknown>();
      board.hub.getMap('facilitation').set('timer', legacy);
      legacy.set('status', 'running');
      const nested = new Y.Map<unknown>();
      legacy.set('inner', nested);
      const check = (write: Parameters<typeof rawUpdate>[1]) =>
        new UpdateStampCheck(board.hub).check(rawUpdate(board, write));
      const into = (doc: Y.Doc) => doc.getMap('facilitation').get('timer') as Y.Map<unknown>;
      expect(
        check((objects, doc) => {
          into(doc).set('status', 'paused');
        }),
      ).toMatchObject({ hostileValue: { reason: 'not-a-facilitation-value', key: 'status' } });
      expect(
        check((objects, doc) => {
          (into(doc).get('inner') as Y.Map<unknown>).set('deep', 1);
        }),
      ).toMatchObject({ hostileValue: { reason: 'not-a-facilitation-value', key: 'deep' } });
      expect(
        check((objects, doc) => {
          into(doc).delete('status');
        }),
      ).toEqual({ kind: 'accepted' });
      expect(
        check((objects, doc) => {
          doc.getMap('facilitation').set('timer', RUNNING);
        }),
      ).toEqual({ kind: 'accepted' });
    } finally {
      board.hub.destroy();
      board.writer.destroy();
    }
  });

  it('refuses a write at the bottom of a legacy chain of 300 nested types', () => {
    const board = fixtureGateBoard();
    try {
      let parent = new Y.Map<unknown>();
      board.hub.getMap('facilitation').set('timer', parent);
      for (let depth = 0; depth < 300; depth += 1) {
        const child = new Y.Map<unknown>();
        parent.set('next', child);
        parent = child;
      }
      const verdict = new UpdateStampCheck(board.hub).check(
        rawUpdate(board, (objects, doc) => {
          let deepest = doc.getMap('facilitation').get('timer') as Y.Map<unknown>;
          for (let depth = 0; depth < 300; depth += 1)
            deepest = deepest.get('next') as Y.Map<unknown>;
          deepest.set('status', 'running');
          const list = new Y.Array<unknown>();
          deepest.set('list', list);
          list.push([1]);
        }),
      );
      expect(verdict).toMatchObject({ hostileValue: { reason: 'not-a-facilitation-value' } });
    } finally {
      board.hub.destroy();
      board.writer.destroy();
    }
  });

  it.each([
    ['timer', { ...RUNNING, remainingMs: 60_001 }, 'not-a-facilitation-value'],
    ['timer', { ...RUNNING, durationMs: 0, remainingMs: 0 }, 'not-a-facilitation-value'],
    ['timer', { ...RUNNING, status: 'done' }, 'not-a-facilitation-value'],
    ['timer', { ...RUNNING, votes: { ada: 3 } }, 'not-a-facilitation-value'],
    ['timer', { ...RUNNING, updatedBy: 'nobody' }, 'not-a-facilitation-value'],
    ['timer', 'running', 'not-a-facilitation-value'],
    ['timer', null, 'not-a-facilitation-value'],
    ['vote', { open: true }, 'not-a-facilitation-key'],
  ])('refuses hostile write %s %j', (key, value, reason) => {
    expect(facilitationWrite(key, value)).toEqual({
      kind: 'accepted',
      hostileValue: expect.objectContaining({ reason, key, objectId: '' }) as unknown,
    });
  });

  it('refuses a shared type under the timer key', () => {
    const verdict = verdictOf((objects, doc) => {
      const nested = new Y.Map<unknown>();
      doc.getMap('facilitation').set('timer', nested);
      nested.set('status', 'running');
    });
    expect(verdict).toMatchObject({ hostileValue: { reason: 'not-a-plain-value', key: 'timer' } });
  });
});
