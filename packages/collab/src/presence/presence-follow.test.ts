// The edges of following and the spotlight in presence: a malformed `following` or
// spotlight refused on the way out and dropped on the way in, a spotlight followed without a
// viewport, with no local presence yet, and kept while its spotlighter moves.
import { describe, expect, it } from 'vitest';

import { nextFollow, type FollowState } from './follow-state.js';
import { mergePresence } from './presence-merge.js';
import { sanitizePresenceState } from './presence-sanitize.js';
import type { PresenceSnapshot, PresenceState } from './presence-state.js';
import { isValidFollowing } from './presence-validation.js';
import { isSpotlightSuperseded } from './spotlight.js';

const screen = { widthPx: 800, heightPx: 600 };
const viewport = { x: 10, y: 20, w: 200, h: 100, zoom: 2 };
const ada: PresenceState = {
  principal: { id: 'ada', kind: 'user', name: 'Ada', color: '#0090ff' },
  viewport,
  updatedAt: 1,
};
const mira: PresenceState = {
  ...ada,
  principal: { ...ada.principal, id: 'mira', name: 'Mira' },
  spotlight: { startedAt: 50 },
};

describe('following in presence', () => {
  it('takes a principal id of 1 to 256 characters and nothing else', () => {
    expect(isValidFollowing('mira')).toBe(true);
    expect(isValidFollowing('x'.repeat(256))).toBe(true);
    expect(isValidFollowing('')).toBe(false);
    expect(isValidFollowing('x'.repeat(257))).toBe(false);
    expect(isValidFollowing(7)).toBe(false);
  });

  it('refuses a malformed following or spotlight from the local client', () => {
    expect(mergePresence(ada, { following: 'mira' }, 2).following).toBe('mira');
    expect(mergePresence({ ...ada, following: 'mira' }, { following: null }, 2)).not.toHaveProperty(
      'following',
    );
    expect(() => mergePresence(ada, { following: '' }, 2)).toThrow(RangeError);
    expect(() => mergePresence(ada, { spotlight: { startedAt: -1 } }, 2)).toThrow(RangeError);
  });

  it('keeps a peer whose following is malformed, without it', () => {
    expect(sanitizePresenceState({ ...ada, following: 'mira' }).following).toBe('mira');
    const hostile = { ...ada, following: 42 } as unknown as PresenceState;
    expect(sanitizePresenceState(hostile)).not.toHaveProperty('following');
  });
});

describe('the spotlight at its edges', () => {
  it('is superseded only by a newer remote spotlight, and never without its own', () => {
    const snapshot: PresenceSnapshot = new Map([[2, mira]]);
    expect(isSpotlightSuperseded(ada, snapshot, 1)).toBe(false);
    expect(isSpotlightSuperseded({ ...ada, spotlight: { startedAt: 10 } }, snapshot, 1)).toBe(true);
    expect(isSpotlightSuperseded({ ...ada, spotlight: { startedAt: 90 } }, snapshot, 1)).toBe(
      false,
    );
    expect(isSpotlightSuperseded({ ...ada, spotlight: { startedAt: 10 } }, new Map(), 1)).toBe(
      false,
    );
  });

  it('follows a spotlight before the local client has presence, and without a viewport', () => {
    const noView: PresenceState = { ...mira };
    Reflect.deleteProperty(noView, 'viewport');
    const snapshot: PresenceSnapshot = new Map([[2, noView]]);
    const outcome = nextFollow(
      { kind: 'idle' },
      { type: 'presence' },
      {
        snapshot,
        screen,
        localClientId: 1,
        localState: undefined,
      },
    );
    expect(outcome.state).toMatchObject({ kind: 'following', clientId: 2, cause: 'spotlight' });
    expect(outcome).not.toHaveProperty('viewport');
  });

  it('keeps following a spotlight as its spotlighter moves, without announcing it again', () => {
    const state: FollowState = {
      kind: 'following',
      clientId: 2,
      principalId: 'mira',
      name: 'Mira',
      cause: 'spotlight',
    };
    const moved = { ...mira, viewport: { ...viewport, x: 300 } };
    const outcome = nextFollow(
      state,
      { type: 'presence' },
      {
        snapshot: new Map([[2, moved]]),
        screen,
        localClientId: 1,
        localState: ada,
      },
    );
    expect(outcome.state).toEqual(state);
    expect(outcome.viewport).toBeDefined();
    expect(outcome.notice).toBeUndefined();
  });

  it('says the local client is no one to follow, and choosing the spotlighter opts out of nothing', () => {
    const snapshot: PresenceSnapshot = new Map([[2, mira]]);
    const context = { snapshot, screen, localClientId: 1, localState: ada };
    const self = nextFollow({ kind: 'idle' }, { type: 'follow', clientId: 1 }, context);
    expect(self.notice).toEqual({ kind: 'unavailable', name: 'Ada' });
    const chosen = nextFollow({ kind: 'idle' }, { type: 'follow', clientId: 2 }, context);
    expect(chosen.state).toMatchObject({ kind: 'following', clientId: 2, cause: 'chosen' });
    expect(chosen.state).not.toHaveProperty('optedOutOf');
    const joe = { ...ada, principal: { ...ada.principal, id: 'joe', name: 'Joe' } };
    const crowd = { ...context, snapshot: new Map([...snapshot, [3, joe]]) };
    const other = nextFollow({ kind: 'idle' }, { type: 'follow', clientId: 3 }, crowd);
    expect(other.state).toMatchObject({ kind: 'following', clientId: 3, optedOutOf: 50 });
  });
});
