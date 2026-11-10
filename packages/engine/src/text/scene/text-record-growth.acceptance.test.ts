/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { beforeAll, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';
import { loadShaper, SPACE } from '@canvas/text';

import { layoutTextNow, preloadLayoutShaper } from '../layout/layout-job.js';
import { createLayoutJobRequest } from '../layout/layout-request.js';
import { libraryShaping } from '../layout/layout-shaping.js';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { TEXT_PASS_NAME } from './text-pass.js';

const BENGALI = 'কো';
const BENGALI_STYLE: TextStyle = { ...STYLE, fontFamily: 'Noto Sans Bengali' };
const GARAMOND_STYLE: TextStyle = { ...STYLE, fontFamily: 'EB Garamond' };

beforeAll(async () => {
  await preloadLayoutShaper();
});

function isDrawn(record: Float32Array): boolean {
  return (record[6] ?? 0) > 0 && (record[7] ?? 0) > 0;
}

function addFace(
  fonts: ReturnType<typeof createTextSetUp>['fonts'],
  family: string,
  path: string,
): void {
  const bytes = readFileSync(new URL(path, import.meta.url));
  fonts.addFace({ family, weight: 400, isItalic: false }, Uint8Array.from(bytes).buffer);
}

it('grows Bengali text records to the drawable shaped glyph count and draws every glyph', async () => {
  const { fonts, renderer, document, settle, records, pool } = createTextSetUp();
  try {
    addFace(
      fonts,
      'Noto Sans Bengali',
      '../../../../app/assets/fonts/script-coverage/notosansbengali/400.ttf',
    );
    const object = textObject('bengali', BENGALI, {
      runs: [{ length: BENGALI.length, style: BENGALI_STYLE }],
    });
    const request = createLayoutJobRequest(
      { objectId: object.id, text: object.text, runs: object.runs, maxWidth: null, align: 'left' },
      fonts,
    );
    const layout = layoutTextNow(request, libraryShaping(fonts, await loadShaper()));
    const drawableGlyphCount = layout.glyphs.filter(({ codepoint }) => codepoint !== SPACE).length;
    expect(drawableGlyphCount).toBe(3);
    expect(drawableGlyphCount).toBeGreaterThan(2);

    document.create(object);
    renderer.enqueue(document.takeChanges());
    await settle();
    const slots = renderer.scene.slotsOf(object.id, TEXT_PASS_NAME);
    // Three records per Bengali codepoint, allocated up front: every shaped glyph fits.
    expect(slots).toHaveLength(6);
    expect(slots.length).toBeGreaterThanOrEqual(drawableGlyphCount);
    expect(records().filter(isDrawn)).toHaveLength(drawableGlyphCount);

    document.update(object.id, {
      text: 'ab',
      runs: [{ length: 2, style: BENGALI_STYLE }],
    });
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 1_000, camera: CAMERA });
    expect(renderer.scene.slotsOf(object.id, TEXT_PASS_NAME)).toHaveLength(2);
    await settle();
    expect(renderer.scene.slotsOf(object.id, TEXT_PASS_NAME)).toHaveLength(2);
    expect(records().filter(isDrawn)).toHaveLength(2);
  } finally {
    pool.terminate();
    renderer.destroy();
  }
});

it('keeps codepoint-sized records for an ffi ligature and leaves surplus records empty', async () => {
  const { fonts, renderer, document, settle, records, pool } = createTextSetUp();
  try {
    addFace(fonts, 'EB Garamond', '../../../../app/assets/fonts/library/ebgaramond/400.ttf');
    const object = textObject('office', 'office', {
      runs: [{ length: 6, style: GARAMOND_STYLE }],
    });
    const request = createLayoutJobRequest(
      { objectId: object.id, text: object.text, runs: object.runs, maxWidth: null, align: 'left' },
      fonts,
    );
    const layout = layoutTextNow(request, libraryShaping(fonts, await loadShaper()));
    const drawableGlyphCount = layout.glyphs.filter(({ codepoint }) => codepoint !== SPACE).length;
    expect(drawableGlyphCount).toBe(4);
    expect(drawableGlyphCount).toBeLessThan(6);
    expect(layout.glyphs.some(({ index, end }) => index === 1 && end === 4)).toBe(true);

    document.create(object);
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(renderer.scene.slotsOf(object.id, TEXT_PASS_NAME)).toHaveLength(6);
    expect(records().filter(isDrawn)).toHaveLength(drawableGlyphCount);
    expect(
      records()
        .slice(drawableGlyphCount)
        .every((record) => !isDrawn(record)),
    ).toBe(true);
  } finally {
    pool.terminate();
    renderer.destroy();
  }
});
