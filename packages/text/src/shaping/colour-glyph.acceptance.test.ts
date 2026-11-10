import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { GlyphOutline, Shaper, ShapingFace } from '../index.js';

import { loadShaper } from './shaper.js';

const COLOR_FONTS = new URL('./__fixtures__/color-fonts/', import.meta.url);
const PLAIN_FONT = new URL(
  '../__fixtures__/format-corpus/corpus-sans-regular.ttf',
  import.meta.url,
);

const testBytes = new Uint8Array(readFileSync(new URL('test_glyphs-glyf_colr_1.ttf', COLOR_FONTS)));
const sampleBytes = new Uint8Array(readFileSync(new URL('samples-glyf_colr_1.ttf', COLOR_FONTS)));
const sbixBytes = new Uint8Array(readFileSync(new URL('samples-sbix.ttf', COLOR_FONTS)));
const plainBytes = new Uint8Array(readFileSync(PLAIN_FONT));

// The colour glyph contract is local until the production API is exported. Assigning loadShaper()
// to ColourShaper below must fail typechecking until the implementation adds these methods.
interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

interface Stop {
  readonly offset: number;
  readonly color: Rgba;
  readonly isForeground: boolean;
}

type Extend = 'pad' | 'repeat' | 'reflect';
type Composite =
  | 'clear'
  | 'src'
  | 'dest'
  | 'src-over'
  | 'dest-over'
  | 'src-in'
  | 'dest-in'
  | 'src-out'
  | 'dest-out'
  | 'src-atop'
  | 'dest-atop'
  | 'xor'
  | 'plus'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'multiply'
  | 'hsl-hue'
  | 'hsl-saturation'
  | 'hsl-color'
  | 'hsl-luminosity';
type Op =
  | {
      readonly op: 'push-transform';
      readonly xx: number;
      readonly yx: number;
      readonly xy: number;
      readonly yy: number;
      readonly dx: number;
      readonly dy: number;
    }
  | { readonly op: 'pop-transform' }
  | { readonly op: 'push-clip-glyph'; readonly outline: GlyphOutline }
  | {
      readonly op: 'push-clip-rect';
      readonly xMin: number;
      readonly yMin: number;
      readonly xMax: number;
      readonly yMax: number;
    }
  | { readonly op: 'pop-clip' }
  | { readonly op: 'solid'; readonly color: Rgba; readonly isForeground: boolean }
  | {
      readonly op: 'linear';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly extend: Extend;
      readonly stops: readonly Stop[];
    }
  | {
      readonly op: 'radial';
      readonly x0: number;
      readonly y0: number;
      readonly r0: number;
      readonly x1: number;
      readonly y1: number;
      readonly r1: number;
      readonly extend: Extend;
      readonly stops: readonly Stop[];
    }
  | {
      readonly op: 'sweep';
      readonly x0: number;
      readonly y0: number;
      readonly startAngle: number;
      readonly endAngle: number;
      readonly extend: Extend;
      readonly stops: readonly Stop[];
    }
  | {
      readonly op: 'image';
      readonly format: 'png' | 'bgra';
      readonly bytes: Uint8Array;
      readonly width: number;
      readonly height: number;
      readonly xMin: number;
      readonly yMin: number;
      readonly xMax: number;
      readonly yMax: number;
    }
  | { readonly op: 'push-group' }
  | { readonly op: 'pop-group'; readonly mode: Composite };

interface ColourGlyphProgram {
  readonly ops: readonly Op[];
}

interface ColourShaper extends Shaper {
  hasColourGlyphs(face: ShapingFace): boolean;
  colourGlyph(
    face: ShapingFace,
    glyphId: number,
    options?: { readonly palette?: number; readonly foreground?: Rgba },
  ): ColourGlyphProgram | undefined;
}

async function colourShaper(): Promise<ColourShaper> {
  return loadShaper();
}

function requireProgram(program: ColourGlyphProgram | undefined): ColourGlyphProgram {
  expect(program).toBeDefined();
  if (program === undefined) throw new Error('Expected a colour glyph program');
  return program;
}

function expectUnitColor(color: { r: number; g: number; b: number; a: number }): void {
  for (const channel of [color.r, color.g, color.b, color.a]) {
    expect(channel).toBeGreaterThanOrEqual(0);
    expect(channel).toBeLessThanOrEqual(1);
  }
}

