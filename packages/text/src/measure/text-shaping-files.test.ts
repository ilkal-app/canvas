// A shaping hands out its shaper and the font files its measurers read, so the vector
// export outlines and embeds the faces a layout used.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { bundledFontFile } from '../bundled/bundled-font-file.js';
import { fontFaceId, type FontFaceKey } from '../font/font-face.js';
import { layoutText } from '../layout/layout-text.js';
import { loadShaper } from '../shaping/shaper.js';

import { measuringFontsFor } from './measure-text.js';
import { createTextShaping } from './text-shaping.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);

const STYLE = {
  fontFamily: 'Liberation Sans',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
} as const;

/**
 * A bundled face's file.
 *
 * @param face - The face.
 * @returns Its bytes, or `undefined` when it is not bundled.
 */
function bytesOf(face: FontFaceKey): Uint8Array | undefined {
  const path = bundledFontFile(face);
  return path === undefined ? undefined : readFileSync(new URL(path, REPO_ROOT));
}

describe('createTextShaping, the files it read', () => {
  it.each(['eagerly', 'when-shaped'] as const)(
    'hands out its shaper and, reading %s, each file once a measurer has read it',
    async (readFiles) => {
      const shaper = await loadShaper();
      const shaping = createTextShaping(shaper, { bytesOf }, { readFiles });
      const runs = [{ length: 2, style: STYLE }];
      const { fonts } = measuringFontsFor([runs]);
      const face = fonts.find((font) => font.face.family === 'Liberation Sans')?.face;
      if (face === undefined) throw new Error('Liberation Sans has no metrics');
      const faceId = fontFaceId(face);
      expect(shaping.shaper).toBe(shaper);
      expect(shaping.fontFileOf?.(faceId)).toBeUndefined();
      layoutText('Hi', runs, null, shaping.measurerFor(fonts));
      expect(shaping.fontFileOf?.(faceId)).toEqual(bytesOf(face));
    },
  );
});
