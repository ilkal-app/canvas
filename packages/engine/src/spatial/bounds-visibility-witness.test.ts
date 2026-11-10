import { expect, it } from 'vitest';

import type { WorldBounds } from '../camera/camera.js';

import { BoundsVisibilityWitness } from './bounds-visibility-witness.js';
import { intersectsBounds } from './bounds.js';

const box = (minX: number, minY: number, maxX: number, maxY: number): WorldBounds => ({
  minX,
  minY,
  maxX,
  maxY,
});
const VIEW = box(0, 0, 10, 10);

it('retains clipped and zero-area visible candidates through inclusive edge and corner contact', () => {
  const witness = new BoundsVisibilityWitness();
  witness.observe(VIEW, box(8, 8, 12, 12));
  witness.observe(VIEW, box(10, 10, 10, 10));
  expect(witness.accepts(box(1, 1, 10, 10))).toBe(true);
  expect(witness.accepts(box(10, 10, 20, 20))).toBe(true);
  expect(witness.accepts(box(10.01, 10, 20, 20))).toBe(false);
  expect(witness.accepts(box(1, 1, 9.99, 10))).toBe(false);
});

it.each([box(12, 2, 14, 4), box(-4, 2, -2, 4), box(2, 12, 4, 14), box(2, -4, 4, -2)])(
  'rejects a hidden candidate touching any edge: %j',
  (candidate) => {
    const witness = new BoundsVisibilityWitness();
    witness.observe(VIEW, candidate);
    expect(witness.accepts(VIEW)).toBe(true);
    expect(witness.accepts(box(-2, -2, 12, 12))).toBe(false);
  },
);

it('conservatively rejects a changed separating axis and never borrows mutable bounds', () => {
  const witness = new BoundsVisibilityWitness();
  const candidate = { ...box(12, 12, 14, 14) };
  const viewport = { ...VIEW };
  witness.observe(viewport, candidate);
  candidate.minX = -100;
  viewport.maxX = 100;
  expect(witness.accepts(VIEW)).toBe(true);
  const copied = witness.copy();
  witness.observe(VIEW, box(NaN, 0, 1, 1));
  expect(witness.accepts(VIEW)).toBe(false);
  expect(copied.accepts(VIEW)).toBe(true);
  const next = box(13, 0, 20, 10);
  expect(intersectsBounds(next, box(12, 12, 14, 14))).toBe(false);
  expect(copied.accepts(next)).toBe(false);
});

it('accepts empty candidates but refuses invalid candidate and viewport bounds', () => {
  expect(new BoundsVisibilityWitness().accepts(VIEW)).toBe(true);
  for (const invalid of [
    box(NaN, 0, 1, 1),
    box(0, 0, Infinity, 1),
    box(2, 0, 1, 1),
    box(0, 2, 1, 1),
  ]) {
    const witness = new BoundsVisibilityWitness();
    expect(witness.accepts(invalid)).toBe(false);
    witness.observe(VIEW, invalid);
    expect(witness.accepts(VIEW)).toBe(false);
    const badView = new BoundsVisibilityWitness();
    badView.observe(invalid, VIEW);
    expect(badView.accepts(VIEW)).toBe(false);
  }
});

it('acceptance preserves every intersection bit over seeded candidate sets and camera changes', () => {
  let seed = 756;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const randomBox = () => {
    const x = random() * 40 - 20;
    const y = random() * 40 - 20;
    return box(x, y, x + random() * 15, y + random() * 15);
  };
  let accepted = 0;
  for (let trial = 0; trial < 300; trial += 1) {
    const viewport = randomBox();
    const candidates = Array.from({ length: 20 }, randomBox);
    const witness = new BoundsVisibilityWitness();
    for (const candidate of candidates) witness.observe(viewport, candidate);
    const reference = candidates.map((candidate) => intersectsBounds(viewport, candidate));
    expect(witness.accepts(viewport)).toBe(true);
    for (let frame = 0; frame < 100; frame += 1) {
      const shift = () => (random() - 0.5) * 4;
      const next =
        frame % 2
          ? randomBox()
          : box(
              viewport.minX + shift(),
              viewport.minY + shift(),
              viewport.maxX + shift(),
              viewport.maxY + shift(),
            );
      if (!witness.accepts(next)) continue;
      accepted += 1;
      expect(candidates.map((candidate) => intersectsBounds(next, candidate))).toEqual(reference);
    }
  }
  expect(accepted).toBeGreaterThan(1000);
});
