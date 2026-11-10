// A peer controls its awareness state entirely, and the relay hands it to every client, viewers
// included. The name is drawn beside its cursor and joined into the connection chip's
// tooltip, so it is bounded and cleaned; an over-long name is shortened, not a reason to make a
// collaborator invisible; an over-long id, or a selected id, is dropped; a selection is capped.
import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { linkAwareness } from './__fixtures__/awareness-link.js';
import { ManualTime } from './__fixtures__/manual-time.js';
import { PresenceChannel } from './presence-channel.js';
import { isPresencePrincipal, isPresenceState } from './presence-guard.js';
import {
  MAX_PRESENCE_ID_LENGTH,
  MAX_PRESENCE_SELECTION_LENGTH,
  MAX_PRESENCE_TEXT_LENGTH,
} from './presence-limits.js';
import { clampAtBoundary, cleanPresenceName } from './presence-names.js';

const principal = { id: 'user-1', kind: 'user', name: 'Ada', color: '#1f77b4' };
const docs: Y.Doc[] = [];

afterEach(() => {
  for (const doc of docs.splice(0)) doc.destroy();
});

/**
 * A fresh awareness instance.
 *
 * @returns The awareness.
 */
function createAwareness(): Awareness {
  const doc = new Y.Doc();
  docs.push(doc);
  return new Awareness(doc);
}

/** The spoofing and line-breaking characters a name must not carry, one of each family. */
const HOSTILE =
  '\u0000\u0007\u001b\u0085\u009b\u2028\u2029\u202a\u202e\u2066\u2069\u200e\u200f\u061c';

