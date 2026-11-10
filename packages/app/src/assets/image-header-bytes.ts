/**
 * Whether bytes start with a signature at an offset.
 *
 * @param bytes - The bytes.
 * @param offset - Where the signature starts.
 * @param signature - The signature, as Latin-1 text or bytes.
 * @returns True when it matches.
 */
export function hasSignature(
  bytes: Uint8Array,
  offset: number,
  signature: string | readonly number[],
): boolean {
  const expected =
    typeof signature === 'string'
      ? Array.from({ length: signature.length }, (unused, index) => signature.charCodeAt(index))
      : signature;
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * A big-endian 16-bit integer.
 *
 * @param bytes - The bytes.
 * @param at - Where it starts.
 * @returns The integer (0 past the end).
 */
export const u16 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);

/**
 * A big-endian 32-bit integer.
 *
 * @param bytes - The bytes.
 * @param at - Where it starts.
 * @returns The integer (0 past the end).
 */
export const u32 = (bytes: Uint8Array, at: number): number =>
  u16(bytes, at) * 0x1_00_00 + u16(bytes, at + 2);

/**
 * A little-endian integer of `count` bytes.
 *
 * @param bytes - The bytes.
 * @param at - Where it starts.
 * @param count - How many bytes.
 * @returns The integer (0 past the end).
 */
export function le(bytes: Uint8Array, at: number, count: number): number {
  let value = 0;
  for (let index = count - 1; index >= 0; index -= 1)
    value = value * 256 + (bytes[at + index] ?? 0);
  return value;
}
