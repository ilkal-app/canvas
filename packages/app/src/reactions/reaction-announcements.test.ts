// Other people's reactions told to a screen reader: an interval whose end was never
// flushed is told before the reaction that comes after it.
import { describe, expect, it } from 'vitest';

import {
  REACTION_ANNOUNCE_INTERVAL_MS,
  ReactionAnnouncementThrottle,
} from './reaction-announcements.js';

describe('ReactionAnnouncementThrottle', () => {
  it('tells an unflushed interval first when a reaction comes after its end', () => {
    const throttle = new ReactionAnnouncementThrottle();
    expect(throttle.add('👍', 0)).toBe('Someone reacted with thumbs up');
    expect(throttle.add('❤️', 10)).toBeUndefined();
    const late = REACTION_ANNOUNCE_INTERVAL_MS + 100;
    expect(throttle.add('🎉', late)).toBe('Someone reacted with heart');
    expect(throttle.nextFlushAt()).toBe(late + REACTION_ANNOUNCE_INTERVAL_MS);
    expect(throttle.flush(late + REACTION_ANNOUNCE_INTERVAL_MS)).toBe(
      'Someone reacted with party popper',
    );
  });
});
