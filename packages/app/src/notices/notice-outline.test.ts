import { describe, expect, it } from 'vitest';

import type { PresenceSnapshot, PresenceState } from '@canvas/collab';
import type { ObjectId } from '@canvas/schema';

import { noticeOf, vouchedWriterOf, type ProtectedUndo } from './notice-outline.js';

// Item 5: an undo used up because another person changed what it would change
// since outlines what they changed. It names them, in their presence colour, only when the relay
// vouches for exactly one present person as the writer (`writerClientIds`); otherwise
// it keeps's words and the neutral outline.

const GENERAL = 'Nothing to undo here: this has changed since.';
const SHAPE = 'shape-1' as ObjectId;
const KEPT: ProtectedUndo = { isUndo: true, protection: { objectIds: [SHAPE], writers: [3, 9] } };

/**
 * A present person's presence, with the writer ids the relay vouches for.
 *
 * @param name - Their name; their id is `user-<name>`.
 * @param color - Their presence colour.
 * @param writerClientIds - The relay's stamp, if any.
 * @returns The presence state.
 */
function person(name: string, color: string, writerClientIds?: number[]): PresenceState {
  return {
    principal: { id: `user-${name.toLowerCase()}`, kind: 'user', name, color },
    updatedAt: 1,
    ...(writerClientIds === undefined ? {} : { writerClientIds }),
  };
}

const MIRA = person('Mira', '#cc5533', [3, 9]);
const BEA = person('Bea', '#117799', [9]);

describe('noticeOf', () => {
  it('keeps the words and outlines the objects another person changed, naming nobody', () => {
    expect(noticeOf(GENERAL, KEPT)).toEqual({ message: GENERAL, outline: { objectIds: [SHAPE] } });
  });

  it('outlines nothing for any other notice', () => {
    expect(noticeOf('Not moved.', undefined)).toEqual({ message: 'Not moved.' });
  });
});

describe('noticeOf with presence', () => {
  const present = (...states: PresenceState[]): PresenceSnapshot =>
    new Map(states.map((state, index) => [100 + index, state]));

  it('names the one present person vouched for every writer, in their colour', () => {
    expect(noticeOf(GENERAL, KEPT, present(MIRA, person('Ola', '#000000')))).toEqual({
      message: "Can't undo — Mira changed this since",
      outline: { objectIds: [SHAPE], color: '#cc5533' },
    });
    expect(
      noticeOf(
        'Nothing to redo here: this has changed since.',
        { ...KEPT, isUndo: false },
        present(MIRA),
      ),
    ).toEqual({
      message: "Can't redo — Mira changed this since",
      outline: { objectIds: [SHAPE], color: '#cc5533' },
    });
  });

  it('names the verified principal id, not a name the client chose, without a signed name (review)', () => {
    const forged = {
      ...person('Bea', '#117799', [3, 9]),
      principal: { id: 'user-ada', kind: 'user' as const, name: 'Bea', color: '#117799' },
      isNameSigned: false,
    };
    expect(noticeOf(GENERAL, KEPT, present(forged))).toEqual({
      message: "Can't undo — user-ada changed this since",
      outline: { objectIds: [SHAPE], color: '#117799' },
    });
    expect(
      noticeOf(GENERAL, KEPT, present({ ...MIRA, isNameSigned: true } as PresenceState)),
    ).toMatchObject({
      message: "Can't undo — Mira changed this since",
    });
  });

  it('names who they are when presence left their name empty', () => {
    const nameless = person('', '#cc5533', [3, 9]);
    expect(noticeOf(GENERAL, KEPT, present(nameless)).message).toBe(
      "Can't undo — user- changed this since",
    );
  });

  it('keeps the unnamed words when a writer is claimed twice, by nobody, or writers differ', () => {
    const unnamed = { message: GENERAL, outline: { objectIds: [SHAPE] } };
    expect(noticeOf(GENERAL, KEPT, present(MIRA, BEA))).toEqual(unnamed);
    expect(noticeOf(GENERAL, KEPT, present(person('Mira', '#cc5533', [3])))).toEqual(unnamed);
    expect(
      noticeOf(
        GENERAL,
        KEPT,
        present(person('Mira', '#cc5533', [3]), person('Bea', '#117799', [9])),
      ),
    ).toEqual(unnamed);
    expect(noticeOf(GENERAL, KEPT, present(person('Mira', '#cc5533')))).toEqual(unnamed);
    expect(noticeOf(GENERAL, KEPT, new Map())).toEqual(unnamed);
  });
});

describe('vouchedWriterOf', () => {
  it('names nobody for no writers', () => {
    expect(vouchedWriterOf([], new Map([[1, MIRA]]))).toBeUndefined();
  });
});
