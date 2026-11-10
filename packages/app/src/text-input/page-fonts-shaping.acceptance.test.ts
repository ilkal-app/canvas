/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createLayoutJobRequest, FontLibrary, layoutTextNow, libraryShaping } from '@canvas/engine';
import type { TextStyle } from '@canvas/schema';
import { loadShaper } from '@canvas/text';

import { createFontLayoutService } from './page-fonts.js';

const STYLE: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};
const INPUT = {
  text: 'office',
  runs: [{ length: 6, style: STYLE }],
  wrapWidth: null,
  align: 'left',
} as const;

function fixture() {
  const fonts = new FontLibrary();
  const bytes = readFileSync(
    new URL('../../assets/fonts/library/ebgaramond/400.ttf', import.meta.url),
  );
  fonts.addFace(
    { family: 'EB Garamond', weight: 400, isItalic: false },
    Uint8Array.from(bytes).buffer,
  );
  const request = createLayoutJobRequest(
    { objectId: 'page', text: INPUT.text, runs: INPUT.runs, maxWidth: null, align: INPUT.align },
    fonts,
  );
  return { fonts, request };
}

describe('page font layout shaping', () => {
  it('lays out with the same shaped glyphs as the engine when given a shaper', async () => {
    const { fonts, request } = fixture();
    const shaper = await loadShaper();
    const layout = createFontLayoutService(fonts, shaper).layout(INPUT);
    expect(layout).toEqual(layoutTextNow(request, libraryShaping(fonts, shaper)));
    expect(
      (layout?.glyphs ?? []).some(
        ({ index, end, glyphId }) => index === 1 && end === 4 && glyphId !== null,
      ),
    ).toBe(true);
  });

  it('keeps the metrics layout when no shaper is supplied', () => {
    const { fonts, request } = fixture();
    expect(createFontLayoutService(fonts).layout(INPUT)).toEqual(layoutTextNow(request));
  });
});
