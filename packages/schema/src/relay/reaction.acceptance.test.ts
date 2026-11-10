// CONTRACT: reaction wire messages are exact, bounded, ephemeral events;
// a client cannot supply the relay-owned sender field or introduce a new emoji.
import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '../fields/board-bound.js';

import { encodeReactionDrop, parseReactionDrop, parseReactionEvent } from './reaction.js';

const drop = { type: 'reaction', emoji: '👀', x: BOARD_BOUND, y: -BOARD_BOUND, pageId: 'page-1' };

describe('reaction wire acceptance', () => {
  it('accepts the coordinate boundary and rejects adjacent invalid values', () => {
    expect(parseReactionDrop(JSON.stringify(drop))).toEqual({
      emoji: '👀',
      x: BOARD_BOUND,
      y: -BOARD_BOUND,
      pageId: 'page-1',
    });
    for (const change of [
      { x: BOARD_BOUND + 1 },
      { y: -BOARD_BOUND - 1 },
      { x: null },
      { y: '0' },
      { emoji: '+1' },
      { emoji: '👍🏻' },
      { pageId: '../page-1' },
    ]) {
      const altered = JSON.stringify({ ...drop, ...change });
      expect(parseReactionDrop(altered)).toBeUndefined();
      expect(
        parseReactionEvent(JSON.stringify({ ...drop, ...change, from: 'ada' })),
      ).toBeUndefined();
    }
  });

  it('rejects a client-owned sender or extra keys while accepting a relay-owned sender', () => {
    expect(parseReactionDrop(JSON.stringify({ ...drop, from: 'forged' }))).toBeUndefined();
    expect(parseReactionDrop(JSON.stringify({ ...drop, hidden: true }))).toBeUndefined();
    expect(parseReactionEvent(JSON.stringify({ ...drop, from: 'agent:helper' }))).toMatchObject({
      from: 'agent:helper',
      emoji: '👀',
    });
    expect(
      parseReactionEvent(JSON.stringify({ ...drop, from: 'agent:helper', hidden: true })),
    ).toBeUndefined();
    expect(encodeReactionDrop({ emoji: '👀', x: 1, y: 2, pageId: 'page-1' })).not.toContain('from');
  });
});
