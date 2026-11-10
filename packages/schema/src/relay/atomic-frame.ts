import { atomicHeaderSchema, type AtomicHeader } from './atomic-header.js';

const PREFIX_BYTES = 8;
const MAX_HEADER_BYTES = 4096;
/** Raw part limit leaves room for the largest metadata inside an 8 MiB websocket frame. */
export const MAX_ATOMIC_PART_BYTES = 8 * 1024 * 1024 - PREFIX_BYTES - MAX_HEADER_BYTES;
const MAGIC = [67, 65, 66] as const;
const VERSION = 1;
const decoder = new TextDecoder('utf-8', { fatal: true });

/** One decoded frame with independently owned payload bytes. */
export interface AtomicFrame {
  /** Validated version-one metadata; only part frames carry payloads. */
  readonly header: AtomicHeader;
  /** Detached original update bytes, empty for metadata-only frames. */
  readonly payload: Uint8Array;
}

/**
 * Identifies the reserved atomic family, including unsupported versions that must refuse.
 *
 * @param bytes - Untrusted websocket bytes.
 * @returns Whether dispatch must use the atomic decoder, never legacy fallback.
 */
export function isAtomicFrame(bytes: Uint8Array): boolean {
  return MAGIC.every((value, index) => bytes[index] === value);
}

/**
 * Checks that only part frames carry data, before copying or dispatching it.
 *
 * @param header - Strict validated metadata.
 * @param length - Payload byte count.
 * @throws {Error} For empty/oversized parts or unexpected payloads.
 */
function checkPayload(header: AtomicHeader, length: number): void {
  if (header.kind === 'part' ? length < 1 || length > MAX_ATOMIC_PART_BYTES : length !== 0)
    throw new Error('Invalid atomic frame payload.');
}

/**
 * Encodes a versioned binary frame: magic/version, big-endian metadata length, UTF8 JSON,
 * then exact raw part bytes. Metadata never contains client-supplied authority identities.
 *
 * @param header - Strict metadata.
 * @param payload - Original part bytes, copied synchronously.
 * @returns Independently owned wire bytes.
 * @throws {Error} When metadata or payload exceeds the protocol contract.
 */
export function encodeAtomicFrame(
  header: AtomicHeader,
  payload: Uint8Array = new Uint8Array(),
): Uint8Array {
  const validated = atomicHeaderSchema.parse(header);
  checkPayload(validated, payload.length);
  const metadata = new TextEncoder().encode(JSON.stringify(validated));
  if (metadata.length > MAX_HEADER_BYTES) throw new Error('Atomic metadata exceeds its limit.');
  const bytes = new Uint8Array(PREFIX_BYTES + metadata.length + payload.length);
  bytes.set([...MAGIC, VERSION]);
  new DataView(bytes.buffer).setUint32(4, metadata.length);
  bytes.set(metadata, PREFIX_BYTES);
  bytes.set(payload, PREFIX_BYTES + metadata.length);
  return bytes;
}

/**
 * Decodes bounded strict metadata before copying a part. Unknown versions and extra fields
 * refuse instead of falling back to a legacy mutation path.
 *
 * @param bytes - One websocket frame, possibly a subarray.
 * @returns Validated metadata and a detached payload snapshot.
 * @throws {Error} For malformed, unsupported or oversized input.
 */
export function decodeAtomicFrame(bytes: Uint8Array): AtomicFrame {
  if (bytes.length < PREFIX_BYTES || !isAtomicFrame(bytes) || bytes[3] !== VERSION)
    throw new Error('Unsupported atomic frame.');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  if (length === 0 || length > MAX_HEADER_BYTES || length > bytes.length - PREFIX_BYTES)
    throw new Error('Invalid atomic metadata length.');
  const metadata = decoder.decode(bytes.subarray(PREFIX_BYTES, PREFIX_BYTES + length));
  const header = atomicHeaderSchema.parse(JSON.parse(metadata) as unknown);
  const offset = PREFIX_BYTES + length;
  checkPayload(header, bytes.length - offset);
  return { header, payload: bytes.slice(offset) };
}
