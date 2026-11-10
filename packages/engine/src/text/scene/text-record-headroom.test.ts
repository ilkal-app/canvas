/// <reference types="node" />
// The record headroom holds for the worst expansions the bundled
// faces shape, a lone split vowel sign (dotted circle and two parts), a decomposing Arabic
// letter, joined Arabic letters whose dots draw apart, and a Latin digraph a library face splits,
// so every shaped glyph draws.
import { readFileSync } from 'node:fs';

import { beforeAll, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { loadShaper, SPACE } from '@canvas/text';

import { layoutTextNow, preloadLayoutShaper } from '../layout/layout-job.js';
import { createLayoutJobRequest } from '../layout/layout-request.js';
import { libraryShaping } from '../layout/layout-shaping.js';

import { createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS_NAME } from './text-pass.js';

beforeAll(async () => {
  await preloadLayoutShaper();
});

/**
 * Whether a record draws: its glyph rectangle has a size.
 *
 * @param record - The record.
 * @returns Whether it draws.
 */
function isDrawn(record: Float32Array): boolean {
  return (record[6] ?? 0) > 0 && (record[7] ?? 0) > 0;
}

const CASES = [
  {
    family: 'Noto Sans Bengali',
    file: 'script-coverage/notosansbengali/400.ttf',
    text: 'ো',
    glyphs: 3,
  },
  {
    family: 'Noto Sans Arabic',
    file: 'script-coverage/notosansarabic/400.ttf',
    text: 'آ',
    glyphs: 2,
  },
  // Joined, the coverage face draws dots apart from the body: two glyphs for ب and ت, three for ڼ.
  {
    family: 'Noto Sans Arabic',
    file: 'script-coverage/notosansarabic/400.ttf',
    text: 'بڼت',
    glyphs: 7,
  },
  // Undotted letters draw whole: one record each, not a flat headroom for the script.
  {
    family: 'Noto Sans Arabic',
    file: 'script-coverage/notosansarabic/400.ttf',
    text: 'سلام',
    glyphs: 4,
  },
  // A Latin library face that splits a codepoint: the generated table (expandedGlyphsOf).
  { family: 'Montserrat', file: 'library/montserrat/400.ttf', text: 'Ǆ', glyphs: 2 },
  // A base a combining mark splits: a dotless i, its dot and a macron below.
  { family: 'Merriweather', file: 'library/merriweather/400.ttf', text: 'i\u0331', glyphs: 3 },
] as const;

it.each(CASES)('draws every glyph of $family "$text"', async ({ family, file, text, glyphs }) => {
  const { fonts, renderer, document, settle, records, pool } = createTextSetUp();
  try {
    const bytes = readFileSync(new URL(`../../../../app/assets/fonts/${file}`, import.meta.url));
    fonts.addFace({ family, weight: 400, isItalic: false }, Uint8Array.from(bytes).buffer);
    const style: TextStyle = { ...STYLE, fontFamily: family };
    const object = textObject('t', text, { runs: [{ length: text.length, style }] });
    const request = createLayoutJobRequest(
      { objectId: object.id, text, runs: object.runs, maxWidth: null, align: 'left' },
      fonts,
    );
    const layout = layoutTextNow(request, libraryShaping(fonts, await loadShaper()));
    const drawable = layout.glyphs.filter(({ codepoint }) => codepoint !== SPACE).length;
    expect(drawable).toBe(glyphs);
    document.create(object);
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(renderer.scene.slotsOf(object.id, TEXT_PASS_NAME).length).toBeGreaterThanOrEqual(glyphs);
    expect(records().filter(isDrawn)).toHaveLength(glyphs);
  } finally {
    pool.terminate();
    renderer.destroy();
  }
});

it('gives undotted Arabic one record a letter, as many as it draws', async () => {
  const { fonts, renderer, document, settle, pool } = createTextSetUp();
  try {
    const bytes = readFileSync(
      new URL(
        '../../../../app/assets/fonts/script-coverage/notosansarabic/400.ttf',
        import.meta.url,
      ),
    );
    const family = 'Noto Sans Arabic';
    fonts.addFace({ family, weight: 400, isItalic: false }, Uint8Array.from(bytes).buffer);
    const style: TextStyle = { ...STYLE, fontFamily: family };
    const object = textObject('t', 'سلام', { runs: [{ length: 4, style }] });
    document.create(object);
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(renderer.scene.slotsOf(object.id, TEXT_PASS_NAME)).toHaveLength(4);
  } finally {
    pool.terminate();
    renderer.destroy();
  }
});
