/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';
import {
  createFontMetrics,
  createShapingMeasurer,
  layoutText,
  loadShaper,
  parseFont,
} from '@canvas/text';

import { flushMicrotasks } from '../../workers/__fixtures__/fake-worker-transport.js';
import type { JobTicket, SubmitOptions } from '../../workers/job-submission.js';
import { GlyphAtlas } from '../atlas/glyph-atlas.js';
import { glyphKeyOf, type GlyphKey } from '../atlas/glyph-key.js';
import { BASE_TIER } from '../atlas/glyph-tiers.js';
import { FontLibrary } from '../font/font-library.js';

import { FakeMsdfgenModule } from './__fixtures__/fake-msdfgen-module.js';
import { GlyphSource } from './glyph-source.js';
import type { MsdfJobRequest, MsdfJobResponse } from './msdf-job-payload.js';
import { createMsdfJobHandler } from './msdf-job.js';
import { rasterizeSdfGlyph } from './sdf-rasterizer.js';

const FACE = { family: 'EB Garamond', weight: 400, isItalic: false } as const;
const STYLE: TextStyle = {
  fontFamily: FACE.family,
  fontSize: 20,
  color: [0, 0, 0, 1],
  weight: FACE.weight,
  italic: FACE.isItalic,
};

function fontBytes(): Uint8Array {
  return readFileSync(
    new URL('../../../../app/assets/fonts/library/ebgaramond/400.ttf', import.meta.url),
  );
}

async function ligatureId(): Promise<number> {
  const bytes = fontBytes();
  const font = { bytes, metrics: createFontMetrics(FACE, parseFont(bytes)) };
  const runs: StyleRun[] = [{ length: 6, style: STYLE }];
  const layout = layoutText(
    'office',
    runs,
    null,
    createShapingMeasurer(await loadShaper(), [font]),
  );
  const ligature = layout.glyphs.find((glyph) => glyph.index === 1 && glyph.end === 4);
  if (ligature?.glyphId == null) throw new Error('EB Garamond did not shape ffi');
  return ligature.glyphId;
}

function request(bytes: Uint8Array, keys: readonly GlyphKey[]): MsdfJobRequest {
  return {
    faceId: '400|n|EB Garamond',
    fontKey: '400|n|EB Garamond#1',
    fontBytes: Uint8Array.from(bytes).buffer,
    keys,
    tier: BASE_TIER,
    field: 'msdf',
  };
}

describe('glyph id generation', () => {
  it('keeps a mixed batch in order and rasterizes the ffi outline by glyph id', async () => {
    const bytes = fontBytes();
    const id = await ligatureId();
    const key = glyphKeyOf({ codepoint: 0x66, glyphId: id });
    const outcome = await createMsdfJobHandler()(request(bytes, [0x6f, key]));
    expect(outcome.response.glyphs.map((glyph) => glyph.key)).toEqual([0x6f, key]);
    expect(outcome.response.glyphs.map((glyph) => glyph.bitmap.field)).toEqual(['sdf', 'sdf']);
    const font = parseFont(bytes);
    // The raster path draws HarfBuzz's outline of the glyph, by its glyph id.
    const shaper = await loadShaper();
    const face = shaper.face('400|n|EB Garamond#1', bytes);
    expect(outcome.response.glyphs[1]?.bitmap).toEqual(
      rasterizeSdfGlyph(shaper.outline(face, id), font.advanceOf(id), BASE_TIER),
    );
  });

  it('uses raster SDF for a shaped key even when msdfgen is loaded for the batch', async () => {
    const bytes = fontBytes();
    const id = await ligatureId();
    const key = glyphKeyOf({ codepoint: 0x66, glyphId: id });
    const module = new FakeMsdfgenModule();
    const outcome = await createMsdfJobHandler({ loadMsdfgen: () => Promise.resolve(module) })(
      request(bytes, [0x6f, key]),
    );
    expect(outcome.response.glyphs.map((glyph) => [glyph.key, glyph.bitmap.field])).toEqual([
      [0x6f, 'msdf'],
      [key, 'sdf'],
    ]);
    expect(module.generateCalls.map((call) => call.codepoint)).toEqual([0x6f]);
    const font = parseFont(bytes);
    expect(outcome.response.glyphs[1]?.bitmap).toEqual(
      rasterizeSdfGlyph(font.outlineOf(id), font.advanceOf(id), BASE_TIER),
    );
  });

  it('submits the same shaped key only once when requested twice for one face', async () => {
    const bytes = fontBytes();
    const id = await ligatureId();
    const key = glyphKeyOf({ codepoint: 0x66, glyphId: id });
    const fonts = new FontLibrary();
    fonts.addFace(FACE, Uint8Array.from(bytes).buffer);
    const submitted: MsdfJobRequest[] = [];
    const pool = {
      submit(
        kind: 'msdf',
        submittedRequest: MsdfJobRequest,
        options: SubmitOptions,
      ): JobTicket<'msdf'> {
        expect(kind).toBe('msdf');
        expect(options.priority).toBe('visible');
        submitted.push(submittedRequest);
        return { id: submitted.length, response: new Promise<MsdfJobResponse>(() => undefined) };
      },
    };
    const source = new GlyphSource({ pool, fonts, atlas: new GlyphAtlas() });
    source.request({ faceId: '400|n|EB Garamond' }, key, BASE_TIER);
    source.request({ faceId: '400|n|EB Garamond' }, key, BASE_TIER);
    await flushMicrotasks();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.keys).toEqual([key]);
    source.request({ faceId: '400|n|EB Garamond' }, key, BASE_TIER);
    await flushMicrotasks();
    expect(submitted).toHaveLength(1);
  });
});
