import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '../fields/board-bound.js';

import {
  encodeReactionDrop,
  encodeReactionEvent,
  parseReactionDrop,
  parseReactionEvent,
  REACTION_EMOJIS,
  type ReactionDrop,
} from './reaction.js';

const DROP: ReactionDrop = { emoji: '🎉', x: 120.5, y: -40, pageId: 'page-1' };

describe('reactions on the wire', () => {
  it('round trips every emoji as a drop and as the relay’s event', () => {
    for (const emoji of REACTION_EMOJIS) {
      const drop = { ...DROP, emoji };
      expect(parseReactionDrop(encodeReactionDrop(drop))).toEqual(drop);
      const event = { ...drop, from: 'user-ada' };
      expect(parseReactionEvent(encodeReactionEvent(event))).toEqual(event);
    }
  });

  it('refuses a drop out of its rules, and one naming its own sender', () => {
    const payload = (value: Record<string, unknown>) =>
      JSON.stringify({ type: 'reaction', ...DROP, ...value });
    for (const change of [
      { emoji: '💩' },
      { emoji: '+1' },
      { x: Number.NaN },
      { x: BOARD_BOUND * 2 },
      { y: '3' },
      { pageId: 'bad id' },
      { pageId: '' },
      { from: 'user-eve' },
      { extra: 1 },
      { type: 'reactions' },
    ])
      expect(parseReactionDrop(payload(change))).toBeUndefined();
    for (const text of ['', 'null', '[]', '"reaction"', '{"type":"reaction"}'])
      expect(parseReactionDrop(text)).toBeUndefined();
    expect(() => encodeReactionDrop({ ...DROP, x: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('refuses an event with no sender, or a sender past its bound', () => {
    const event = (from: unknown) => JSON.stringify({ type: 'reaction', ...DROP, from });
    for (const from of ['', 'x'.repeat(257), 5, null])
      expect(parseReactionEvent(event(from))).toBeUndefined();
    expect(parseReactionEvent(encodeReactionDrop(DROP))).toBeUndefined();
  });
});
