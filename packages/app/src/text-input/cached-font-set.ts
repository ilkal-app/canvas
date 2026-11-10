import type { FontFaceKey } from '@canvas/engine';
import type { FontWeight } from '@canvas/schema';

import { loadPageFonts, loadRemoteFontCatalogue, pageFontLoader } from './page-fonts.js';

/**
 * Restores the saved fallback order using only known catalogue family names and their faces
 * (a CJK slice exactly), never cached URLs.
 * Existing faces and byte hashes must still match exactly; unavailable local fonts refuse.
 *
 * @param key - Historical identity, not current proof.
 * @param isActive - Whether preview startup remains eligible.
 * @returns Whether the page now holds exactly the certified font bytes in their original order.
 */
export async function restoreCachedFontSet(key: string, isActive: () => boolean): Promise<boolean> {
  const page = loadPageFonts();
  await page.loaded;
  if (!isActive()) return false;
  if (page.fonts.contentIdentity === key) return true;
  const faces = readFaces(key);
  if (faces === undefined) return false;
  const loader = pageFontLoader();
  if (faces.some(({ family }) => loader.status(family) === 'missing'))
    await loadRemoteFontCatalogue();
  if (!isActive() || !(await loader.ensureFacesOrdered(faces))) return false;
  return isActive() && page.fonts.contentIdentity === key;
}

/**
 * A face from its id (`fontFaceId`): `weight|n|family` or `weight|i|family`, or for a named face
 * (a CJK slice) `weight|N|<length>:<name>|family` or with `I`.
 *
 * @param id - The id.
 * @returns The face, or `undefined` for an id that is not one.
 */
function faceOf(id: string): FontFaceKey | undefined {
  const match = /^([1-9]00)\|([niNI])\|(.+)$/u.exec(id);
  if (match === null) return undefined;
  const [, weightText = '', slant = '', rest = ''] = match;
  const face = { weight: Number(weightText) as FontWeight, isItalic: slant.toLowerCase() === 'i' };
  if (slant === slant.toLowerCase()) return { ...face, family: rest };
  const name = /^(\d+):/u.exec(rest);
  const length = Number(name?.[1]);
  const start = (name?.[0] ?? '').length;
  const postScriptName = rest.slice(start, start + length);
  if (name === null || postScriptName.length !== length || rest[start + length] !== '|') {
    return undefined;
  }
  return { ...face, family: rest.slice(start + length + 1), postScriptName };
}

/**
 * The faces a font-set key names, in its order.
 *
 * @param key - The key.
 * @returns The faces, or `undefined` for a key that is not one.
 */
function readFaces(key: string): readonly FontFaceKey[] | undefined {
  const prefix = 'font-set:v1:';
  if (!key.startsWith(prefix) || key.length > 1024 * 1024) return undefined;
  try {
    const entries: unknown = JSON.parse(key.slice(prefix.length));
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 4096) return undefined;
    const faces: FontFaceKey[] = [];
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) return undefined;
      const [id, hash] = entry as unknown[];
      if (typeof id !== 'string' || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
        return undefined;
      const face = faceOf(id);
      if (face === undefined || ids.has(id)) return undefined;
      ids.add(id);
      faces.push(face);
    }
    return faces;
  } catch {
    return undefined;
  }
}
