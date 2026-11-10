import { describe, expect, it } from 'vitest';

import * as collab from '../index.js';

import { computeFollowViewport } from './follow-viewport.js';
import type { PresenceSnapshot, PresenceState, PresenceViewport } from './presence-state.js';

const api = collab as unknown as {
  nextFollow(state: unknown, event: unknown, context: unknown): unknown;
};
const screen = { widthPx: 800, heightPx: 600 };
const viewport: PresenceViewport = { x: 10, y: 20, w: 200, h: 100, zoom: 2 };
const ada: PresenceState = {
  principal: { id: 'ada', kind: 'user', name: 'Ada', color: '#0090ff' },
  viewport,
  page: 'page-1',
  updatedAt: 1,
};
const mira: PresenceState = { ...ada, principal: { ...ada.principal, id: 'mira', name: 'Mira' } };

function context(snapshot: PresenceSnapshot, localState: PresenceState = ada) {
  return { snapshot, screen, localClientId: 1, localState };
}

function next(
  state: unknown,
  event: unknown,
  snapshot: PresenceSnapshot,
  localState?: PresenceState,
): Record<string, unknown> {
  return api.nextFollow(state, event, context(snapshot, localState)) as Record<string, unknown>;
}

const following = {
  kind: 'following',
  clientId: 2,
  principalId: 'mira',
  name: 'Mira',
  cause: 'chosen',
};

