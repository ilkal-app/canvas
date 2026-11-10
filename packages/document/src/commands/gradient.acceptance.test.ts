// Independent acceptance: public commands and actual Yjs style-group merge.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { createHistory } from '../history/undo-manager.js';
import {
  ADA,
  BOB,
  createFixtureStore,
  createSyncedPair,
  exchange,
} from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';

const paint = {
  type: 'linear',
  angle: 0,
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
};
// Command input is untrusted JSON at the public boundary, including before schemas widen.
const input = (style: unknown) => ({ changes: [{ id: 'shape-box', style }] });
const apply = (store: ReturnType<typeof createFixtureStore>, style: unknown, origin = ADA) =>
  applyCommand(
    store,
    setStyleCommand,
    input(style) as z.input<typeof setStyleCommand.input>,
    origin,
  );

describe('stored gradient acceptance', () => {
  it('stores a gradient as one style edit and restores it with one undo/redo', () => {
    const store = createFixtureStore();
    const before = mustGet(store, 'shape-box');
    const history = createHistory(store, ADA.principalId);
    apply(store, { fill: paint });
    expect(mustGet(store, 'shape-box')).toMatchObject({ fill: paint });
    expect(history.undo()).toBe(true);
    expect(mustGet(store, 'shape-box')).toEqual(before);
    expect(history.redo()).toBe(true);
    expect(mustGet(store, 'shape-box')).toMatchObject({ fill: paint });
    history.destroy();
    store.destroy();
  });
  it('rejects a bad paint atomically', () => {
    const store = createFixtureStore();
    expectRejected(store, setStyleCommand, input({ fill: { ...paint, angle: Infinity } }));
    store.destroy();
  });
  it('keeps a whole style winner after concurrent fill/stroke edits', () => {
    const [a, b] = createSyncedPair();
    apply(a, { fill: paint });
    apply(b, { stroke: { width: 7, color: [0, 1, 0, 1] } }, BOB);
    const possibilities = [mustGet(a, 'shape-box'), mustGet(b, 'shape-box')];
    exchange(a, b);
    expect(mustGet(a, 'shape-box')).toEqual(mustGet(b, 'shape-box'));
    expect(possibilities).toContainEqual(mustGet(a, 'shape-box'));
    a.destroy();
    b.destroy();
  });
});

describe('deterministic partitioned gradient edits', () => {
  for (let seed = 1; seed <= 12; seed++) {
    it(`converges at seed ${String(seed)} with hard and translucent stops`, () => {
      const [a, b] = createSyncedPair();
      let state = seed;
      const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
      try {
        for (let step = 0; step < 32; step++) {
          const store = random() < 0.5 ? a : b;
          const stops = [
            { offset: 0, color: [random(), random(), random(), random()] },
            { offset: 0.5, color: [1, 0, 0, 0] },
            { offset: 0.5, color: [0, 0, 1, 1] },
            { offset: 1, color: [random(), random(), random(), random()] },
          ];
          const fill =
            random() < 0.5
              ? { type: 'linear', angle: random() * 2 * Math.PI - Math.PI, stops }
              : {
                  type: 'radial',
                  center: { x: random(), y: random() },
                  radius: 0.01 + random() * 1.99,
                  stops,
                };
          apply(store, { fill }, store === a ? ADA : BOB);
          if (random() < 0.25) exchange(a, b);
        }
        exchange(a, b);
        exchange(b, a);
        expect(a.read().objects).toEqual(b.read().objects);
        expect(mustGet(a, 'shape-box')).toHaveProperty('fill.stops');
      } finally {
        a.destroy();
        b.destroy();
      }
    });
  }
});
