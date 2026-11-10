import type { ObjectId } from '@canvas/schema';

/** The 64 characters an id draws from; every one is allowed by the object id pattern. */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Characters per id: 21 × 6 bits = 126 bits, so collisions across every board are negligible. */
const ID_LENGTH = 21;

/** The part of the Web Crypto API this module needs, present in browsers, workers and Node. */
interface RandomValues {
  getRandomValues(array: Uint8Array): Uint8Array;
}

/**
 * Makes a new random object id: 21 characters of `[A-Za-z0-9_-]` from the platform's
 * cryptographic random source (`globalThis.crypto`), for production use as the command layer's
 * id generator (`CommandEnvironment.createId`). Tests use the schema's seeded generator instead.
 *
 * @returns A new id.
 * @throws {TypeError} When the platform has no `globalThis.crypto`.
 */
export function createRandomObjectId(): ObjectId {
  const { crypto } = globalThis as unknown as { readonly crypto: RandomValues };
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  let id = '';
  // 256 is a multiple of 64, so taking six bits of each byte keeps every character equally likely.
  for (const byte of bytes) id += ID_ALPHABET.charAt(byte & 63);
  return id as ObjectId;
}
