/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { createMetricsMeasurer, createShapingMeasurer, layoutText, loadShaper } from '@canvas/text';

import { loadBundledFaces } from '../__fixtures__/bundled-fonts.js';
import { FontLibrary } from '../font/font-library.js';

import { layoutTextNow } from './layout-job.js';
import { createLayoutJobRequest } from './layout-request.js';
import { libraryShaping } from './layout-shaping.js';

const TEXT = 'office';
const STYLE: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

function fixture() {
  const library = new FontLibrary();
  const garamond = readFileSync(
    new URL('../../../../app/assets/fonts/library/ebgaramond/400.ttf', import.meta.url),
  );
  library.addFace(
    { family: 'EB Garamond', weight: 400, isItalic: false },
    Uint8Array.from(garamond).buffer,
  );
  for (const { face, bytes } of loadBundledFaces()) library.addFace(face, bytes);
  const request = createLayoutJobRequest(
    {
      objectId: 'office',
      text: TEXT,
      runs: [{ length: TEXT.length, style: STYLE }],
      maxWidth: null,
      align: 'left',
    },
    library,
  );
  return { library, request, garamond };
}

describe('layoutTextNow shaping', () => {
  it('matches a hand-built shaped layout and keeps the ffi cluster', async () => {
    const { library, request } = fixture();
    const shaper = await loadShaper();
    const expected = layoutText(
      request.text,
      request.runs,
      request.maxWidth,
      createShapingMeasurer(
        shaper,
        request.fonts.map((metrics, index) => {
          const face = request.faces[index];
          if (face === undefined) throw new Error('Missing requested face.');
          const loaded = library.get(face.faceId);
          if (loaded === undefined) throw new Error('Missing loaded face.');
          return {
            metrics,
            bytes: new Uint8Array(loaded.jobResource.bytes),
            shapingId: face.fontKey,
          };
        }),
      ),
      request.align,
    );
    const actual = layoutTextNow(request, libraryShaping(library, shaper));
    expect(actual).toEqual(expected);
    expect(
      actual.glyphs.some(({ index, end, glyphId }) => index === 1 && end === 4 && glyphId !== null),
    ).toBe(true);
  });

  it('uses per-codepoint metrics without shaping', () => {
    const { request } = fixture();
    expect(layoutTextNow(request)).toEqual(
      layoutText(
        request.text,
        request.runs,
        request.maxWidth,
        createMetricsMeasurer(request.fonts),
        request.align,
      ),
    );
  });

  it('does not shape with a replaced face under a stale font key', async () => {
    const { library, request, garamond } = fixture();
    const shaping = libraryShaping(library, await loadShaper());
    const oldKey = request.faces[0]?.fontKey;
    if (oldKey === undefined) throw new Error('Missing Garamond key.');
    expect(shaping.bytesOf(oldKey)).toEqual(new Uint8Array(garamond));
    library.addFace(
      { family: 'EB Garamond', weight: 400, isItalic: false },
      Uint8Array.from(garamond).buffer,
    );
    expect(shaping.bytesOf(oldKey)).toBeUndefined();
    expect(layoutTextNow(request, shaping)).toEqual(layoutTextNow(request));
  });
});
