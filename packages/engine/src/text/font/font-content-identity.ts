import { fontFaceId, type FontFaceKey } from '@canvas/text';

import type { LoadedFontFace } from './font-library.js';

/**
 * Hashes a complete, successfully parsed catalogue in fallback order.
 *
 * @param loaded - The owned faces at one library revision.
 * @param expected - The configured catalogue, default face first.
 * @returns An immutable content key, or undefined for missing faces or unavailable hashing.
 */
export async function fontContentIdentity(
  loaded: readonly LoadedFontFace[],
  expected: readonly FontFaceKey[],
): Promise<string | undefined> {
  const ids = expected.map(fontFaceId);
  if (
    ids.length === 0 ||
    ids.length !== loaded.length ||
    new Set(ids).size !== ids.length ||
    loaded.some((face, index) => face.faceId !== ids[index])
  )
    return undefined;
  try {
    const contents = await Promise.all(
      loaded.map(async ({ faceId, bytes }) => {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hex = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        return [faceId, hex];
      }),
    );
    return `font-set:v1:${JSON.stringify(contents)}`;
  } catch {
    return undefined;
  }
}
