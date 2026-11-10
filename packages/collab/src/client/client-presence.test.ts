import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import type { ChangeSet } from '@canvas/document';

import { linkAwareness } from '../presence/__fixtures__/awareness-link.js';
import { ManualTime } from '../presence/__fixtures__/manual-time.js';
import { PresenceChannel } from '../presence/presence-channel.js';

import type { BoardTokenClaims } from './board-token.js';
import { createClientPresence } from './client-presence.js';

const docs: Y.Doc[] = [];

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy();
});

function createAwareness(): Awareness {
  const doc = new Y.Doc();
  docs.push(doc);
  return new Awareness(doc);
}

const CLAIMS: BoardTokenClaims = {
  principalId: 'ada',
  principalType: 'user',
  boardId: 'board',
  role: 'editor',
};

/** A board of ids whose changes the test announces. */
class FakeBoard {
  readonly ids = new Set<string>();
  private readonly listeners = new Set<(changes: ChangeSet) => void>();

  get(id: string): object | undefined {
    return this.ids.has(id) ? { id } : undefined;
  }

  subscribe(listener: (changes: ChangeSet) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  announce(change: Partial<Pick<ChangeSet, 'created' | 'deleted' | 'updated'>>): void {
    const changes = { created: [], updated: [], deleted: [], ...change } as unknown as ChangeSet;
    for (const listener of this.listeners) listener(changes);
  }
}

describe('createClientPresence', () => {
  it('makes no channel and follows nothing without presence options', () => {
    const board = new FakeBoard();
    const time = new ManualTime();
    const created = createClientPresence(
      createAwareness(),
      CLAIMS,
      { store: board as never },
      { clock: time, scheduler: time },
    );
    expect(created).toBeUndefined();
    expect(board.listenerCount).toBe(0);
  });

  it('makes no channel for a demo board visitor, even with presence options', () => {
    const board = new FakeBoard();
    const time = new ManualTime();
    const awareness = createAwareness();
    const created = createClientPresence(
      awareness,
      { ...CLAIMS, principalType: 'demo', role: 'viewer' },
      { presence: { name: 'Visitor' }, store: board as never },
      { clock: time, scheduler: time },
    );
    expect(created).toBeUndefined();
    expect(board.listenerCount).toBe(0);
    expect(awareness.getLocalState()).toEqual({});
  });

  it('shows a peer’s edit once its object is created and stops following on destroy', () => {
    const board = new FakeBoard();
    const time = new ManualTime();
    const awareness = createAwareness();
    const peerAwareness = createAwareness();
    linkAwareness(peerAwareness, awareness, () => time.now());
    const presence = createClientPresence(
      awareness,
      CLAIMS,
      {
        presence: { name: 'Ada', color: '#123456', rateHz: 20, timeoutMs: 20_000 },
        store: board as never,
      },
      { clock: time, scheduler: time },
    );
    const peer = new PresenceChannel({
      awareness: peerAwareness,
      principal: { id: 'mira', kind: 'user', name: 'Mira' },
      clock: time,
      scheduler: time,
    });
    const editingOf = (): unknown => [...(presence?.getRemote().values() ?? [])][0]?.editing;
    expect(presence?.getLocal().principal.color).toBe('#123456');

    peer.setLocal({ editing: { objectId: 'note-1', anchor: 0, focus: 2 } });
    time.advanceBy(100);
    expect(editingOf()).toBeUndefined();

    board.ids.add('note-1');
    board.announce({ updated: ['note-1'] as never });
    time.advanceBy(0);
    expect(editingOf()).toBeUndefined();
    board.announce({ created: ['note-1'] as never });
    time.advanceBy(0);
    expect(editingOf()).toEqual({ objectId: 'note-1', anchor: 0, focus: 2 });

    board.ids.delete('note-1');
    board.announce({ deleted: ['note-1'] as never });
    time.advanceBy(0);
    expect(editingOf()).toBeUndefined();

    awareness.destroy();
    expect(board.listenerCount).toBe(0);
  });
});
