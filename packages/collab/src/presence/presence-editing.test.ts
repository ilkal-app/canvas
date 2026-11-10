import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { linkAwareness } from './__fixtures__/awareness-link.js';
import { ManualTime } from './__fixtures__/manual-time.js';
import { PresenceChannel } from './presence-channel.js';
import { editingOnBoard } from './presence-editing.js';
import { isPresenceState } from './presence-guard.js';
import { MAX_PRESENCE_TEXT_OFFSET } from './presence-limits.js';
import { mergePresence } from './presence-merge.js';
import { sanitizePresenceState } from './presence-sanitize.js';
import type { PresenceState } from './presence-state.js';
import { isValidEditing } from './presence-validation.js';
import { nextSweepDelayMs } from './stale-clients.js';

const docs: Y.Doc[] = [];

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy();
});

function createAwareness(): Awareness {
  const doc = new Y.Doc();
  docs.push(doc);
  return new Awareness(doc);
}

const PRINCIPAL = { id: 'mira', kind: 'user', name: 'Mira', color: '#0090ff' } as const;
const EDITING = { objectId: 'note-1', anchor: 1, focus: 3 };
const STATE: PresenceState = { principal: PRINCIPAL, updatedAt: 0, editing: EDITING };

describe('isValidEditing', () => {
  it('accepts an object id with offsets at both bounds', () => {
    expect(isValidEditing({ objectId: 'a', anchor: 0, focus: MAX_PRESENCE_TEXT_OFFSET })).toBe(
      true,
    );
    expect(isValidEditing({ objectId: 'x'.repeat(64), anchor: 5, focus: 5 })).toBe(true);
  });

  it('refuses an offset past the bound, a missing field, null and arrays', () => {
    expect(isValidEditing({ objectId: 'a', anchor: MAX_PRESENCE_TEXT_OFFSET + 1, focus: 0 })).toBe(
      false,
    );
    expect(isValidEditing({ objectId: 'a', anchor: 0 })).toBe(false);
    expect(isValidEditing({ anchor: 0, focus: 0 })).toBe(false);
    expect(isValidEditing({ objectId: 7, anchor: 0, focus: 0 })).toBe(false);
    expect(isValidEditing(null)).toBe(false);
    expect(isValidEditing([EDITING])).toBe(false);
  });
});

describe('editing in a presence state', () => {
  it('guards the field like the others, and lets a state without it through', () => {
    expect(isPresenceState(STATE)).toBe(true);
    expect(isPresenceState({ principal: PRINCIPAL, updatedAt: 0 })).toBe(true);
    expect(isPresenceState({ ...STATE, editing: { ...EDITING, focus: -2 } })).toBe(false);
  });

  it('keeps only the object id and offsets when a remote state is cleaned', () => {
    const forged = {
      ...STATE,
      editing: { ...EDITING, name: 'Ada', color: '#ff0000', principal: { id: 'ada' } },
    };
    expect(isPresenceState(forged)).toBe(true);
    expect(sanitizePresenceState(forged as PresenceState).editing).toEqual(EDITING);
  });

  it('merges a local edit in, copies it, keeps it while absent and clears it with null', () => {
    const base: PresenceState = { principal: PRINCIPAL, updatedAt: 0 };
    const input = { ...EDITING };
    const editing = mergePresence(base, { editing: input }, 1);
    expect(editing.editing).toEqual(EDITING);
    expect(editing.editing).not.toBe(input);
    expect(mergePresence(editing, { cursor: { x: 1, y: 2 } }, 2).editing).toEqual(EDITING);
    expect('editing' in mergePresence(editing, { editing: null }, 3)).toBe(false);
    expect(base).toEqual({ principal: PRINCIPAL, updatedAt: 0 });
  });

  it('throws on a malformed local edit, which only a bug produces', () => {
    const base: PresenceState = { principal: PRINCIPAL, updatedAt: 0 };
    expect(() =>
      mergePresence(base, { editing: { objectId: 'bad id', anchor: 0, focus: 0 } }, 1),
    ).toThrow(RangeError);
    expect(() =>
      mergePresence(base, { editing: { objectId: 'note-1', anchor: 0.5, focus: 0 } }, 1),
    ).toThrow(RangeError);
  });
});

