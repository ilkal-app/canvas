import { describe, expect, it } from 'vitest';

import { RingBuffer } from './ring-buffer.js';

interface Slot {
  value: number;
}

function ringOf(capacity: number): RingBuffer<Slot> {
  return new RingBuffer(capacity, () => ({ value: 0 }));
}

function fill(ring: RingBuffer<Slot>, ...values: number[]): void {
  for (const value of values) {
    ring.acquire().value = value;
    ring.commit();
  }
}

function valuesOf(ring: RingBuffer<Slot>): number[] {
  return Array.from({ length: ring.size }, (unused, index) => ring.at(index).value);
}

describe('RingBuffer', () => {
  it('starts empty with every slot created up front', () => {
    const ring = ringOf(3);
    expect(ring.size).toBe(0);
    expect(ring.capacity).toBe(3);
    expect(ring.newest).toBeUndefined();
  });

  it('keeps committed slots oldest first', () => {
    const ring = ringOf(3);
    fill(ring, 1, 2);
    expect(valuesOf(ring)).toEqual([1, 2]);
    expect(ring.newest?.value).toBe(2);
  });

  it('overwrites the oldest slot once full, keeping the last capacity entries', () => {
    const ring = ringOf(3);
    fill(ring, 1, 2, 3, 4, 5);
    expect(ring.size).toBe(3);
    expect(valuesOf(ring)).toEqual([3, 4, 5]);
  });

  it('reuses the same capacity + 1 slot objects forever, so a full ring allocates nothing', () => {
    const ring = ringOf(2);
    fill(ring, 1, 2);
    const slots = new Set([ring.at(0), ring.at(1), ring.acquire()]);
    for (let value = 3; value < 9; value += 1) {
      fill(ring, value);
      expect(slots.has(ring.newest ?? { value: -1 })).toBe(true);
    }
    expect(slots.size).toBe(3);
  });

  it('never hands out a committed entry, so a full ring keeps them all while writing', () => {
    const ring = ringOf(2);
    fill(ring, 1, 2);
    ring.acquire().value = 99;
    expect(valuesOf(ring)).toEqual([1, 2]);
  });

  it('hides an acquired slot until it is committed, and reacquiring gives the same slot', () => {
    const ring = ringOf(2);
    const pending = ring.acquire();
    pending.value = 7;
    expect(ring.size).toBe(0);
    expect(ring.acquire()).toBe(pending);
    ring.commit();
    expect(valuesOf(ring)).toEqual([7]);
  });

  it('rejects an index outside the committed entries', () => {
    const ring = ringOf(2);
    fill(ring, 1);
    expect(() => ring.at(1)).toThrow(RangeError);
    expect(() => ring.at(-1)).toThrow(RangeError);
  });

  it('empties without forgetting its slots', () => {
    const ring = ringOf(2);
    fill(ring, 1, 2);
    ring.clear();
    expect(ring.size).toBe(0);
    fill(ring, 3);
    expect(valuesOf(ring)).toEqual([3]);
  });

  it('rejects a capacity that is not a positive integer', () => {
    expect(() => ringOf(0)).toThrow(RangeError);
    expect(() => ringOf(1.5)).toThrow(RangeError);
  });
});
