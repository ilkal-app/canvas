// PDF painting contract. Selection and font embedding are tested on their own.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import {
  createFontMetrics,
  createShapingMeasurer,
  layoutText,
  loadShaper,
  parseFont,
  textPdf,
  textVectors,
  type OutlineVectorGlyph,
  type TextLayout,
  type VectorFill,
  type VectorGlyph,
  type VectorGroup,
  type VectorGradient,
  type VectorLayer,
  type VectorRadialGradient,
} from '../index.js';

import { colourLineOf } from './colour-line.js';
import { bgraToPng } from './png-encode.js';

const PATH = '0 0 m 10 0 l 10 10 l h';
const CLIP_ONE = '1 1 m 9 1 l 9 9 l h';
const CLIP_TWO = '2 2 m 8 2 l 8 8 l h';
const RED = { r: 1, g: 0, b: 0, a: 1 } as const;
const BLUE = { r: 0, g: 0, b: 1, a: 0.5 } as const;
const MATRIX = { a: 20, b: 0, c: 0, d: -20, e: 2, f: 18 };
const STOPS = [
  { offset: 0.25, color: RED },
  { offset: 0.75, color: BLUE },
];
// prettier-ignore
const BASE_GLYPH = { codepoint: 65, index: 0, end: 1, glyphId: 1, level: 0, line: 0, x: 2, y: 18, advance: 10, run: 0 };
// prettier-ignore
const BASE_LINE = { start: 0, end: 1, isHard: true, x: 0, y: 0, height: 25, ascent: 18, descent: 7, baseline: 18, width: 10 };

/**
 * A minimal layout for vectors built by hand.
 *
 * @returns One laid-out glyph.
 */
function simpleLayout(): TextLayout {
  return {
    text: 'A',
    runs: [{ faceId: 'test', fontSize: 20, color: 'ink' }],
    glyphs: [BASE_GLYPH],
    lines: [BASE_LINE],
    width: 10,
    height: 25,
  };
}

/**
 * Resolves the test palette and foreground to normalized channels.
 *
 * @param fill - A test fill.
 * @returns Its RGBA channels.
 * @throws {Error} For an unsupported fill.
 */
function colorOf(fill: VectorFill): readonly [number, number, number, number] {
  if (fill === 'ink') return [0.2, 0.4, 0.8, 1];
  if (Array.isArray(fill)) return fill;
  if (typeof fill === 'object' && 'r' in fill) return [fill.r, fill.g, fill.b, fill.a];
  throw new Error('unexpected fill');
}

/**
 * A plain vector with a nonzero PDF path.
 *
 * @param fill - Its colour.
 * @returns The vector.
 */
function outline(fill: VectorFill = 'ink'): OutlineVectorGlyph {
  return {
    kind: 'outline',
    glyphId: 1,
    faceId: 'test',
    cluster: { start: 0, end: 1 },
    d: '',
    pdf: PATH,
    fill,
  };
}

/**
 * A colour glyph with the supplied paint layers.
 *
 * @param layers - Paint layers.
 * @param groups - Composite groups.
 * @returns The vector.
 */
function layered(layers: readonly VectorLayer[], groups: readonly VectorGroup[] = []): VectorGlyph {
  return { ...outline(), kind: 'layers', layers, groups };
}

/**
 * One paint layer with a PDF region.
 *
 * @param overrides - Fields to replace.
 * @returns The layer.
 */
function layer(
  overrides: Omit<Partial<VectorLayer>, 'fill'> & { fill?: VectorFill | undefined } = {},
): VectorLayer {
  const { fill = 'fill' in overrides ? undefined : RED, ...rest } = overrides;
  return {
    d: '',
    pdf: PATH,
    clips: [],
    groups: [],
    ...rest,
    ...(fill === undefined ? {} : { fill }),
  };
}

/**
 * A gradient sharing the test geometry and nontrivial colour line.
 *
 * @param kind - Gradient kind.
 * @param extend - Spread mode.
 * @returns The gradient.
 */
function gradient(
  kind: 'linear' | 'radial' | 'sweep',
  extend: 'pad' | 'repeat' | 'reflect',
): VectorGradient {
  const common = { extend, stops: STOPS, transform: MATRIX };
  if (kind === 'linear') return { kind, x0: 0, y0: 0, x1: 4, y1: 0, ...common };
  if (kind === 'radial') return { kind, x0: 0, y0: 0, r0: 1, x1: 4, y1: 2, r1: 5, ...common };
  return { kind, x0: 0, y0: 0, startAngle: 0, endAngle: Math.PI * 2, ...common };
}

