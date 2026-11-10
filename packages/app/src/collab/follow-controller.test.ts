import { describe, expect, it } from 'vitest';

import { isValidSpotlight } from '@canvas/collab';
import type {
  PresenceClientId,
  PresenceSpotlight,
  PresenceState,
  PresenceViewport,
} from '@canvas/collab';

import { FollowController, followMessageOf, type FollowHost } from './follow-controller.js';

const VIEWPORT: PresenceViewport = { x: 0, y: 0, w: 400, h: 300, zoom: 2 };

/**
 * A presence state for a person.
 *
 * @param id - Their principal id.
 * @param name - Their name.
 * @param fields - More fields.
 * @returns The state.
 */
function person(id: string, name: string, fields: Partial<PresenceState> = {}): PresenceState {
  return {
    principal: { id, kind: 'user', name, color: '#0090ff' },
    viewport: VIEWPORT,
    updatedAt: 1,
    ...fields,
  };
}

/**
 * A fake board: presence it can change, and a record of what the controller did.
 *
 * @returns The host, its record and setters.
 */
function fakeHost() {
  let remote = new Map<PresenceClientId, PresenceState>();
  let local = person('me', 'Me');
  const listeners = new Set<() => void>();
  const record = {
    viewports: [] as PresenceViewport[],
    pages: [] as string[],
    announced: [] as [string, boolean][],
    spotlights: [] as (PresenceSpotlight | null)[],
    following: [] as (string | null)[],
  };
  const host: FollowHost = {
    remote: () => remote,
    local: () => ({ clientId: 1, state: local }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    showSpotlight: (spotlight) => {
      record.spotlights.push(spotlight);
      const next: PresenceState = { ...local };
      Reflect.deleteProperty(next, 'spotlight');
      local = spotlight === null ? next : { ...next, spotlight };
    },
    screen: () => ({ widthPx: 800, heightPx: 600 }),
    showViewport: (viewport) => record.viewports.push(viewport),
    showFollowing: (principalId) => record.following.push(principalId),
    showPage: (page) => record.pages.push(page),
    announce: (message, isToast) => record.announced.push([message, isToast]),
    now: () => 500,
    canSpotlight: () => true,
  };
  const setRemote = (next: Map<PresenceClientId, PresenceState>) => {
    remote = next;
    for (const listener of [...listeners]) listener();
  };
  return { host, record, setRemote };
}

describe('FollowController', () => {
  it('follows a chosen person, tracks them, and stops with the camera', () => {
    const { host, record, setRemote } = fakeHost();
    setRemote(new Map([[2, person('ana', 'Ana')]]));
    const controller = new FollowController(host);
    controller.follow('ana');
    expect(controller.view().follow).toMatchObject({ kind: 'following', name: 'Ana' });
    expect(record.following).toEqual(['ana']);
    expect(record.viewports).toHaveLength(1);
    expect(record.announced.at(-1)).toEqual(['Following Ana.', false]);
    setRemote(new Map([[2, person('ana', 'Ana', { viewport: { ...VIEWPORT, x: 50 } })]]));
    expect(record.viewports).toHaveLength(2);
    controller.stop('camera');
    expect(controller.view().follow.kind).toBe('idle');
    expect(record.following).toEqual(['ana', null]);
    expect(record.announced.at(-1)).toEqual(['Stopped following Ana.', false]);
    controller.destroy();
  });

  it('is taken by a spotlight with a toast, and clears its own when a newer one wins', () => {
    const { host, record, setRemote } = fakeHost();
    const controller = new FollowController(host);
    controller.startSpotlight();
    expect(record.spotlights).toEqual([{ startedAt: 500 }]);
    expect(controller.view().isSpotlighting).toBe(true);
    setRemote(new Map([[2, person('ana', 'Ana', { spotlight: { startedAt: 600 } })]]));
    expect(record.spotlights.at(-1)).toBeNull();
    expect(record.announced).toContainEqual(['Ana took over the spotlight.', true]);
    expect(controller.view()).toMatchObject({
      isSpotlighting: false,
      follow: { kind: 'following', cause: 'spotlight', name: 'Ana' },
    });
    controller.destroy();
  });

  it("follows a person's client on the local page, not their newer one elsewhere", () => {
    const { host, setRemote } = fakeHost();
    setRemote(
      new Map([
        [2, person('ana', 'Ana', { updatedAt: 1 })],
        [3, person('ana', 'Ana', { page: 'p2', updatedAt: 5 })],
      ]),
    );
    const controller = new FollowController(host);
    expect(controller.canFollow('ana')).toBe(true);
    controller.follow('ana');
    expect(controller.view().follow).toMatchObject({ kind: 'following', clientId: 2 });
    setRemote(new Map([[3, person('ana', 'Ana', { page: 'p2', updatedAt: 5 })]]));
    expect(controller.canFollow('ana')).toBe(false);
  });

  it('starts a spotlight after one whose sender clock runs ahead, so it takes over', () => {
    const { host, record, setRemote } = fakeHost();
    setRemote(new Map([[2, person('ana', 'Ana', { spotlight: { startedAt: 900 } })]]));
    const controller = new FollowController(host);
    controller.startSpotlight();
    expect(record.spotlights.at(-1)).toEqual({ startedAt: 901 });
    expect(controller.view().isSpotlighting).toBe(true);
  });

  it('starts at the largest valid time, and does not share a start that loses its tie', () => {
    const { host, record, setRemote } = fakeHost();
    const top = { startedAt: Number.MAX_SAFE_INTEGER };
    // A larger client id than the local one (1) loses the tie at the top: the start is shared.
    setRemote(new Map([[2, person('ana', 'Ana', { spotlight: top })]]));
    const winning = new FollowController(host);
    winning.startSpotlight();
    expect(record.spotlights.at(-1)).toEqual(top);
    expect(isValidSpotlight(record.spotlights.at(-1))).toBe(true);
    expect(winning.view().isSpotlighting).toBe(true);
    winning.endSpotlight();
    winning.destroy();
    // A smaller one wins it: nothing is shared, and the person hears who holds the spotlight.
    setRemote(new Map([[0, person('ana', 'Ana', { spotlight: top })]]));
    const losing = new FollowController(host);
    const shared = record.spotlights.length;
    losing.startSpotlight();
    expect(record.spotlights).toHaveLength(shared);
    expect(losing.view().isSpotlighting).toBe(false);
    expect(record.announced.at(-1)).toEqual(['Ana holds the spotlight.', true]);
  });

  it('offers the spotlight before the camera reports a screen, and follows nobody yet', () => {
    const { host } = fakeHost();
    const controller = new FollowController({ ...host, screen: () => undefined });
    expect(controller.view().canSpotlight).toBe(true);
    expect(controller.self()).toMatchObject({ id: 'me', name: 'Me' });
    controller.follow('ana');
    expect(controller.view().follow.kind).toBe('idle');
  });

  it('counts the people following the spotlight and ends it', () => {
    const { host, setRemote } = fakeHost();
    const controller = new FollowController(host);
    controller.startSpotlight();
    setRemote(
      new Map([
        [2, person('ana', 'Ana', { following: 'me' })],
        [3, person('jo', 'Jo', { following: 'me' })],
        [4, person('kim', 'Kim')],
      ]),
    );
    expect(controller.view().audience).toBe(2);
    controller.endSpotlight();
    expect(controller.view()).toMatchObject({ isSpotlighting: false, audience: 0 });
    controller.destroy();
  });

  it('says what each notice means', () => {
    expect(followMessageOf({ kind: 'stopped', name: 'Ana', reason: 'left' })).toBe(
      'Ana left. Stopped following.',
    );
    expect(followMessageOf({ kind: 'stopped', name: 'Ana', reason: 'page' })).toBe(
      'Ana went to another page. Stopped following.',
    );
    expect(followMessageOf({ kind: 'stopped', name: 'Ana', reason: 'spotlightEnded' })).toBe(
      "Ana's spotlight ended.",
    );
    expect(followMessageOf({ kind: 'spotlight', name: 'Ana' })).toBe(
      "Ana started a spotlight. You're following Ana's view.",
    );
    expect(followMessageOf({ kind: 'spotlightTakenOver', name: 'Jo', previous: 'Ana' })).toBe(
      'Jo took over the spotlight from Ana.',
    );
    expect(followMessageOf({ kind: 'unavailable', name: 'Claude' })).toBe(
      'Claude has no view to follow yet.',
    );
    expect(followMessageOf({ kind: 'unavailable', name: '' })).toBe('That person has left.');
  });
});
