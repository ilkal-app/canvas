import { describe, expect, it } from 'vitest';

import { OutboundQueue } from './outbound-queue.js';

/** An update's bytes; the queue keeps them, never reads them. */
const UPDATE = new Uint8Array([0, 0]);

describe('OutboundQueue', () => {
  it('starts settled', () => {
    const queue = new OutboundQueue();
    expect(queue.pendingCount).toBe(0);
    expect(queue.isSettled).toBe(true);
  });

  it('holds offline updates until a step 2 carries them, and settles on its acknowledgement', () => {
    const queue = new OutboundQueue();
    queue.hold(UPDATE);
    queue.hold(UPDATE);
    queue.hold(UPDATE);
    expect(queue.pendingCount).toBe(3);
    expect(queue.sendHeld()).toBe(3);
    expect(queue.pendingCount).toBe(3);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(0);
    expect(queue.isSettled).toBe(true);
  });

  it('acknowledges messages in the order they were sent', () => {
    const queue = new OutboundQueue();
    queue.hold(UPDATE);
    queue.hold(UPDATE);
    queue.sendHeld();
    queue.sendOne(UPDATE);
    queue.sendOne(UPDATE);
    expect(queue.pendingCount).toBe(4);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(2);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(1);
    queue.acknowledge();
    expect(queue.isSettled).toBe(true);
  });

  it('counts an empty step 2 as a message to acknowledge, carrying no update', () => {
    const queue = new OutboundQueue();
    expect(queue.sendHeld()).toBe(0);
    queue.sendOne(UPDATE);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(1);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(0);
  });

  it('keeps chunked messages pending until the last chunk is acknowledged', () => {
    const queue = new OutboundQueue();
    queue.hold(UPDATE);
    queue.hold(UPDATE);
    expect(queue.sendHeld(3)).toBe(2);
    queue.sendOne(UPDATE, 2);
    expect(queue.pendingCount).toBe(3);
    queue.acknowledge();
    queue.acknowledge();
    expect(queue.pendingCount).toBe(3);
    expect(queue.isSettled).toBe(false);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(1);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(1);
    queue.acknowledge();
    expect(queue.isSettled).toBe(true);
  });

  it('holds unacknowledged updates again when the connection drops', () => {
    const queue = new OutboundQueue();
    queue.sendOne(UPDATE);
    queue.hold(UPDATE);
    queue.sendHeld();
    queue.requeueInFlight();
    expect(queue.pendingCount).toBe(2);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(2);
    expect(queue.sendHeld()).toBe(2);
    queue.acknowledge();
    expect(queue.isSettled).toBe(true);
  });

  it('ignores an acknowledgement with nothing in flight', () => {
    const queue = new OutboundQueue();
    queue.hold(UPDATE);
    queue.acknowledge();
    expect(queue.pendingCount).toBe(1);
  });

  it('keeps every unacknowledged update, in flight then held, until the relay acknowledges it', () => {
    const queue = new OutboundQueue();
    const [first, second, third] = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    queue.sendOne(first, 2);
    queue.hold(second);
    queue.hold(third);
    expect(queue.unacknowledged).toEqual([first, second, third]);
    queue.requeueInFlight();
    expect(queue.unacknowledged).toEqual([first, second, third]);
    expect(queue.sendHeld(2)).toBe(3);
    queue.acknowledge();
    expect(queue.unacknowledged).toEqual([first, second, third]);
    queue.acknowledge();
    expect(queue.unacknowledged).toEqual([]);
  });

  it('keeps no bytes while the connection is read-only, still counting the updates', () => {
    const queue = new OutboundQueue();
    const [first, second, third] = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    queue.sendOne(first);
    queue.hold(second);
    queue.keepBytes(false);
    queue.hold(third);
    expect(queue.unacknowledged).toEqual([]);
    expect(queue.pendingCount).toBe(3);
    queue.keepBytes(true);
    queue.hold(first);
    expect(queue.unacknowledged).toEqual([first]);
    expect(queue.pendingCount).toBe(4);
  });
});
