// CONTRACT: reaction names, summaries, and a pure five-second burst throttle.
import { expect, it } from 'vitest';

import { REACTION_EMOJIS, type ReactionEmoji } from '@canvas/schema';

import {
  REACTION_ANNOUNCE_INTERVAL_MS,
  ReactionAnnouncementThrottle,
  reactionAnnouncementOf,
  reactionNameOf,
} from './reaction-announcements.js';

it('names every schema reaction in spoken language', () => {
  const names = new Map<ReactionEmoji, string>([
    ['👍', 'thumbs up'],
    ['❤️', 'heart'],
    ['🎉', 'party popper'],
    ['👀', 'eyes'],
    ['🙌', 'raised hands'],
    ['🤔', 'thinking face'],
    ['😂', 'tears of joy'],
  ]);
  expect([...REACTION_EMOJIS].sort()).toEqual([...names.keys()].sort());
  for (const [emoji, name] of names) expect(reactionNameOf(emoji)).toBe(name);
});

it('summarizes a burst by first-seen distinct names, capped at three', () => {
  const emojis = ['👍', '❤️', '👍', '🎉', '👀'] as const;
  expect(reactionAnnouncementOf(['👍'])).toBe('Someone reacted with thumbs up');
  expect(reactionAnnouncementOf(['👍', '❤️', '👍', '❤️'])).toBe('4 reactions: thumbs up, heart');
  expect(reactionAnnouncementOf(emojis)).toBe(
    '5 reactions: thumbs up, heart, party popper and more',
  );
  expect(emojis).toEqual(['👍', '❤️', '👍', '🎉', '👀']);
});

it('announces the first reaction immediately, batches until the interval end, then goes quiet', () => {
  expect(REACTION_ANNOUNCE_INTERVAL_MS).toBe(5000);
  const throttle = new ReactionAnnouncementThrottle();
  expect(throttle.nextFlushAt()).toBeUndefined();
  expect(throttle.add('👍', 100)).toBe('Someone reacted with thumbs up');
  expect(throttle.nextFlushAt()).toBe(5100);
  expect(throttle.add('❤️', 101)).toBeUndefined();
  expect(throttle.add('❤️', 4999)).toBeUndefined();
  expect(throttle.flush(5099)).toBeUndefined();
  expect(throttle.flush(5100)).toBe('2 reactions: heart');
  expect(throttle.nextFlushAt()).toBe(10100);
  expect(throttle.flush(10100)).toBeUndefined();
  expect(throttle.nextFlushAt()).toBeUndefined();
  expect(throttle.add('🎉', 12000)).toBe('Someone reacted with party popper');
});
