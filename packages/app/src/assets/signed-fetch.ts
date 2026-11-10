import type { AssetId, AssetRecord } from '@canvas/schema';

import { AssetsHttpError } from './assets-responses.js';

/** How long a signed URL the service hands out stays valid, ms (`SIGNED_URL_TTL_SECONDS`). */
export const SIGNED_URL_LIFETIME_MS = 900_000;

/** How long before its signed URLs expire a record is read again, ms. */
export const SIGNED_URL_MARGIN_MS = 60_000;

/** A record and when it was read (its signed URLs age from then). */
export interface KnownRecord {
  /** The record. */
  readonly record: AssetRecord;
  /** When it was read, ms. */
  readonly readAt: number;
}

/**
 * Whether a record's signed URLs have a while left.
 *
 * @param known - The record and when it was read, if it is known.
 * @param now - The time now, ms.
 * @returns True when it was read less than the URLs' lifetime, less the margin, ago.
 */
export function isFreshRecord(known: KnownRecord | undefined, now: number): known is KnownRecord {
  return known !== undefined && now - known.readAt < SIGNED_URL_LIFETIME_MS - SIGNED_URL_MARGIN_MS;
}

/** What {@link fetchSigned} reads records and bytes with. */
export interface SignedFetchSource {
  /** The record with signed URLs that have a while left, read again when they do not. */
  readonly fresh: (assetId: AssetId, signal?: AbortSignal) => Promise<KnownRecord>;
  /** Reads the record from the service now. */
  readonly read: (assetId: AssetId, signal?: AbortSignal) => Promise<KnownRecord>;
  /** Fetches the bytes behind a signed URL. */
  readonly signed: (url: string, signal?: AbortSignal) => Promise<ArrayBuffer>;
}

/**
 * Fetches bytes from one of an asset's signed URLs (a level, the original); a refused URL
 * (expired, or signed before a change: `403` or `404`) is read afresh and tried once more.
 *
 * @param assetId - The asset.
 * @param signal - Aborts the fetch.
 * @param urlOf - The URL in a record.
 * @param source - Reads records and bytes.
 * @returns The bytes.
 * @throws {Error} When the record names no such URL, or the bytes are refused twice.
 */
export async function fetchSigned(
  assetId: AssetId,
  signal: AbortSignal | undefined,
  urlOf: (record: AssetRecord) => string | undefined,
  source: SignedFetchSource,
): Promise<ArrayBuffer> {
  const known = await source.fresh(assetId, signal);
  const url = urlOf(known.record);
  if (url === undefined) throw new Error('The asset has no such file yet.');
  try {
    return await source.signed(url, signal);
  } catch (error) {
    if (!(error instanceof AssetsHttpError) || (error.status !== 403 && error.status !== 404)) {
      throw error;
    }
    const again = urlOf((await source.read(assetId, signal)).record);
    if (again === undefined) throw error;
    return source.signed(again, signal);
  }
}
