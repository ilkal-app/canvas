import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import * as collab from '../index.js';

import { linkAwareness } from './__fixtures__/awareness-link.js';
import { ManualTime } from './__fixtures__/manual-time.js';
import { PresenceChannel } from './presence-channel.js';
import { sanitizePresenceState } from './presence-sanitize.js';
import type { PresenceState } from './presence-state.js';

const principal = { id: 'ada', kind: 'user', name: 'Ada', color: '#0090ff' } as const;
const base: PresenceState = { principal, updatedAt: 1 };
const docs: Y.Doc[] = [];

function awareness(): Awareness {
  const doc = new Y.Doc();
  docs.push(doc);
  return new Awareness(doc);
}

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy();
});

const api = collab as unknown as {
  isValidSpotlight(value: unknown): boolean;
  activeSpotlight(snapshot: unknown, local?: unknown): unknown;
  isSpotlightSuperseded(local: unknown, snapshot: unknown, localClientId: number): boolean;
  canSpotlight(role: string): boolean;
};
const spotlightOf = (value: unknown): unknown =>
  (value as { spotlight?: unknown } | undefined)?.spotlight;

describe('spotlight presence', () => {
  it.each([
    {},
    { startedAt: 0 },
    { startedAt: -1 },
    { startedAt: NaN },
    { startedAt: Infinity },
    { startedAt: '1' },
    { startedAt: Number.MAX_SAFE_INTEGER + 1 },
    [],
    'spotlight',
  ])('rejects invalid spotlight %j', (value) => {
    expect(api.isValidSpotlight(value)).toBe(false);
  });

  it('accepts finite positive sender timestamps through the safe integer ceiling', () => {
    expect(api.isValidSpotlight({ startedAt: 1 })).toBe(true);
    expect(api.isValidSpotlight({ startedAt: Number.MAX_SAFE_INTEGER })).toBe(true);
  });

  it('sanitizes a valid spotlight to its timestamp and drops an invalid one', () => {
    expect(
      spotlightOf(
        sanitizePresenceState({
          ...base,
          spotlight: { startedAt: 9, forged: true },
        } as PresenceState),
      ),
    ).toEqual({ startedAt: 9 });
    expect(
      spotlightOf(sanitizePresenceState({ ...base, spotlight: { startedAt: 0 } })),
    ).toBeUndefined();
  });

  it('sets, retains and clears spotlight through awareness without changing the document', () => {
    const time = new ManualTime();
    const sender = awareness();
    const receiver = awareness();
    linkAwareness(sender, receiver, () => time.now());
    const ada = new PresenceChannel({ awareness: sender, principal, clock: time, scheduler: time });
    const mira = new PresenceChannel({
      awareness: receiver,
      principal: { id: 'mira', kind: 'user', name: 'Mira' },
      clock: time,
      scheduler: time,
    });
    const before = Y.encodeStateAsUpdate(sender.doc);
    ada.setLocal({ spotlight: { startedAt: 100 } });
    time.advanceBy(100);
    expect(spotlightOf(ada.getLocal())).toEqual({ startedAt: 100 });
    expect(spotlightOf(mira.getRemote().get(sender.clientID))).toEqual({ startedAt: 100 });
    ada.setLocal({ cursor: { x: 1, y: 2 } });
    time.advanceBy(100);
    expect(spotlightOf(mira.getRemote().get(sender.clientID))).toEqual({ startedAt: 100 });
    ada.setLocal({ spotlight: null });
    time.advanceBy(100);
    expect(spotlightOf(ada.getLocal())).toBeUndefined();
    expect(spotlightOf(mira.getRemote().get(sender.clientID))).toBeUndefined();
    expect(Y.encodeStateAsUpdate(sender.doc)).toEqual(before);
  });

  it('does not expose an invalid spotlight from raw remote awareness', () => {
    const time = new ManualTime();
    const sender = awareness();
    const receiver = awareness();
    linkAwareness(sender, receiver, () => time.now());
    const mira = new PresenceChannel({
      awareness: receiver,
      principal: { id: 'mira', kind: 'user', name: 'Mira' },
      clock: time,
      scheduler: time,
    });
    sender.setLocalState({ ...base, spotlight: { startedAt: NaN } });
    time.advanceBy(0);
    expect(mira.getRemote().get(sender.clientID)?.principal.id).toBe('ada');
    expect(spotlightOf(mira.getRemote().get(sender.clientID))).toBeUndefined();
  });

  it('chooses the newest spotlight including local state, breaking ties by client id', () => {
    const other = {
      ...base,
      principal: { ...principal, id: 'mira', name: 'Mira' },
      spotlight: { startedAt: 20 },
    };
    const snapshot = new Map<number, PresenceState>([
      [7, other],
      [3, { ...base, spotlight: { startedAt: 20 } }],
    ]);
    expect(api.activeSpotlight(snapshot)).toEqual({ clientId: 3, principal, startedAt: 20 });
    expect(
      api.activeSpotlight(snapshot, {
        clientId: 9,
        state: { ...base, spotlight: { startedAt: 21 } },
      }),
    ).toEqual({ clientId: 9, principal, startedAt: 21 });
    expect(api.activeSpotlight(new Map())).toBeUndefined();
  });

  it('marks a local spotlight superseded only by a newer remote or a lower id tie', () => {
    const local = { ...base, spotlight: { startedAt: 20 } };
    expect(
      api.isSpotlightSuperseded(
        local,
        new Map([[3, { ...base, spotlight: { startedAt: 20 } }]]),
        5,
      ),
    ).toBe(true);
    expect(
      api.isSpotlightSuperseded(
        local,
        new Map([[7, { ...base, spotlight: { startedAt: 20 } }]]),
        5,
      ),
    ).toBe(false);
    expect(
      api.isSpotlightSuperseded(
        local,
        new Map([[7, { ...base, spotlight: { startedAt: 21 } }]]),
        5,
      ),
    ).toBe(true);
  });

  it.each([
    ['owner', true],
    ['editor', true],
    ['commenter', false],
    ['viewer', false],
  ])('allows %s to start spotlight: %s', (role, canStart) => {
    expect(api.canSpotlight(role)).toBe(canStart);
  });
});
