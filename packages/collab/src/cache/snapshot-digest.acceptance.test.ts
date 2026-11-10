import { describe, expect, it } from 'vitest';

import { snapshotDigest } from '@canvas/collab';

describe('snapshotDigest', () => {
  it('is deterministic for exact bytes, including empty input, without changing them', () => {
    const empty = new Uint8Array();
    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(snapshotDigest(empty)).toBe(snapshotDigest(new Uint8Array()));
    expect(snapshotDigest(bytes)).toBe(snapshotDigest(bytes.slice()));
    expect(bytes).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(snapshotDigest(bytes)).not.toBe(snapshotDigest(empty));
  });

  it('distinguishes changed, appended, truncated and swapped bytes', () => {
    const original = new Uint8Array([1, 2, 3, 4]);
    const digest = snapshotDigest(original);
    for (const variant of [
      new Uint8Array([1, 2, 9, 4]),
      new Uint8Array([1, 2, 3, 4, 0]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array([2, 1, 3, 4]),
    ]) {
      expect(snapshotDigest(variant)).not.toBe(digest);
    }
  });

  it('digests a multi-megabyte snapshot', () => {
    const bytes = new Uint8Array(3 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    expect(snapshotDigest(bytes)).toBe(snapshotDigest(bytes.slice()));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(snapshotDigest(bytes)).not.toBe(snapshotDigest(bytes.slice(0, -1)));
  });
});
