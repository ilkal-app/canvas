// The records the fake assets service (fake-assets-service.ts) keeps and shows: a new asset's
// record, and a record with signed URLs that expire by the fake's clock.
import type { AssetId, AssetLevel, AssetRecord } from '@canvas/schema';

/** The fake's base URL. */
export const FAKE_ASSETS_URL = 'http://assets.test';

/**
 * A new asset's record: a ready one has a size and a 128 px level in AVIF and WebP, and a 512 px
 * AVIF level.
 *
 * @param assetId - The asset.
 * @param bytes - Its original.
 * @param status - Its status.
 * @returns The record.
 */
export function newFakeRecord(
  assetId: AssetId,
  bytes: Uint8Array,
  status: AssetRecord['status'],
): AssetRecord {
  return {
    id: assetId,
    mimeType: 'image/png',
    byteLength: bytes.length,
    naturalSize: status === 'ready' ? { width: 1000, height: 500 } : null,
    status,
    levels:
      status === 'ready'
        ? [
            { longEdgePx: 128, format: 'avif' },
            { longEdgePx: 128, format: 'webp' },
            { longEdgePx: 512, format: 'avif' },
          ]
        : [],
    tiles: null,
    blurhash: null,
    averageColor: null,
    progress: status === 'ready' ? 1 : 0,
    createdAt: 0,
  };
}

/** The fake's clock and signed-URL lifetime. */
export interface FakeSigning {
  /** Now, ms. */
  readonly now: number;
  /** How long a signed URL lives, ms. */
  readonly signedUrlTtlMs: number;
}

/**
 * The record as a response shows it: levels, the tile route and the original with URLs signed
 * until the fake's clock plus the lifetime.
 *
 * @param signing - The clock and lifetime.
 * @param stored - The asset.
 * @param stored.record - Its record.
 * @returns The record.
 */
export function presentFakeRecord(
  signing: FakeSigning,
  stored: { readonly record: AssetRecord },
): AssetRecord {
  const { record } = stored;
  const expires = signing.now + signing.signedUrlTtlMs;
  const signed = (key: string) => `${FAKE_ASSETS_URL}/objects/${key}?expires=${String(expires)}`;
  const levels = record.levels.map((level): AssetLevel => ({
    ...level,
    url: signed(`${record.id}/levels/${String(level.longEdgePx)}.${level.format}`),
  }));
  const tiles =
    record.tiles === null
      ? null
      : {
          ...record.tiles,
          urlTemplate: `${FAKE_ASSETS_URL}/assets/${record.id}/tiles/{z}/{x}/{y}`,
        };
  return {
    ...record,
    levels,
    tiles,
    ...(record.status === 'uploading' ? {} : { originalUrl: signed(`${record.id}/original`) }),
  };
}
