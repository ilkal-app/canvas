// Acceptance: editing is transient awareness, scoped to an existing board object.
// Assumed wire/API field: editing: { objectId, anchor, focus }, with UTF-16 offsets.
import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { linkAwareness } from './__fixtures__/awareness-link.js';
import { ManualTime } from './__fixtures__/manual-time.js';
import { PresenceChannel } from './presence-channel.js';
import { isPresenceState } from './presence-guard.js';
import { MAX_PRESENCE_ID_LENGTH } from './presence-limits.js';

interface Editing {
  objectId: string;
  anchor: number;
  focus: number;
}
const NOTE = 'note-1';
const CARET: Editing = { objectId: NOTE, anchor: 2, focus: 2 };
const SELECTION: Editing = { objectId: NOTE, anchor: 1, focus: 4 };
const docs: Y.Doc[] = [];

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy();
});

function awareness(): Awareness {
  const doc = new Y.Doc();
  docs.push(doc);
  return new Awareness(doc);
}

function channel(
  instance: Awareness,
  time: ManualTime,
  name: string,
  existing: ReadonlySet<string>,
): PresenceChannel {
  return new PresenceChannel({
    awareness: instance,
    principal: { id: name.toLowerCase(), kind: 'user', name },
    clock: time,
    scheduler: time,
    objectExists: (id: string) => existing.has(id),
  });
}

function setEditing(peer: PresenceChannel, editing: Editing | null): void {
  peer.setLocal({ editing });
}

function editingOf(state: unknown): unknown {
  return (state as { editing?: unknown } | undefined)?.editing;
}

const principal = { id: 'mira', kind: 'user', name: 'Mira', color: '#0090ff' };
const state = { principal, updatedAt: 0 };

describe('editing presence', () => {
  it('round-trips a caret and selection between peers without writing either to the document', () => {
    const time = new ManualTime();
    const sender = awareness();
    const receiver = awareness();
    const existing = new Set([NOTE]);
    linkAwareness(sender, receiver, () => time.now());
    const mira = channel(sender, time, 'Mira', existing);
    const ada = channel(receiver, time, 'Ada', existing);
    const before = Y.encodeStateAsUpdate(sender.doc);

    setEditing(mira, CARET);
    time.advanceBy(100);
    expect(editingOf(ada.getRemote().get(sender.clientID))).toEqual(CARET);
    setEditing(mira, SELECTION);
    time.advanceBy(100);
    expect(editingOf(ada.getRemote().get(sender.clientID))).toEqual(SELECTION);
    expect(Y.encodeStateAsUpdate(sender.doc)).toEqual(before);
  });

  it.each([
    42,
    'note-1',
    { objectId: '', anchor: 0, focus: 0 },
    { objectId: 'x'.repeat(MAX_PRESENCE_ID_LENGTH + 1), anchor: 0, focus: 0 },
    { objectId: 'bad id', anchor: 0, focus: 0 },
    { objectId: NOTE, anchor: -1, focus: 0 },
    { objectId: NOTE, anchor: 0.5, focus: 1 },
    { objectId: NOTE, anchor: Number.MAX_SAFE_INTEGER + 1, focus: 1 },
    { objectId: NOTE, anchor: 0, focus: Number.POSITIVE_INFINITY },
    { objectId: NOTE, anchor: '0', focus: 1 },
  ])('refuses malformed editing %j at the presence boundary', (editing) => {
    expect(isPresenceState({ ...state, editing })).toBe(false);
  });

  it('ignores an editing claim for an object that is absent from this board', () => {
    const time = new ManualTime();
    const sender = awareness();
    const receiver = awareness();
    const existing = new Set([NOTE]);
    linkAwareness(sender, receiver, () => time.now());
    const mira = channel(sender, time, 'Mira', existing);
    const ada = channel(receiver, time, 'Ada', existing);
    setEditing(mira, CARET);
    time.advanceBy(100);
    expect(editingOf(ada.getRemote().get(sender.clientID))).toEqual(CARET);

    // A raw awareness writer bypasses the sender's setLocal validation.
    sender.setLocalState({
      ...state,
      editing: { objectId: 'deleted-note', anchor: 0, focus: 0 },
    });
    time.advanceBy(0);
    expect(editingOf(ada.getRemote().get(sender.clientID))).toBeUndefined();
  });

  it('does not let editing carry another person’s identity or colour', () => {
    const time = new ManualTime();
    const sender = awareness();
    const receiver = awareness();
    linkAwareness(sender, receiver, () => time.now());
    const ada = channel(receiver, time, 'Ada', new Set([NOTE]));
    sender.setLocalState({
      ...state,
      editing: { ...CARET, name: 'Ada', color: '#ff0000', principalId: 'ada' },
    });
    time.advanceBy(0);

    const peer = ada.getRemote().get(sender.clientID);
    expect(peer?.principal).toEqual(principal);
    expect(editingOf(peer)).toEqual(CARET);
  });

  it('clears editing on stop, and removes the peer on disconnect within the presence timeout', () => {
    const time = new ManualTime();
    const sender = awareness();
    const receiver = awareness();
    const existing = new Set([NOTE]);
    const link = linkAwareness(sender, receiver, () => time.now());
    const mira = channel(sender, time, 'Mira', existing);
    const ada = channel(receiver, time, 'Ada', existing);
    setEditing(mira, CARET);
    time.advanceBy(100);
    expect(editingOf(ada.getRemote().get(sender.clientID))).toEqual(CARET);

    setEditing(mira, null);
    time.advanceBy(100);
    expect(editingOf(ada.getRemote().get(sender.clientID))).toBeUndefined();
    setEditing(mira, CARET);
    time.advanceBy(100);
    expect(editingOf(ada.getRemote().get(sender.clientID))).toEqual(CARET);
    link.cut();
    time.advanceBy(30_001);
    expect(ada.getRemote().has(sender.clientID)).toBe(false);
  });
});