describe('cleanPresenceName', () => {
  it('strips C0 and C1 controls, line separators and bidi controls', () => {
    expect(cleanPresenceName(`A${HOSTILE}da`)).toBe('Ada');
    expect(cleanPresenceName(HOSTILE)).toBe('');
  });

  it('keeps ordinary text, emoji and other scripts', () => {
    expect(cleanPresenceName('Ada 😀 Löve — 名前')).toBe('Ada 😀 Löve — 名前');
  });

  it('cuts to the bound and never splits a surrogate pair', () => {
    const name = cleanPresenceName(`a${'😀'.repeat(MAX_PRESENCE_TEXT_LENGTH)}`);
    expect(name.length).toBeLessThanOrEqual(MAX_PRESENCE_TEXT_LENGTH);
    expect(name).not.toMatch(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
    );
    expect(name.startsWith('a😀')).toBe(true);
  });

  it('is fast on a 5 MB name', () => {
    const started = performance.now();
    const name = cleanPresenceName('x'.repeat(5_000_000));
    expect(name).toHaveLength(MAX_PRESENCE_TEXT_LENGTH);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('clampAtBoundary', () => {
  const family = '👨‍👩‍👧‍👦';

  it('keeps a whole grapheme cluster, dropping one that does not fit, when it can segment', () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const text = `${'a'.repeat(250)}${family}`;
    expect(clampAtBoundary(text, MAX_PRESENCE_TEXT_LENGTH, segmenter)).toBe('a'.repeat(250));
  });

  it('cuts at a code point without a segmenter, never inside a pair', () => {
    const text = `${'a'.repeat(255)}😀`;
    expect(clampAtBoundary(text, MAX_PRESENCE_TEXT_LENGTH, undefined)).toBe('a'.repeat(255));
    expect(clampAtBoundary('short', MAX_PRESENCE_TEXT_LENGTH, undefined)).toBe('short');
  });

  it('cuts inside a cluster longer than the bound rather than returning nothing', () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const zalgo = `e${'́'.repeat(400)}`;
    const cut = clampAtBoundary(zalgo, MAX_PRESENCE_TEXT_LENGTH, segmenter);
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.length).toBeLessThanOrEqual(MAX_PRESENCE_TEXT_LENGTH);
  });
});

describe('the guards', () => {
  it('accept any name and an id up to the bound', () => {
    expect(isPresencePrincipal({ ...principal, name: 'n'.repeat(5_000) })).toBe(true);
    expect(isPresencePrincipal({ ...principal, id: 'i'.repeat(MAX_PRESENCE_TEXT_LENGTH) })).toBe(
      true,
    );
    expect(
      isPresencePrincipal({ ...principal, id: 'i'.repeat(MAX_PRESENCE_TEXT_LENGTH + 1) }),
    ).toBe(false);
  });

  it('accept a selection list whatever its ids, which the channel then filters', () => {
    const state = (selection: unknown) => ({ principal, selection, updatedAt: 0 });
    expect(isPresenceState(state(['a'.repeat(MAX_PRESENCE_ID_LENGTH + 1), 'b']))).toBe(true);
    expect(isPresenceState(state([1]))).toBe(false);
  });
});

describe('a peer that sends an oversized or hostile state', () => {
  /**
   * Opens a receiver and sends it one raw state from a peer.
   *
   * @param state - What the peer's awareness holds.
   * @returns The receiver's channel and the clock.
   */
  function receive(state: unknown): { channel: PresenceChannel; time: ManualTime } {
    const time = new ManualTime();
    const hostile = createAwareness();
    const receiver = createAwareness();
    linkAwareness(hostile, receiver, () => time.now());
    const channel = new PresenceChannel({
      awareness: receiver,
      principal: { id: 'me', kind: 'user', name: 'Me' },
      clock: time,
      scheduler: time,
    });
    hostile.setLocalState(state as Record<string, unknown>);
    time.advanceBy(100);
    return { channel, time };
  }

  it('keeps the peer and shortens a 5 MB name', () => {
    const { channel } = receive({
      principal: { ...principal, name: 'x'.repeat(5_000_000) },
      updatedAt: 0,
    });
    const [peer] = [...channel.getRemote().values()];
    expect(peer?.principal.name).toHaveLength(MAX_PRESENCE_TEXT_LENGTH);
    channel.destroy();
  });

  it('keeps the peer and strips the hostile characters from its name', () => {
    const { channel } = receive({
      principal: { ...principal, name: `Ev${HOSTILE}e` },
      updatedAt: 0,
    });
    expect([...channel.getRemote().values()].map((state) => state.principal.name)).toEqual(['Eve']);
    channel.destroy();
  });

  it('keeps the peer with an empty name when nothing is left of it', () => {
    const { channel } = receive({ principal: { ...principal, name: HOSTILE }, updatedAt: 0 });
    expect([...channel.getRemote().values()].map((state) => state.principal.name)).toEqual(['']);
    channel.destroy();
  });

  it('leaves out a peer whose id is over the bound', () => {
    const { channel } = receive({
      principal: { ...principal, id: 'x'.repeat(5_000_000) },
      updatedAt: 0,
    });
    expect(channel.getRemote().size).toBe(0);
    channel.destroy();
  });

  it('drops the selected ids over the bound and keeps the rest, and the peer', () => {
    const { channel } = receive({
      principal,
      selection: ['s'.repeat(5_000_000), 'ok', '', 'x'.repeat(MAX_PRESENCE_ID_LENGTH)],
      updatedAt: 0,
    });
    const [peer] = [...channel.getRemote().values()];
    expect(peer?.selection).toEqual(['ok', 'x'.repeat(MAX_PRESENCE_ID_LENGTH)]);
    channel.destroy();
  });

  it('keeps the first 1,000 ids of a longer selection', () => {
    const ids = [...Array(5_000).keys()].map((index) => `o${String(index)}`);
    const { channel } = receive({ principal, selection: ids, updatedAt: 0 });
    const [peer] = [...channel.getRemote().values()];
    expect(peer?.selection).toEqual(ids.slice(0, MAX_PRESENCE_SELECTION_LENGTH));
    channel.destroy();
  });

  it('gives the same snapshot again while the state is unchanged', () => {
    const { channel, time } = receive({
      principal: { ...principal, name: `A${HOSTILE}` },
      updatedAt: 0,
    });
    const first = channel.getRemote();
    time.advanceBy(100);
    expect(channel.getRemote()).toBe(first);
    channel.destroy();
  });
});

describe('the local principal', () => {
  it('shortens and cleans a long name instead of throwing, and keeps working', () => {
    const time = new ManualTime();
    const awareness = createAwareness();
    const channel = new PresenceChannel({
      awareness,
      principal: { id: 'me', kind: 'user', name: `A${HOSTILE}${'n'.repeat(1_000)}` },
      clock: time,
      scheduler: time,
    });
    const sent = (awareness.getLocalState() as { principal: { name: string } }).principal.name;
    expect(sent).toHaveLength(MAX_PRESENCE_TEXT_LENGTH);
    expect(sent.startsWith('Ann')).toBe(true);
    channel.destroy();
  });

  it('still refuses an id past the bound', () => {
    expect(
      () =>
        new PresenceChannel({
          awareness: createAwareness(),
          principal: { id: 'x'.repeat(MAX_PRESENCE_TEXT_LENGTH + 1), kind: 'user', name: 'Me' },
        }),
    ).toThrow(RangeError);
  });

  it('caps the local selection it sends at 1,000 ids', () => {
    const time = new ManualTime();
    const awareness = createAwareness();
    const channel = new PresenceChannel({
      awareness,
      principal: { id: 'me', kind: 'user', name: 'Me' },
      clock: time,
      scheduler: time,
    });
    channel.setLocal({
      selection: [...Array(5_000).keys()].map((index) => `o${String(index)}`),
    });
    time.advanceBy(100);
    const state = awareness.getLocalState() as { selection: string[] };
    expect(state.selection).toHaveLength(MAX_PRESENCE_SELECTION_LENGTH);
    channel.destroy();
  });
});
