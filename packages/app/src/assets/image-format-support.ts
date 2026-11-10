import type { AssetLevel, AssetTiles } from '@canvas/schema';

/** A 2 × 2 red AVIF (288 bytes, sharp 0.35.4), decoded once to learn whether AVIF decodes. */
const PROBE_AVIF_BASE64 =
  'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACYAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAubWRhdBIACgc4ADaQENBpMhkZQmMEw88880EgAJBBEdVElZngpO5W/kKG';

/** What decodes an image file, as `createImageBitmap` does; closes what it made. */
export type ImageDecoder = (blob: Blob) => Promise<{ close(): void }>;

/**
 * Whether this thread's `createImageBitmap` decodes AVIF, by decoding a tiny AVIF (capability
 * detection, not the user agent: the engine's job workers decode with the same browser). False
 * where there is no `createImageBitmap` or the decode fails.
 *
 * @param decode - The decoder; the thread's `createImageBitmap` by default.
 * @returns Whether AVIF decodes.
 */
export async function canDecodeAvif(decode?: ImageDecoder): Promise<boolean> {
  const decoder =
    decode ?? (typeof createImageBitmap === 'function' ? createImageBitmap : undefined);
  if (decoder === undefined) return false;
  const bytes = Uint8Array.from(atob(PROBE_AVIF_BASE64), (character) => character.charCodeAt(0));
  try {
    const bitmap = await decoder(new Blob([bytes], { type: 'image/avif' }));
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * The levels the engine can use, one per long edge: a level's AVIF
 * where AVIF decodes, else its WebP fallback; an edge with only an AVIF level is left out where
 * AVIF does not decode (the client then resizes the original for it). Ascending. Pure.
 *
 * @param levels - The record's levels (an AVIF level may be listed with its WebP fallback).
 * @param isAvifDecodable - Whether AVIF decodes here.
 * @returns One level per long edge.
 */
export function decodableLevels(
  levels: readonly AssetLevel[],
  isAvifDecodable: boolean,
): AssetLevel[] {
  const byEdge = new Map<number, AssetLevel>();
  for (const level of levels) {
    if (level.format === 'avif' && !isAvifDecodable) continue;
    const kept = byEdge.get(level.longEdgePx);
    if (kept === undefined || (isAvifDecodable && level.format === 'avif')) {
      byEdge.set(level.longEdgePx, level);
    }
  }
  return [...byEdge.values()].sort((first, second) => first.longEdgePx - second.longEdgePx);
}

/**
 * The tile pyramid the engine can use: the record's, unless its tiles are AVIF where AVIF does
 * not decode (the service writes WebP tiles). Pure.
 *
 * @param tiles - The record's tiles.
 * @param isAvifDecodable - Whether AVIF decodes here.
 * @returns The tiles, or null.
 */
export function decodableTiles(
  tiles: AssetTiles | null,
  isAvifDecodable: boolean,
): AssetTiles | null {
  return tiles !== null && tiles.format === 'avif' && !isAvifDecodable ? null : tiles;
}