function expectBalanced(program: ColourGlyphProgram): void {
  const stack: string[] = [];
  for (const op of program.ops) {
    if (op.op === 'push-transform') stack.push('transform');
    if (op.op === 'push-clip-glyph' || op.op === 'push-clip-rect') stack.push('clip');
    if (op.op === 'push-group') stack.push('group');
    if (op.op === 'pop-transform') expect(stack.pop()).toBe('transform');
    if (op.op === 'pop-clip') expect(stack.pop()).toBe('clip');
    if (op.op === 'pop-group') expect(stack.pop()).toBe('group');
  }
  expect(stack).toEqual([]);
}

function expectEm(value: number): void {
  expect(Number.isFinite(value)).toBe(true);
  expect(Math.abs(value)).toBeLessThanOrEqual(2);
}

function expectPaintValues(program: ColourGlyphProgram): void {
  for (const op of program.ops) {
    if (op.op === 'solid') expectUnitColor(op.color);
    if (op.op === 'linear' || op.op === 'radial' || op.op === 'sweep') {
      expect(['pad', 'repeat', 'reflect']).toContain(op.extend);
      expect(op.stops.length).toBeGreaterThan(0);
      const offsets = op.stops.map((stop) => stop.offset);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
      for (const stop of op.stops) expectUnitColor(stop.color);
      expectEm(op.x0);
      expectEm(op.y0);
      if (op.op === 'linear') {
        for (const value of [op.x1, op.y1, op.x2, op.y2]) expectEm(value);
      } else if (op.op === 'radial') {
        for (const value of [op.x1, op.y1, op.r0, op.r1]) expectEm(value);
      } else {
        expect(Number.isFinite(op.startAngle)).toBe(true);
        expect(Number.isFinite(op.endAngle)).toBe(true);
      }
    }
    if (op.op === 'push-transform') {
      expectEm(op.dx);
      expectEm(op.dy);
      for (const value of [op.xx, op.xy, op.yx, op.yy]) expect(Number.isFinite(value)).toBe(true);
    }
    if (op.op === 'push-clip-rect') {
      for (const value of [op.xMin, op.yMin, op.xMax, op.yMax]) expectEm(value);
      expect(op.xMax).toBeGreaterThan(op.xMin);
      expect(op.yMax).toBeGreaterThan(op.yMin);
    }
  }
}

async function testFace(): Promise<ShapingFace> {
  const shaper = await colourShaper();
  return shaper.face('colour-acceptance-static', testBytes);
}

