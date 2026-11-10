import { afterEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { linkAwareness } from './__fixtures__/awareness-link.js';
import { ManualTime } from './__fixtures__/manual-time.js';
import { PresenceChannel } from './presence-channel.js';
import type { PresenceChannelOptions } from './presence-channel.js';
import { colorForPrincipal } from './presence-color.js';
import type { PresenceSnapshot, PrincipalKind } from './presence-state.js';

const docs: Y.Doc[] = [];

afterEach(() => {
  // Destroying a doc destroys its awareness, which stops awareness's own renewal interval.
  for (const doc of docs.splice(0)) {
    doc.destroy();
  }
});

function createAwareness(): Awareness {
  const doc = new Y.Doc();
  docs.push(doc);
  return new Awareness(doc);
}

function openChannel(
  awareness: Awareness,
  time: ManualTime,
  name: string,
  options: Partial<PresenceChannelOptions> & { kind?: PrincipalKind } = {},
): PresenceChannel {
  return new PresenceChannel({
    awareness,
    principal: { id: `${name}-id`, kind: options.kind ?? 'user', name },
    clock: time,
    scheduler: time,
    ...options,
  });
}

function names(snapshot: PresenceSnapshot): string[] {
  return [...snapshot.values()].map((state) => state.principal.name).sort();
}

describe('PresenceChannel outbound', () => {
  it('sends at most the configured rate while the pointer moves at 60 Hz', () => {
    const time = new ManualTime();
    const sender = createAwareness();
    const link = linkAwareness(sender, createAwareness(), () => time.now());
    const channel = openChannel(sender, time, 'Ada', { rateHz: 25 });

    for (let frame = 0; frame < 120; frame += 1) {
      time.advanceTo((frame * 1000) / 60);
      channel.setLocal({ cursor: { x: frame, y: 0 } });
    }
    time.advanceBy(1000);

    for (const startMs of link.sentAtMs) {
      const inWindow = link.sentAtMs.filter((at) => at >= startMs && at < startMs + 1000);
      expect(inWindow.length).toBeLessThanOrEqual(25);
    }
    expect(link.messageCount).toBeGreaterThanOrEqual(49);
    expect(link.messageCount).toBeLessThanOrEqual(51);
  });

  it('flushes the last position on the trailing edge, so a stopped pointer is exact', () => {
    const time = new ManualTime();
    const sender = createAwareness();
    const receiver = createAwareness();
    const link = linkAwareness(sender, receiver, () => time.now());
    const channel = openChannel(sender, time, 'Ada');
    const remote = openChannel(receiver, time, 'Grace');
    time.advanceBy(100);

    channel.setLocal({ cursor: { x: 1, y: 1 } });
    time.advanceBy(10);
    channel.setLocal({ cursor: { x: 2, y: 2 } });
    time.advanceBy(10);
    channel.setLocal({ cursor: { x: 3, y: 3 } });
    time.advanceBy(19);

    expect(remote.getRemote().get(sender.clientID)?.cursor).toEqual({ x: 1, y: 1 });
    time.advanceBy(1);
    expect(remote.getRemote().get(sender.clientID)?.cursor).toEqual({ x: 3, y: 3 });
    expect(link.sentAtMs).toEqual([0, 100, 140]);
  });

  it('carries every field changed inside one interval in the single trailing message', () => {
    const time = new ManualTime();
    const sender = createAwareness();
    const receiver = createAwareness();
    const link = linkAwareness(sender, receiver, () => time.now());
    const channel = openChannel(sender, time, 'Ada');
    time.advanceBy(100);

    channel.setLocal({ cursor: { x: 1, y: 1 } });
    time.advanceBy(10);
    channel.setLocal({ selection: ['note-1'] });
    time.advanceBy(10);
    channel.setLocal({ cursor: { x: 2, y: 2 } });
    time.advanceBy(19);
    expect(receiver.getStates().get(sender.clientID)).not.toHaveProperty('selection');
    time.advanceBy(1);

    expect(link.sentAtMs).toEqual([0, 100, 140]);
    expect(receiver.getStates().get(sender.clientID)).toMatchObject({
      cursor: { x: 2, y: 2 },
      selection: ['note-1'],
    });
  });

  it('merges partial updates into the local state it broadcasts', () => {
    const time = new ManualTime();
    const channel = openChannel(createAwareness(), time, 'Ada');
    const viewport = { x: 0, y: 0, w: 1280, h: 800, zoom: 1 };

    channel.setLocal({ viewport });
    time.advanceBy(100);
    channel.setLocal({ cursor: { x: 4, y: 5 }, selection: ['note-1'] });
    time.advanceBy(100);
    channel.setLocal({ cursor: null });

    expect(channel.getLocal()).toEqual({
      principal: { id: 'Ada-id', kind: 'user', name: 'Ada', color: colorForPrincipal('Ada-id') },
      selection: ['note-1'],
      viewport,
      updatedAt: 200,
    });
  });

  it('rejects a presence rate outside 20 to 30 Hz', () => {
    const time = new ManualTime();

    expect(() => openChannel(createAwareness(), time, 'Ada', { rateHz: 60 })).toThrow(RangeError);
  });

  it('rejects a timeout outside 20 to 30 s, the range that agrees with y-protocols', () => {
    const time = new ManualTime();

    for (const timeoutMs of [0, 10_000, 19_999, 30_001, Number.NaN]) {
      expect(() => openChannel(createAwareness(), time, 'Ada', { timeoutMs })).toThrow(RangeError);
    }
    expect(() => openChannel(createAwareness(), time, 'Ada', { timeoutMs: 20_000 })).not.toThrow();
  });

  it('rejects a malformed principal', () => {
    const time = new ManualTime();

    expect(() =>
      openChannel(createAwareness(), time, 'Ada', {
        principal: { id: 'ada', kind: 'user', name: 'Ada', color: 'blue' },
      }),
    ).toThrow(RangeError);
  });

  it('keeps a colour the principal brings', () => {
    const time = new ManualTime();
    const channel = openChannel(createAwareness(), time, 'Ada', {
      principal: { id: 'ada', kind: 'user', name: 'Ada', color: '#123456' },
    });

    expect(channel.getLocal().principal.color).toBe('#123456');
  });

  it('runs on the wall clock and setTimeout when no time is injected', () => {
    vi.useFakeTimers({ now: 5_000 });
    try {
      const sender = createAwareness();
      const channel = new PresenceChannel({
        awareness: sender,
        principal: { id: 'ada', kind: 'user', name: 'Ada' },
      });
      channel.setLocal({ cursor: { x: 1, y: 1 } });
      expect(sender.getLocalState()).not.toHaveProperty('cursor');

      vi.advanceTimersByTime(40);
      expect(sender.getLocalState()).toMatchObject({ cursor: { x: 1, y: 1 }, updatedAt: 5_000 });
      channel.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PresenceChannel inbound', () => {
  it('coalesces a burst of updates from many clients into one snapshot per flush', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me');
    const snapshots: PresenceSnapshot[] = [];
    local.subscribe((snapshot) => snapshots.push(snapshot));

    for (const name of ['Ada', 'Grace', 'Edsger']) {
      const sender = createAwareness();
      linkAwareness(sender, receiver, () => time.now());
      const channel = openChannel(sender, time, name);
      channel.setLocal({ cursor: { x: 1, y: 2 } });
    }
    time.advanceBy(0);

    expect(snapshots).toHaveLength(1);
    expect(names(snapshots[0] ?? new Map())).toEqual(['Ada', 'Edsger', 'Grace']);
  });

  it('shows agents in presence beside people', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me');
    const agent = createAwareness();
    linkAwareness(agent, receiver, () => time.now());
    openChannel(agent, time, 'Layout bot', { kind: 'agent' });
    time.advanceBy(0);

    expect(local.getRemote().get(agent.clientID)?.principal.kind).toBe('agent');
  });

  it('answers getRemote with the latest state before the flush, and still notifies once', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me');
    let notifications = 0;
    local.subscribe(() => (notifications += 1));
    const sender = createAwareness();
    linkAwareness(sender, receiver, () => time.now());
    openChannel(sender, time, 'Ada');

    expect(names(local.getRemote())).toEqual(['Ada']);
    time.advanceBy(0);
    expect(notifications).toBe(1);
  });

  it('leaves out peers whose awareness state is not presence', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me');
    const stranger = createAwareness();
    linkAwareness(stranger, receiver, () => time.now());
    stranger.setLocalState({ user: 'not presence' });
    time.advanceBy(0);

    expect(local.getRemote().size).toBe(0);
  });

  it('notifies every listener when one throws, and rethrows the error on its own', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me');
    const failure = new Error('listener failed');
    const rethrown: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (callback: () => void) => rethrown.push(callback));
    let notifications = 0;
    local.subscribe(() => {
      throw failure;
    });
    local.subscribe(() => (notifications += 1));
    const sender = createAwareness();
    linkAwareness(sender, receiver, () => time.now());
    openChannel(sender, time, 'Ada');

    time.advanceBy(0);
    vi.unstubAllGlobals();

    expect(notifications).toBe(1);
    expect(rethrown).toHaveLength(1);
    expect(() => rethrown[0]?.()).toThrow(failure);
  });

  it('stops notifying a listener after it unsubscribes', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me');
    let notifications = 0;
    const unsubscribe = local.subscribe(() => (notifications += 1));
    unsubscribe();
    const sender = createAwareness();
    linkAwareness(sender, receiver, () => time.now());
    openChannel(sender, time, 'Ada');
    time.advanceBy(0);

    expect(notifications).toBe(0);
  });
});

