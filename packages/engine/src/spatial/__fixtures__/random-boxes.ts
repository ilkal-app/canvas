// Seeded random boxes for the R-tree tests and benchmarks: the same seed gives the same boxes,
// so a failure reproduces (Global Constraint 3, seeded inputs).
import type { WorldBounds } from '../../camera/camera.js';

/**
 * A seeded generator of floats in [0, 1) (mulberry32).
 *
 * @param seed - Any 32-bit integer.
 * @returns The next value on each call.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * A random box inside a square world.
 *
 * @param random - The generator.
 * @param worldSize - The world's side, world units.
 * @param maxSide - The largest box side, world units.
 * @returns The box.
 */
export function randomBox(random: () => number, worldSize: number, maxSide: number): WorldBounds {
  const minX = random() * worldSize;
  const minY = random() * worldSize;
  return { minX, minY, maxX: minX + random() * maxSide, maxY: minY + random() * maxSide };
}

/**
 * `count` keyed random boxes, keys `b0`, `b1`, …
 *
 * @param count - How many.
 * @param seed - The seed.
 * @param worldSize - The world's side, world units.
 * @param maxSide - The largest box side, world units.
 * @returns The keyed boxes.
 */
export function randomEntries(
  count: number,
  seed: number,
  worldSize = 10_000,
  maxSide = 100,
): { key: string; bounds: WorldBounds }[] {
  const random = seededRandom(seed);
  const entries: { key: string; bounds: WorldBounds }[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({ key: `b${String(index)}`, bounds: randomBox(random, worldSize, maxSide) });
  }
  return entries;
}