describe('colour glyph recording', () => {
  it('reports COLRv1 and sbix faces, but not a plain TrueType face', async () => {
    const shaper = await colourShaper();
    expect(shaper.hasColourGlyphs(shaper.face('colour-acceptance-static', testBytes))).toBe(true);
    expect(shaper.hasColourGlyphs(shaper.face('colour-acceptance-samples', sampleBytes))).toBe(
      true,
    );
    expect(shaper.hasColourGlyphs(shaper.face('colour-acceptance-sbix', sbixBytes))).toBe(true);
    expect(shaper.hasColourGlyphs(shaper.face('colour-acceptance-plain', plainBytes))).toBe(false);
  });

  it('returns no program for plain, unpainted, or invalid glyphs and rejects a foreign face', async () => {
    const shaper = await colourShaper();
    const face = await testFace();
    const plain = shaper.face('colour-acceptance-plain', plainBytes);
    expect(shaper.colourGlyph(plain, 36)).toBeUndefined();
    expect(shaper.colourGlyph(face, 0)).toBeUndefined(); // .notdef has no COLR paint.
    expect(shaper.colourGlyph(face, 1_000_000)).toBeUndefined();
    expect(shaper.colourGlyph(face, -1)).toBeUndefined();
    expect(() => shaper.colourGlyph({ ...face }, 90)).toThrow(RangeError);
  });

  it.each([
    ['linear', 'pad', 90],
    ['linear', 'repeat', 91],
    ['linear', 'reflect', 92],
    ['radial', 'pad', 93],
    ['radial', 'repeat', 94],
    ['radial', 'reflect', 95],
    ['sweep', 'pad', 12],
    ['sweep', 'reflect', 24],
    ['sweep', 'repeat', 36],
  ] as const)(
    'records %s gradient with %s extend mode (glyph %i)',
    async (kind, extend, glyphId) => {
      const shaper = await colourShaper();
      const program = requireProgram(shaper.colourGlyph(await testFace(), glyphId));
      expect(program.ops.some((op) => op.op === kind && op.extend === extend)).toBe(true);
      expectBalanced(program);
      expectPaintValues(program);
    },
  );

  it('records a solid paint and a glyph outline clip', async () => {
    const shaper = await colourShaper();
    const program = requireProgram(shaper.colourGlyph(await testFace(), 154));
    expect(program.ops.map((op) => op.op)).toContain('push-clip-glyph');
    expect(program.ops.map((op) => op.op)).toContain('solid');
    const clip = program.ops.find((op) => op.op === 'push-clip-glyph');
    expect(clip?.outline.contours.length).toBeGreaterThan(0);
    expectBalanced(program);
    expectPaintValues(program);
  });

  it('records an em-normalised transform and a rectangular clip', async () => {
    const shaper = await colourShaper();
    const face = await testFace();
    const transformed = requireProgram(shaper.colourGlyph(face, 109)); // transform_matrix_1_0_0_1_125_125
    expect(
      transformed.ops.some(
        (op) => op.op === 'push-transform' && op.dx === 0.125 && op.dy === 0.125,
      ),
    ).toBe(true);
    expectBalanced(transformed);
    expectPaintValues(transformed);

    const clipped = requireProgram(shaper.colourGlyph(face, 160)); // clip_box_center
    expect(clipped.ops.some((op) => op.op === 'push-clip-rect')).toBe(true);
    expectBalanced(clipped);
    expectPaintValues(clipped);
  });

  it('records a composite group with its named mode', async () => {
    const shaper = await colourShaper();
    const program = requireProgram(shaper.colourGlyph(await testFace(), 143)); // composite_MULTIPLY
    expect(program.ops.some((op) => op.op === 'push-group')).toBe(true);
    expect(program.ops.some((op) => op.op === 'pop-group' && op.mode === 'multiply')).toBe(true);
    expectBalanced(program);
  });

  it('uses the requested foreground and multiplies its alpha by paint alpha', async () => {
    const shaper = await colourShaper();
    const foreground = { r: 0.2, g: 0.4, b: 0.6, a: 0.5 };
    const program = requireProgram(shaper.colourGlyph(await testFace(), 155, { foreground })); // foreground_color_solid_alpha_0.3
    const solids = program.ops.filter(
      (op): op is Extract<Op, { op: 'solid' }> => op.op === 'solid',
    );
    const solid = solids.find((op) => op.isForeground);
    expect(solid?.color.r).toBeCloseTo(foreground.r);
    expect(solid?.color.g).toBeCloseTo(foreground.g);
    expect(solid?.color.b).toBeCloseTo(foreground.b);
    expect(solid?.color.a).toBeCloseTo(0.15, 2);
  });

  it('selects a different colour from the fixture’s three CPAL palettes', async () => {
    const shaper = await colourShaper();
    const face = await testFace();
    const first = requireProgram(shaper.colourGlyph(face, 90, { palette: 0 }));
    const second = requireProgram(shaper.colourGlyph(face, 90, { palette: 1 }));
    const firstGradient = first.ops.find((op) => op.op === 'linear');
    const secondGradient = second.ops.find((op) => op.op === 'linear');
    expect(firstGradient?.stops[0]?.color).not.toEqual(secondGradient?.stops[0]?.color);
  });

  it('expands a referenced colour glyph inline', async () => {
    const shaper = await colourShaper();
    const program = requireProgram(shaper.colourGlyph(await testFace(), 180)); // no_cycle_multi_colrglyph
    expect(program.ops.length).toBeGreaterThan(5);
    expect(program.ops.map((op) => op.op)).not.toContain('color-glyph');
    expectBalanced(program);
  });

  it('records sbix PNG image bytes and em extents', async () => {
    const shaper = await colourShaper();
    const face = shaper.face('colour-acceptance-sbix', sbixBytes);
    const program = requireProgram(shaper.colourGlyph(face, 19)); // glyph00019, PNG strike
    const image = program.ops.find((op) => op.op === 'image');
    expect(image?.format).toBe('png');
    expect(image?.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(image?.bytes.slice(0, 8) ?? [])).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(image?.width).toBeGreaterThan(0);
    expect(image?.height).toBeGreaterThan(0);
    if (image?.op === 'image') {
      for (const value of [image.xMin, image.yMin, image.xMax, image.yMax]) expectEm(value);
      expect(image.xMax).toBeGreaterThan(image.xMin);
      expect(image.yMax).toBeGreaterThan(image.yMin);
    }
  });

  it('returns cloneable, deterministic programs', async () => {
    const shaper = await colourShaper();
    const face = await testFace();
    const first = requireProgram(shaper.colourGlyph(face, 90));
    expect(structuredClone(first)).toEqual(first);
    expect(shaper.colourGlyph(face, 90)).toEqual(first);
  });
});
