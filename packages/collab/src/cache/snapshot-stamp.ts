import { isReadableMeta } from '@canvas/document';

/**
 * What a cache records beside a snapshot it compacted: a digest of the exact bytes and
 * the layout and schema versions of the build that wrote them from a store with no version
 * refusal. A reopen that trusts it skips the trial store's second apply of the snapshot.
 */
export interface SnapshotStamp {
  /** `snapshotDigest` of the snapshot bytes. */
  readonly digest: string;
  /** The writing build's document layout version. */
  readonly layoutVersion: number;
  /** The writing build's schema version. */
  readonly schemaVersion: number;
}

/**
 * A fast, non-cryptographic digest of a snapshot's exact bytes: two FNV-1a lanes of 32
 * bits over the bytes, with different offsets and the length, as hexadecimal. Equal bytes give
 * equal digests; a changed, added, removed or swapped byte gives a different one with
 * overwhelming probability (it guards against a snapshot rewritten without its stamp, not
 * against tampering). Pure.
 *
 * @param snapshot - The bytes; not mutated.
 * @returns The digest.
 */
export function snapshotDigest(snapshot: Uint8Array): string {
  let first = 0x811c9dc5;
  let second = 0x050c5d1f;
  for (let index = 0; index < snapshot.length; index += 1) {
    const byte = snapshot[index] ?? 0;
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte ^ (index & 0xff), 0x01000193);
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  return `${hex(first)}${hex(second)}:${String(snapshot.length)}`;
}

/**
 * Whether a stamp field is a version a build could have written: a nonnegative integer.
 *
 * @param value - The field.
 * @returns True for a nonnegative integer.
 */
function isVersionNumber(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * Whether a cached snapshot may skip the trial store: its stamp is well formed, names a layout
 * and schema this build reads (own, nonnegative integer fields), and its digest is that of these very bytes. Pure.
 *
 * @param stamp - What the cache returned beside the snapshot, of any shape.
 * @param snapshot - The snapshot about to be applied.
 * @returns True when the stamp vouches for exactly this snapshot.
 */
export function isTrustedStamp(stamp: unknown, snapshot: Uint8Array): boolean {
  if (typeof stamp !== 'object' || stamp === null) return false;
  const own = (key: string): unknown =>
    Object.hasOwn(stamp, key) ? (stamp as Record<string, unknown>)[key] : undefined;
  const digest = own('digest');
  const layoutVersion = own('layoutVersion');
  const schemaVersion = own('schemaVersion');
  return (
    typeof digest === 'string' &&
    isVersionNumber(layoutVersion) &&
    isVersionNumber(schemaVersion) &&
    isReadableMeta({ layoutVersion, schemaVersion }) &&
    digest === snapshotDigest(snapshot)
  );
}