describe('follow state', () => {
  it('starts a chosen follow fitted to the local screen and can switch people', () => {
    const snapshot = new Map([
      [2, mira],
      [3, { ...ada, principal: { ...ada.principal, id: 'jo', name: 'Jo' } }],
    ]);
    expect(Reflect.get(collab, 'IDLE_FOLLOW')).toEqual({ kind: 'idle' });
    expect(next({ kind: 'idle' }, { type: 'follow', clientId: 2 }, snapshot)).toEqual({
      state: following,
      viewport: computeFollowViewport(viewport, screen),
      notice: { kind: 'started', name: 'Mira' },
    });
    expect(next(following, { type: 'follow', clientId: 3 }, snapshot)).toMatchObject({
      state: { kind: 'following', clientId: 3, principalId: 'jo', name: 'Jo', cause: 'chosen' },
      notice: { kind: 'started', name: 'Jo' },
    });
  });

  it.each([
    ['absent', 9, new Map()],
    ['self', 1, new Map([[1, ada]])],
    ['no viewport', 2, new Map([[2, { ...mira, viewport: undefined }]])],
    ['another page', 2, new Map([[2, { ...mira, page: 'page-2' }]])],
  ])('keeps state when chosen target is %s', (caseName, clientId, snapshot) => {
    expect(next({ kind: 'idle' }, { type: 'follow', clientId }, snapshot)).toEqual({
      state: { kind: 'idle' },
      notice: {
        kind: 'unavailable',
        name: caseName === 'absent' ? '' : caseName === 'self' ? 'Ada' : 'Mira',
      },
    });
  });

  it.each(['escape', 'camera', 'button'])('stops a chosen follow by %s', (reason) => {
    expect(next(following, { type: 'stop', reason }, new Map([[2, mira]]))).toEqual({
      state: { kind: 'idle' },
      notice: { kind: 'stopped', name: 'Mira', reason },
    });
    expect(next({ kind: 'idle' }, { type: 'stop', reason }, new Map())).toEqual({
      state: { kind: 'idle' },
    });
  });

  it('tracks new viewport data and stops on leave, page change or missing viewport', () => {
    const moved = { ...mira, viewport: { ...viewport, x: 40 } };
    expect(next(following, { type: 'presence' }, new Map([[2, moved]]))).toEqual({
      state: following,
      viewport: computeFollowViewport(moved.viewport, screen),
    });
    for (const [remote, reason] of [
      [undefined, 'left'],
      [{ ...mira, page: 'page-2' }, 'page'],
      [{ ...mira, viewport: undefined }, 'unavailable'],
    ] as const) {
      expect(
        next(
          following,
          { type: 'presence' },
          remote === undefined ? new Map() : new Map([[2, remote]]),
        ),
      ).toEqual({ state: { kind: 'idle' }, notice: { kind: 'stopped', name: 'Mira', reason } });
    }
  });

  it('spotlight replaces chosen follow and changes page when necessary', () => {
    const spotlighter = { ...mira, page: 'page-2', spotlight: { startedAt: 100 } };
    expect(next(following, { type: 'presence' }, new Map([[2, spotlighter]]))).toEqual({
      state: {
        kind: 'following',
        clientId: 2,
        principalId: 'mira',
        name: 'Mira',
        cause: 'spotlight',
      },
      viewport: computeFollowViewport(viewport, screen),
      page: 'page-2',
      notice: { kind: 'spotlight', name: 'Mira' },
    });
  });

  it('newer spotlight takes over, then ending it stops its follow', () => {
    const first = { ...mira, spotlight: { startedAt: 100 } };
    const second = {
      ...ada,
      principal: { ...ada.principal, id: 'jo', name: 'Jo' },
      spotlight: { startedAt: 101 },
    };
    const current = {
      kind: 'following',
      clientId: 2,
      principalId: 'mira',
      name: 'Mira',
      cause: 'spotlight',
    };
    const takeover = next(
      current,
      { type: 'presence' },
      new Map([
        [2, first],
        [3, second],
      ]),
    );
    expect(takeover).toEqual({
      state: { kind: 'following', clientId: 3, principalId: 'jo', name: 'Jo', cause: 'spotlight' },
      viewport: computeFollowViewport(viewport, screen),
      notice: { kind: 'spotlightTakenOver', name: 'Jo', previous: 'Mira' },
    });
    expect(
      next(
        takeover.state,
        { type: 'presence' },
        new Map([[3, { ...ada, principal: second.principal }]]),
      ),
    ).toEqual({
      state: { kind: 'idle' },
      notice: { kind: 'stopped', name: 'Jo', reason: 'spotlightEnded' },
    });
  });

  it('keeps a stop opt out for the same spotlight but follows the next one', () => {
    const first = { ...mira, spotlight: { startedAt: 100 } };
    const snapshot = new Map([[2, first]]);
    const current = {
      kind: 'following',
      clientId: 2,
      principalId: 'mira',
      name: 'Mira',
      cause: 'spotlight',
    };
    const stopped = next(current, { type: 'stop', reason: 'button' }, snapshot);
    expect(stopped).toEqual({
      state: { kind: 'idle', optedOutOf: 100 },
      notice: { kind: 'stopped', name: 'Mira', reason: 'button' },
    });
    expect(next(stopped.state, { type: 'presence' }, snapshot).state).toEqual({
      kind: 'idle',
      optedOutOf: 100,
    });
    expect(
      next(
        stopped.state,
        { type: 'presence' },
        new Map([[2, { ...first, spotlight: { startedAt: 101 } }]]),
      ),
    ).toMatchObject({
      state: {
        kind: 'following',
        cause: 'spotlight',
        clientId: 2,
        principalId: 'mira',
        name: 'Mira',
      },
      notice: { kind: 'spotlight', name: 'Mira' },
    });
  });

  it('does not follow its own spotlight and ends an existing spotlight follow when local wins', () => {
    const local = { ...ada, spotlight: { startedAt: 200 } };
    expect(next({ kind: 'idle' }, { type: 'presence' }, new Map(), local)).toEqual({
      state: { kind: 'idle' },
    });
    expect(
      next(
        { kind: 'following', clientId: 2, principalId: 'mira', name: 'Mira', cause: 'spotlight' },
        { type: 'presence' },
        new Map([[2, { ...mira, spotlight: { startedAt: 100 } }]]),
        local,
      ),
    ).toEqual({
      state: { kind: 'idle' },
      notice: { kind: 'stopped', name: 'Mira', reason: 'spotlightEnded' },
    });
  });
});