describe('editingOnBoard', () => {
  it('shows every claim when the board is not known', () => {
    expect(editingOnBoard(undefined)(STATE)).toBe(STATE);
  });

  it('keeps a claim on an object the board holds, and a state that claims nothing', () => {
    const show = editingOnBoard((id) => id === 'note-1');
    const plain: PresenceState = { principal: PRINCIPAL, updatedAt: 0 };
    expect(show(STATE)).toBe(STATE);
    expect(show(plain)).toBe(plain);
  });

  it('drops a claim on an absent object, the same object each time, the rest kept', () => {
    const show = editingOnBoard(() => false);
    const shown = show(STATE);
    expect(shown).toEqual({ principal: PRINCIPAL, updatedAt: 0 });
    expect(show(STATE)).toBe(shown);
    expect(STATE.editing).toEqual(EDITING);
  });
});

describe('PresenceChannel.recheckEditing', () => {
  function pair(existing: Set<string>): {
    time: ManualTime;
    sender: PresenceChannel;
    receiver: PresenceChannel;
  } {
    const time = new ManualTime();
    const from = createAwareness();
    const to = createAwareness();
    linkAwareness(from, to, () => time.now());
    const options = { clock: time, scheduler: time };
    const sender = new PresenceChannel({
      ...options,
      awareness: from,
      principal: { id: 'mira', kind: 'user', name: 'Mira' },
    });
    const receiver = new PresenceChannel({
      ...options,
      awareness: to,
      principal: { id: 'ada', kind: 'user', name: 'Ada' },
      objectExists: (id) => existing.has(id),
    });
    return { time, sender, receiver };
  }

  it('shows a claim once its object arrives, and drops it once the object goes', () => {
    const existing = new Set<string>();
    const { time, sender, receiver } = pair(existing);
    const editingOf = (): unknown => [...receiver.getRemote().values()][0]?.editing;
    sender.setLocal({ editing: EDITING });
    time.advanceBy(100);
    expect(editingOf()).toBeUndefined();

    existing.add('note-1');
    receiver.recheckEditing();
    time.advanceBy(0);
    expect(editingOf()).toEqual(EDITING);

    existing.delete('note-1');
    receiver.recheckEditing();
    time.advanceBy(0);
    expect(editingOf()).toBeUndefined();
    expect(receiver.getRemote().size).toBe(1);
  });

  it('does nothing without claims, without a board, or once destroyed', () => {
    const { time, receiver } = pair(new Set());
    const snapshot = receiver.getRemote();
    receiver.recheckEditing();
    time.advanceBy(0);
    expect(receiver.getRemote()).toBe(snapshot);

    const unchecked = new PresenceChannel({
      awareness: createAwareness(),
      principal: { id: 'bo', kind: 'user', name: 'Bo' },
      clock: time,
      scheduler: time,
    });
    const before = time.pendingTaskCount;
    unchecked.recheckEditing();
    expect(time.pendingTaskCount).toBe(before);
    receiver.destroy();
    const afterDestroy = time.pendingTaskCount;
    receiver.recheckEditing();
    expect(time.pendingTaskCount).toBe(afterDestroy);
  });
});

describe('nextSweepDelayMs', () => {
  it('is the interval with no client, or with every client further than it from stale', () => {
    expect(nextSweepDelayMs(new Map(), 0, 30_000, 3_000)).toBe(3_000);
    expect(nextSweepDelayMs(new Map([[1, 10_000]]), 20_000, 30_000, 3_000)).toBe(3_000);
  });

  it('is the time until the first client turns stale when that comes sooner, never negative', () => {
    const seen = new Map([
      [1, 200],
      [2, 5_000],
    ]);
    expect(nextSweepDelayMs(seen, 30_000, 30_000, 3_000)).toBe(200);
    expect(nextSweepDelayMs(seen, 31_000, 30_000, 3_000)).toBe(0);
  });
});