describe('PresenceChannel lifetime', () => {
  it('removes a client that stops updating once the awareness timeout passes', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me', { timeoutMs: 20_000 });
    const sender = createAwareness();
    const link = linkAwareness(sender, receiver, () => time.now());
    openChannel(sender, time, 'Ada', { timeoutMs: 20_000 });
    time.advanceBy(0);
    link.cut();

    time.advanceBy(19_000);
    expect(names(local.getRemote())).toEqual(['Ada']);
    time.advanceBy(2_000);
    expect(local.getRemote().size).toBe(0);
  });

  it('keeps an idle but connected client, which renews its state every half timeout', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me', { timeoutMs: 20_000 });
    const sender = createAwareness();
    const link = linkAwareness(sender, receiver, () => time.now());
    openChannel(sender, time, 'Ada', { timeoutMs: 20_000 });

    time.advanceBy(120_000);

    expect(names(local.getRemote())).toEqual(['Ada']);
    expect(link.messageCount).toBeLessThanOrEqual(1 + 120_000 / 10_000);
  });

  it('says goodbye on destroy, so peers drop the client at once', () => {
    const time = new ManualTime();
    const receiver = createAwareness();
    const local = openChannel(receiver, time, 'Me');
    const sender = createAwareness();
    linkAwareness(sender, receiver, () => time.now());
    const channel = openChannel(sender, time, 'Ada');
    time.advanceBy(0);

    channel.destroy();
    time.advanceBy(0);

    expect(local.getRemote().size).toBe(0);
  });

  it('stops when its awareness is destroyed, leaving no timers behind', () => {
    const time = new ManualTime();
    const awareness = createAwareness();
    const channel = openChannel(awareness, time, 'Ada');

    awareness.doc.destroy();
    channel.setLocal({ cursor: { x: 1, y: 1 } });

    expect(time.pendingTaskCount).toBe(0);
    expect(channel.getLocal().cursor).toBeUndefined();
  });

  it('ignores local changes and a second destroy once destroyed', () => {
    const time = new ManualTime();
    const awareness = createAwareness();
    const channel = openChannel(awareness, time, 'Ada');

    channel.destroy();
    channel.setLocal({ cursor: { x: 1, y: 1 } });
    channel.destroy();
    time.advanceBy(1_000);

    expect(awareness.getLocalState()).toBeNull();
    expect(channel.getLocal().cursor).toBeUndefined();
  });
});

// A round trip through a real relay (presence join and leave) lives in tooling/e2e-sync
// (headless-client-relay.test.ts): collab may not import services/relay, even from tests.
describe('PresenceChannel persistence', () => {
  it('writes nothing into the Yjs document: presence is never persisted', () => {
    const time = new ManualTime();
    const doc = new Y.Doc();
    docs.push(doc);
    doc.getMap('objects').set('note-1', 'sticky');
    const before = Y.encodeStateAsUpdate(doc);
    const channel = openChannel(new Awareness(doc), time, 'Ada Lovelace');

    channel.setLocal({
      cursor: { x: 12, y: 34 },
      selection: ['note-1'],
      viewport: { x: 0, y: 0, w: 100, h: 100, zoom: 1 },
    });
    time.advanceBy(1_000);
    const after = Y.encodeStateAsUpdate(doc);

    expect(after).toEqual(before);
    expect(new TextDecoder().decode(after)).not.toContain('Ada Lovelace');
  });
});