const OPTIONS = { colorOf, namePrefix: 'T1' };

describe('textPdf', () => {
  it('is publicly exported, deterministic, transformed, and gives each outline its own graphics state', async () => {
    const vectors = [outline(BLUE), outline(RED)];
    const options = { ...OPTIONS, transform: { a: 1, b: 0, c: 0, d: -1, e: 3, f: 100 } };
    const first = await textPdf(simpleLayout(), vectors, options);
    expect(await textPdf(simpleLayout(), vectors, options)).toEqual(first);
    expect(first.content.trim()).toMatch(/^q\s+1 0 0 -1 3 100 cm[\s\S]*Q$/);
    expect(first.content).toMatch(/q\s+\/T1Gs\d+ gs\s+0 0 1 rg\s+0 0 m 10 0 l 10 10 l h\s+f\s+Q/);
    expect(first.content).toMatch(/q\s+1 0 0 rg\s+0 0 m 10 0 l 10 10 l h\s+f\s+Q/);
    expect(Object.values(first.resources.extGStates)[0]).toMatch(/\/ca\s+0\.5\b/);
    expect(first.warnings).toEqual([]);
    expect(
      (await textPdf(simpleLayout(), vectors, { ...options, namePrefix: 'T2' })).content,
    ).not.toContain('/T1Gs');
  });

  it('orders nested clips and layers, and multiplies foreground solid alpha', async () => {
    const clips = [
      { d: '', pdf: CLIP_ONE },
      { d: '', pdf: CLIP_TWO },
    ];
    const result = await textPdf(
      simpleLayout(),
      [layered([layer({ clips, fill: BLUE, fillAlpha: 0.5 }), layer({ fill: RED })])],
      OPTIONS,
    );
    expect(result.content).toMatch(
      new RegExp(`q\\s+${CLIP_ONE} W n\\s+${CLIP_TWO} W n[\\s\\S]*${PATH} f\\s+Q`),
    );
    expect(result.content.indexOf('0 0 1 rg')).toBeLessThan(result.content.indexOf('1 0 0 rg'));
    expect(
      Object.values(result.resources.extGStates).some((value) => /\/ca\s+0\.25\b/.test(value)),
    ).toBe(true);
  });

  it('uses normalized colour lines for axial and radial shadings, including a cut cone', async () => {
    const linear = gradient('linear', 'pad');
    const radial = gradient('radial', 'pad') as VectorRadialGradient;
    const cut = { ...radial, r0: -2, r1: 2 };
    const vectors = [
      layered([
        layer({ fill: undefined, gradient: linear }),
        layer({ fill: undefined, gradient: radial }),
        layer({ fill: undefined, gradient: cut }),
      ]),
    ];
    const result = await textPdf(simpleLayout(), vectors, OPTIONS);
    const shadings = Object.values(result.resources.shadings);
    expect(shadings).toHaveLength(3);
    expect(shadings[0]).toMatch(/\/ShadingType 2\b[\s\S]*\/ColorSpace \/DeviceRGB/);
    expect(shadings[0]).toMatch(/\/Coords\s*\[1 0 3 0\]/);
    expect(shadings[1]).toMatch(/\/ShadingType 3\b/);
    const cutLine = colourLineOf(cut, colorOf);
    if (cutLine?.gradient.kind !== 'radial') throw new Error('expected a cut radial cone');
    expect(shadings[2]).toContain(
      `/Coords [${[cutLine.gradient.x0, cutLine.gradient.y0, cutLine.gradient.r0, cutLine.gradient.x1, cutLine.gradient.y1, cutLine.gradient.r1].join(' ')}]`,
    );
    for (const shading of shadings) {
      expect(shading).toMatch(/\/Function\s*<<[\s\S]*\/FunctionType 3\b/);
      expect(shading).toMatch(/\/Functions\s*\[[\s\S]*\/FunctionType 2\b/);
      expect(shading).toMatch(/\/Bounds\s*\[/);
      expect(shading).toMatch(/\/Encode\s*\[/);
      expect(shading).toContain('/Extend [true true]');
    }
    expect(result.content).toMatch(
      new RegExp(`${PATH} W n[\\s\\S]*20 0 0 -20 2 18 cm[\\s\\S]*\\/T1Sh\\d+ sh`),
    );
    expect(Object.keys(result.resources.shadings)).toEqual(
      expect.arrayContaining(['T1Sh1', 'T1Sh2', 'T1Sh3']),
    );
  });

  it('spreads repeat and reflect over at least sixteen periods each side', async () => {
    const result = await textPdf(
      simpleLayout(),
      [
        layered([
          layer({ fill: undefined, gradient: gradient('linear', 'repeat') }),
          layer({ fill: undefined, gradient: gradient('linear', 'reflect') }),
        ]),
      ],
      OPTIONS,
    );
    const values = Object.values(result.resources.shadings);
    expect(values).toHaveLength(2);
    for (const shading of values) {
      const domain = /\/Domain\s*\[(-?[\d.]+)\s+(-?[\d.]+)\]/.exec(shading);
      expect(domain).not.toBeNull();
      expect(Number(domain?.[1])).toBeLessThanOrEqual(-16);
      expect(Number(domain?.[2])).toBeGreaterThanOrEqual(17);
      expect(shading).toContain('/Extend [true true]');
    }
    expect(values[1]).toMatch(/\/Encode\s*\[[^\]]*1 0/);
  });

  it('warns for gradient alpha rather than silently discarding it, and omits a null colour line', async () => {
    const nullLine = {
      ...gradient('linear', 'repeat'),
      stops: [
        { offset: 0, color: RED },
        { offset: 0, color: BLUE },
      ],
    };
    const result = await textPdf(
      simpleLayout(),
      [
        layered([
          layer({ fill: undefined, gradient: gradient('linear', 'pad') }),
          layer({ fill: undefined, gradient: nullLine }),
        ]),
      ],
      OPTIONS,
    );
    expect(result.warnings.some((warning) => /gradient alpha/i.test(warning))).toBe(true);
    expect(Object.keys(result.resources.shadings)).toHaveLength(1);
    expect(result.content.match(/\/T1Sh\d+ sh/g) ?? []).toHaveLength(1);
  });

  it('clips a sweep into at least 64 solid wedges and warns about the approximation', async () => {
    const result = await textPdf(
      simpleLayout(),
      [layered([layer({ fill: undefined, gradient: gradient('sweep', 'pad') })])],
      OPTIONS,
    );
    expect(result.content).toContain(`${PATH} W n`);
    expect((result.content.match(/\s+f\b/g) ?? []).length).toBeGreaterThanOrEqual(64);
    expect(result.warnings.some((warning) => /sweep/i.test(warning))).toBe(true);
  });

  it.each([
    ['multiply', 'Multiply'],
    ['screen', 'Screen'],
    ['overlay', 'Overlay'],
    ['darken', 'Darken'],
    ['lighten', 'Lighten'],
    ['color-dodge', 'ColorDodge'],
    ['color-burn', 'ColorBurn'],
    ['hard-light', 'HardLight'],
    ['soft-light', 'SoftLight'],
    ['difference', 'Difference'],
    ['exclusion', 'Exclusion'],
    ['hsl-hue', 'Hue'],
    ['hsl-saturation', 'Saturation'],
    ['hsl-color', 'Color'],
    ['hsl-luminosity', 'Luminosity'],
  ] as const)('maps %s groups to /BM /%s', async (mode, pdfMode) => {
    const result = await textPdf(
      simpleLayout(),
      [layered([layer({ groups: [0] })], [{ mode, parent: null }])],
      OPTIONS,
    );
    expect(
      Object.values(result.resources.extGStates).some((value) => value.includes(`/BM /${pdfMode}`)),
    ).toBe(true);
    expect(result.content).toMatch(/q\s+\/T1Gs\d+ gs\s+\/T1Fx\d+ Do\s+Q/);
    expect(Object.values(result.resources.forms ?? {})[0]).toMatch(/0 0 m[\s\S]* f/);
  });

  it('nests child groups inside their parents', async () => {
    // prettier-ignore
    const result = await textPdf(simpleLayout(), [layered([layer({ groups: [0, 1] })], [{ mode: 'multiply', parent: null }, { mode: 'screen', parent: 0 }])], OPTIONS);
    const forms = result.resources.forms ?? {};
    expect(result.content).toMatch(/q\s+\/T1Gs\d+ gs\s+\/T1Fx\d+ Do\s+Q/);
    const nested = /q\s+\/T1Gs\d+ gs\s+\/T1Fx\d+ Do\s+Q/;
    expect(Object.values(forms).some((form) => nested.test(form))).toBe(true);
    expect(Object.keys(forms)).toHaveLength(2);
    const states = Object.values(result.resources.extGStates).join(' ');
    expect(states).toContain('/BM /Multiply');
    expect(states).toContain('/BM /Screen');
  });

  it('paints src-over plainly and reports a Porter-Duff fallback', async () => {
    const plain = await textPdf(
      simpleLayout(),
      [layered([layer({ groups: [0] })], [{ mode: 'src-over', parent: null }])],
      OPTIONS,
    );
    expect(plain.warnings).toEqual([]);
    const fallback = await textPdf(
      simpleLayout(),
      [layered([layer({ groups: [0] })], [{ mode: 'src-in', parent: null }])],
      OPTIONS,
    );
    expect(fallback.content).toContain(`${PATH} f`);
    expect(fallback.warnings.some((warning) => /src-in/i.test(warning))).toBe(true);
  });

  it.each(['bgra', 'png'] as const)(
    'decodes %s bitmap pixels, alpha, and box placement',
    async (kind) => {
      const bgra = Uint8Array.from([30, 20, 10, 128, 60, 50, 40, 255]);
      const image = {
        pixelWidth: 2,
        pixelHeight: 1,
        x: 3,
        y: 5,
        width: 8,
        height: 6,
        ...(kind === 'bgra' ? { bgra } : { png: bgraToPng(bgra, 2, 1) }),
      };
      const vector: VectorGlyph = { ...outline(), kind: 'image', image };
      const result = await textPdf(simpleLayout(), [vector], OPTIONS);
      const resource = Object.entries(result.resources.images)[0];
      expect(resource?.[0]).toMatch(/^T1Im\d+$/);
      expect(resource?.[1]).toMatchObject({ width: 2, height: 1 });
      expect([...(resource?.[1].rgb ?? [])]).toEqual([10, 20, 30, 40, 50, 60]);
      expect([...(resource?.[1].alpha ?? [])]).toEqual([128, 255]);
      expect(result.content).toMatch(/q\s+8 0 0 -6 3 11 cm\s+\/T1Im\d+ Do\s+Q/);
      expect(result.warnings).toEqual([]);
    },
  );

  it('writes real Noto Color Emoji gradient layers deterministically', async () => {
    const base = new URL(
      '../../../app/assets/fonts/script-coverage/notocoloremoji/',
      import.meta.url,
    );
    const bytes = readFileSync(new URL('400.ttf', base));
    const metrics = createFontMetrics(
      { family: 'Noto Color Emoji', weight: 400, isItalic: false },
      parseFont(readFileSync(new URL('400-metrics.ttf', base))),
    );
    const shaper = await loadShaper();
    // prettier-ignore
    const style: TextStyle = { fontFamily: metrics.face.family, fontSize: 20, color: [0.2, 0.4, 0.8, 1], weight: 400, italic: false };
    const layout = layoutText(
      '😀',
      [{ length: 2, style }],
      null,
      createShapingMeasurer(shaper, [{ bytes, metrics }]),
    );
    const faceId = layout.runs[0]?.faceId;
    if (faceId === undefined) throw new Error('missing emoji face');
    const face = shaper.face(faceId, bytes);
    const vectors = textVectors(layout, {
      outline: (requestedFaceId, glyphId) => {
        expect(requestedFaceId).toBe(faceId);
        return shaper.outline(face, glyphId);
      },
      colourGlyph: (requestedFaceId, glyphId) => {
        expect(requestedFaceId).toBe(faceId);
        return shaper.colourGlyph(face, glyphId);
      },
    });
    if (vectors[0]?.kind !== 'layers') throw new Error('expected emoji colour layers');
    expect(vectors[0].layers.some((paint) => paint.gradient !== undefined)).toBe(true);
    const result = await textPdf(layout, vectors, OPTIONS);
    expect(await textPdf(layout, vectors, OPTIONS)).toEqual(result);
    expect(result.content).toMatch(/\bW n\b/);
    expect(result.content).toMatch(/\b(?:rg|sh)\b/);
    const names = [
      ...Object.keys(result.resources.extGStates),
      ...Object.keys(result.resources.shadings),
      ...Object.keys(result.resources.images),
    ];
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith('T1'))).toBe(true);
  });
});
