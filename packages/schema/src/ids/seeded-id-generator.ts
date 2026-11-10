import type { ObjectId } from './object-id.js';

/** The 64 characters a generated id draws from; every one is allowed by the object id pattern. */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Characters per generated id: 16 × 6 bits = 96 bits, so collisions in a test run are negligible. */
const ID_LENGTH = 16;

/**
 * Mulberry32: a 32-bit seeded PRNG, small and fast, with a full 2^32 period. Test ids need
 * determinism, not cryptographic strength.
 *
 * @param seed - The 32-bit state to start from.
 * @returns A function that returns the next number in [0, 1).
 */
function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Creates a deterministic object id generator for tests and fixtures: the same seed always
 * yields the same sequence of ids, so test output and sync-fuzz replays are reproducible.
 * Not for production ids: it uses no entropy, and two generators with the
 * same seed produce the same ids.
 *
 * @param seed - Any safe integer; only its low 32 bits select the sequence.
 * @returns A function that returns a new 16-character {@link ObjectId} on every call.
 * @throws {RangeError} When `seed` is not a safe integer.
 */
export function createSeededIdGenerator(seed: number): () => ObjectId {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError(`An id seed must be a safe integer, got ${String(seed)}`);
  }
  const random = createMulberry32(seed);
  return () => {
    let id = '';
    for (let index = 0; index < ID_LENGTH; index += 1) {
      id += ID_ALPHABET.charAt(Math.floor(random() * ID_ALPHABET.length));
    }
    // The alphabet and length satisfy the object id pattern by construction.
    return id as ObjectId;
  };
}
