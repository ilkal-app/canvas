import { describe, expect, it, vi } from 'vitest';

import { INK_COLORS, type Rgba } from '@canvas/schema';
import type { TextLayout } from '@canvas/text';

import { ColorPalette } from '../../paint/color-palette.js';
import { glyphColorOf } from '../renderer/glyph-instance.js';

import { CAMERA, createTextSetUp, STYLE, textObject } from './__fixtures__/text-objects.js';
import { GREEK_ALPHA, greekQuads } from './greek-quads.js';
import { TEXT_RECORD_LAYOUT, writeTextRecord } from './text-record.js';

const DARK = INK_COLORS.dark;
const DARK_PALETTE = new ColorPalette('dark');
const IDENTITY = { x: 0, y: 0, cos: 1, sin: 0 };
const QUAD = { x: 0, y: 0, width: 4, height: 4, u0: 0, v0: 0, u1: 1, v1: 1 };
const f32 = (color: readonly number[]) => Array.from(new Float32Array(color));
const BLACK = [0, 0, 0, 1];

const INK_LAYOUT: TextLayout = {
  text: 'ab',
  runs: [{ faceId: 'face', fontSize: 10, color: 'ink' }],
  glyphs: [
    {
      codepoint: 97,
      index: 0,
      end: 1,
      glyphId: null,
      level: 0,
      line: 0,
      x: 0,
      y: 9,
      advance: 5,
      run: 0,
    },
  ],
  lines: [
    {
      start: 0,
      end: 2,
      isHard: true,
      x: 0,
      y: 0,
      height: 12,
      ascent: 9,
      descent: 3,
      baseline: 9,
      width: 10,
    },
  ],
  width: 10,
  height: 12,
};

describe('ink in text records', () => {
  it('writes a glyph in ink as the given ink, the light theme’s by default', () => {
    const record = new Float32Array(TEXT_RECORD_LAYOUT.floatsPerRecord);
    writeTextRecord(record, IDENTITY, { ...QUAD, color: 'ink' }, DARK_PALETTE);
    expect([...record.subarray(12, 16)]).toEqual(f32(DARK));
    writeTextRecord(record, IDENTITY, { ...QUAD, color: 'ink' });
    expect([...record.subarray(12, 16)]).toEqual(f32(INK_COLORS.light));
    writeTextRecord(record, IDENTITY, { ...QUAD, color: [0, 1, 0, 1] }, DARK_PALETTE);
    expect([...record.subarray(12, 16)]).toEqual([0, 1, 0, 1]);
  });

  it('keeps greek bars in ink until written, faded as greek bars are', () => {
    const [bar] = greekQuads(INK_LAYOUT, { x: 0, y: 0 }).quads;
    expect(bar?.quad.color).toBe('ink');
    expect(bar?.quad.inkAlpha).toBe(GREEK_ALPHA);
    const color: Rgba = bar ? glyphColorOf(bar.quad, DARK_PALETTE) : [0, 0, 0, 0];
    expect(color).toEqual([DARK[0], DARK[1], DARK[2], GREEK_ALPHA]);
  });

  it('rewrites an ink text’s glyph colours on a theme switch without laying it out again', async () => {
    const { renderer, document, pool, settle, records } = createTextSetUp();
    document.create(
      textObject('ink', 'Hi', { runs: [{ length: 2, style: { ...STYLE, color: 'ink' } }] }),
      textObject('black', 'Yo', { y: 40 }),
    );
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    await settle();
    const colours = () => records().map((record) => [...record.subarray(12, 16)]);
    expect(colours()).toEqual([f32(INK_COLORS.light), f32(INK_COLORS.light), BLACK, BLACK]);
    const submit = vi.spyOn(pool, 'submit');
    expect(renderer.setTheme('dark')).toBe(2);
    await settle();
    expect(submit).not.toHaveBeenCalled();
    expect(colours()).toEqual([f32(DARK), f32(DARK), BLACK, BLACK]);
  });

  it('draws token runs in the board’s value and rewrites them on a token edit, unlaid', async () => {
    const { renderer, document, pool, settle, records } = createTextSetUp();
    const brand = { token: 'brand' } as unknown as Rgba;
    renderer.setColorTokens(new Map([['brand', { light: [1, 0, 0, 1], dark: [0, 0, 1, 1] }]]));
    document.create(
      textObject('token', 'Hi', { runs: [{ length: 2, style: { ...STYLE, color: brand } }] }),
      textObject('black', 'Yo', { y: 40 }),
    );
    renderer.enqueue(document.takeChanges());
    renderer.renderFrame({ timeMs: 0, camera: CAMERA });
    await settle();
    const colours = () => records().map((record) => [...record.subarray(12, 16)]);
    expect(colours()).toEqual([[1, 0, 0, 1], [1, 0, 0, 1], BLACK, BLACK]);
    const submit = vi.spyOn(pool, 'submit');
    const green = { light: [0, 1, 0, 1] as Rgba, dark: [0, 0, 1, 1] as Rgba };
    expect(renderer.setColorTokens(new Map([['brand', green]]))).toBe(2);
    expect(renderer.setTheme('dark')).toBe(2);
    await settle();
    expect(submit).not.toHaveBeenCalled();
    expect(colours()).toEqual([[0, 0, 1, 1], [0, 0, 1, 1], BLACK, BLACK]);
  });

  it('keeps greek bars of a token run deferred, faded in the palette', () => {
    const layout = {
      ...INK_LAYOUT,
      runs: [{ faceId: 'face', fontSize: 10, color: { token: 'brand' } }],
    };
    const [bar] = greekQuads(layout, { x: 0, y: 0 }).quads;
    expect(bar?.quad.color).toEqual({ token: 'brand' });
    const palette = new ColorPalette(
      'light',
      new Map([['brand', { light: [1, 0, 0, 1], dark: [0, 0, 1, 1] }]]),
    );
    expect(bar ? glyphColorOf(bar.quad, palette) : []).toEqual([1, 0, 0, GREEK_ALPHA]);
  });

  it('draws an unreadable run colour in the base colour', async () => {
    const { renderer, document, settle, records } = createTextSetUp();
    const style = { ...STYLE, color: 'Ink' as unknown as Rgba };
    document.create(textObject('odd', 'Hi', { runs: [{ length: 2, style }] }));
    renderer.enqueue(document.takeChanges());
    await settle();
    expect(records().map((record) => [...record.subarray(12, 16)])).toEqual([
      [0, 0, 0, 1],
      [0, 0, 0, 1],
    ]);
  });
});
