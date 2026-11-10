// The SVG writer on hand-built vectors (outlines, clips, gradients, sweeps, groups,
// bitmaps, embedding); the real shaped-text cases are in text-svg-shaped.acceptance.test.ts.
import { describe, expect, it } from 'vitest';

import {
  type OutlineVectorGlyph,
  type TextLayout,
  type VectorFill,
  type VectorGlyph,
  type VectorGroup,
  type VectorLayer,
} from '../index.js';

import { textSvg } from './text-svg.js';

const RED = { r: 1, g: 0, b: 0, a: 1 } as const;
const BLUE = { r: 0, g: 0, b: 1, a: 0.5 } as const;
const PATH = 'M 0 0 L 10 0 L 10 10 Z';
const GRADIENT_TRANSFORM = { a: 20, b: 0, c: 0, d: -20, e: 2, f: 18 };
const GRADIENT_STOPS = [
  { offset: 0, color: BLUE, alpha: 0.5 },
  { offset: 1, color: RED },
];
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gXcAAAAASUVORK5CYII=',
    'base64',
  ),
);

// Keep the two layout fixture records aligned for quick comparison.
// prettier-ignore
const BASE_GLYPH = { codepoint: 65, index: 0, end: 1, glyphId: 1, level: 0, line: 0, x: 2, y: 18, advance: 10, run: 0 };
// prettier-ignore
const BASE_LINE = { start: 0, end: 1, isHard: true, x: 0, y: 0, height: 25, ascent: 18, descent: 7, baseline: 18, width: 10 };

/**
 * Returns a minimal positioned layout for hand-built vector cases.
 *
 * @param source - The source text.
 * @returns A one-glyph layout.
 */
function simpleLayout(source = 'A'): TextLayout {
  return {
    text: source,
    runs: [{ faceId: 'test-face', fontSize: 20, color: 'ink' }],
    glyphs: [{ ...BASE_GLYPH, codepoint: source.codePointAt(0) ?? 65, end: source.length }],
    lines: [{ ...BASE_LINE, end: source.length }],
    width: 10,
    height: 25,
  };
}

/**
 * Returns one outline with the same cluster as the source layout.
 *
 * @param layout - The source layout.
 * @param fill - The glyph fill.
 * @returns An outline vector.
 */
function outline(layout: TextLayout, fill: VectorFill = 'ink'): OutlineVectorGlyph {
  return {
    kind: 'outline',
    glyphId: 1,
    faceId: 'test-face',
    cluster: { start: 0, end: layout.text.length },
    d: PATH,
    pdf: '',
    fill,
  };
}

/**
 * Returns a colour glyph containing caller-supplied layers and groups.
 *
 * @param layers - Layers in paint order.
 * @param groups - Groups named by layers.
 * @returns A layered glyph.
 */
function layered(layers: readonly VectorLayer[], groups: readonly VectorGroup[] = []): VectorGlyph {
  return { ...outline(simpleLayout()), kind: 'layers', layers, groups };
}

/**
 * Returns a painted path region with the required layer metadata.
 *
 * @param overrides - Layer fields to replace.
 * @returns A vector layer.
 */
function layer(
  overrides: Omit<Partial<VectorLayer>, 'fill'> & { fill?: VectorLayer['fill'] | undefined } = {},
): VectorLayer {
  const { fill = 'fill' in overrides ? undefined : RED, ...rest } = overrides;
  return {
    d: PATH,
    pdf: '',
    clips: [],
    groups: [],
    ...rest,
    ...(fill === undefined ? {} : { fill }),
  };
}

/**
 * Resolves test inks and rgba values to normalized RGBA.
 *
 * @param fill - The fill to resolve.
 * @returns Normalized channels.
 * @throws {Error} For an unsupported test fill.
 */
function colorOf(fill: VectorFill): readonly [number, number, number, number] {
  if (fill === 'ink') return [0.2, 0.4, 0.8, 1];
  if (Array.isArray(fill)) return fill;
  if (typeof fill === 'object' && 'r' in fill) return [fill.r, fill.g, fill.b, fill.a];
  throw new Error('unexpected test fill');
}

/**
 * Extracts attributes from the first tag with a given local name.
 *
 * @param svg - The fragment.
 * @param name - Element name.
 * @returns The first matching tag.
 * @throws {Error} When no tag matches.
 */
function firstTag(svg: string, name: string): string {
  const tag = new RegExp(`<${name}\\b[^>]*>`).exec(svg)?.[0];
  if (tag === undefined) throw new Error(`missing <${name}>`);
  return tag;
}

/**
 * Reads a quoted attribute from a checked SVG tag.
 *
 * @param tag - The opening tag.
 * @param name - Attribute name.
 * @returns Its decoded spelling, if present.
 */
function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
}

const OPTIONS = { colorOf, idPrefix: 'text-a' };

describe('textSvg', () => {
  it('emits one transformed fragment group with a nonzero outline and resolved alpha', () => {
    const layout = simpleLayout();
    const { svg, warnings } = textSvg(layout, [outline(layout, BLUE)], {
      ...OPTIONS,
      transform: { a: 2, b: 1, c: 0, d: 3, e: 4, f: 5 },
    });
    expect(svg.trim()).toMatch(/^<g\b[\s\S]*<\/g>$/);
    expect(svg.match(/<g\b/g)).toHaveLength(1);
    expect(firstTag(svg, 'g')).toContain('transform="matrix(2 1 0 3 4 5)"');
    expect(firstTag(svg, 'path')).toContain(`d="${PATH}"`);
    expect(firstTag(svg, 'path')).toContain('fill="#0000ff"');
    expect(firstTag(svg, 'path')).toContain('fill-rule="nonzero"');
    expect(attribute(firstTag(svg, 'path'), 'fill-opacity')).toBe('0.5');
    expect(warnings).toEqual([]);
  });

  it('keeps colour layer order, multiplies solid alpha, and nests outer clips first', () => {
    const clips = [
      { d: 'M 1 1 Z', pdf: '' },
      { d: 'M 2 2 Z', pdf: '' },
    ];
    const { svg } = textSvg(
      simpleLayout(),
      [layered([layer({ clips, fill: BLUE, fillAlpha: 0.5 }), layer({ fill: RED })])],
      OPTIONS,
    );
    expect(svg).toContain('<defs>');
    const clipPaths = [...svg.matchAll(/<clipPath\b([^>]*)>([\s\S]*?)<\/clipPath>/g)];
    expect(clipPaths).toHaveLength(2);
    expect(clipPaths.map((match) => match[2])).toEqual([
      expect.stringContaining('M 1 1 Z'),
      expect.stringContaining('M 2 2 Z'),
    ]);
    const ids = clipPaths.map((match) => attribute(match[1] ?? '', 'id'));
    expect(ids.every((id) => id?.startsWith('text-a'))).toBe(true);
    expect(svg).toMatch(
      new RegExp(
        `clip-path="url\\(#${String(ids[0])}\\)"[\\s\\S]*clip-path="url\\(#${String(ids[1])}\\)"`,
      ),
    );
    expect(svg.indexOf('fill="#0000ff"')).toBeLessThan(svg.indexOf('fill="#ff0000"'));
    expect(svg).toContain('fill-opacity="0.25"');
  });

  it('writes linear and radial user-space gradients with transforms, spread, and multiplied stop opacity', () => {
    // prettier-ignore
    const linear = { kind: 'linear' as const, x0: 0, y0: 0, x1: 1, y1: 0, extend: 'repeat' as const, stops: GRADIENT_STOPS, transform: GRADIENT_TRANSFORM };
    // prettier-ignore
    const radial = { kind: 'radial' as const, x0: 0, y0: 0, r0: 0, x1: 1, y1: 1, r1: 2, extend: 'reflect' as const, stops: GRADIENT_STOPS, transform: GRADIENT_TRANSFORM };
    // prettier-ignore
    const { svg } = textSvg(simpleLayout(), [layered([layer({ fill: undefined, gradient: linear }), layer({ fill: undefined, gradient: radial })])], OPTIONS);
    for (const [name, spread] of [
      ['linearGradient', 'repeat'],
      ['radialGradient', 'reflect'],
    ] as const) {
      const tag = firstTag(svg, name);
      expect(tag).toContain('gradientUnits="userSpaceOnUse"');
      expect(tag).toContain('gradientTransform="matrix(20 0 0 -20 2 18)"');
      expect(tag).toContain(`spreadMethod="${spread}"`);
      expect(attribute(tag, 'id')).toMatch(/^text-a/);
      expect(svg).toContain(`url(#${String(attribute(tag, 'id'))})`);
    }
    expect(svg).toContain('stop-color="#0000ff"');
    expect(svg).toContain('stop-opacity="0.25"');
  });

  it('approximates a sweep with at least 64 clipped solid wedges and warns', () => {
    // prettier-ignore
    const gradient = { kind: 'sweep' as const, x0: 0, y0: 0, startAngle: 0, endAngle: Math.PI * 2, extend: 'pad' as const, stops: GRADIENT_STOPS, transform: GRADIENT_TRANSFORM };
    const { svg, warnings } = textSvg(
      simpleLayout(),
      [layered([layer({ fill: undefined, gradient })])],
      OPTIONS,
    );
    expect(warnings.some((warning) => /sweep/i.test(warning))).toBe(true);
    expect(svg).toMatch(/clip-path="url\(#text-a[^)]*\)"/);
    expect((svg.match(/<path\b[^>]*fill="#[0-9a-f]{6}"/gi) ?? []).length).toBeGreaterThanOrEqual(
      64,
    );
  });

  it('nests isolated groups, maps HSL and blend modes, and warns for Porter-Duff', () => {
    const groups: VectorGroup[] = [
      { mode: 'src-in', parent: null },
      { mode: 'hsl-hue', parent: 0 },
      { mode: 'multiply', parent: 1 },
    ];
    const { svg, warnings } = textSvg(
      simpleLayout(),
      [layered([layer({ groups: [0, 1, 2] })], groups)],
      OPTIONS,
    );
    expect((svg.match(/style="isolation:isolate/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(svg).toMatch(/mix-blend-mode:\s*hue/);
    expect(svg).toMatch(/mix-blend-mode:\s*multiply/);
    expect(svg.indexOf('mix-blend-mode: hue')).toBeLessThan(
      svg.indexOf('mix-blend-mode: multiply'),
    );
    expect(warnings.some((warning) => warning.includes('src-in'))).toBe(true);
  });

  it.each(
    'screen overlay darken lighten color-dodge color-burn hard-light soft-light difference exclusion hsl-saturation hsl-color hsl-luminosity'.split(
      ' ',
    ),
  )('maps %s to its CSS blend mode', (mode) => {
    const css = mode.startsWith('hsl-') ? mode.slice(4) : mode;
    const svg = textSvg(
      simpleLayout(),
      [layered([layer({ groups: [0] })], [{ mode: mode as VectorGroup['mode'], parent: null }])],
      OPTIONS,
    ).svg;
    expect(svg).toMatch(new RegExp(`mix-blend-mode:\\s*${css}`));
  });

  it.each('clear src dest dest-in src-out dest-out src-atop dest-atop xor plus'.split(' '))(
    'warns when %s is painted as src-over',
    (mode) => {
      const { svg, warnings } = textSvg(
        simpleLayout(),
        [layered([layer({ groups: [0] })], [{ mode: mode as VectorGroup['mode'], parent: null }])],
        OPTIONS,
      );
      expect(svg).toContain(`d="${PATH}"`);
      expect(warnings.some((warning) => warning.includes(mode))).toBe(true);
    },
  );

  it.each(['png', 'bgra'] as const)('embeds a %s bitmap as a placed PNG image', (format) => {
    // prettier-ignore
    const image = { pixelWidth: 1, pixelHeight: 1, x: 2, y: 3, width: 20, height: 10, ...(format === 'png' ? { png: PNG } : { bgra: Uint8Array.of(0, 0, 255, 255) }) };
    const vector: VectorGlyph = { ...outline(simpleLayout()), kind: 'image', image };
    const svg = textSvg(simpleLayout(), [vector], OPTIONS).svg;
    const tag = firstTag(svg, 'image');
    // prettier-ignore
    for (const [key, value] of Object.entries({ x: '2', y: '3', width: '20', height: '10', preserveAspectRatio: 'none' }))
      expect(attribute(tag, key)).toBe(value);
    const href = attribute(tag, 'href');
    expect(href).toMatch(/^data:image\/png;base64,/);
    const bytes = Buffer.from(href?.slice('data:image/png;base64,'.length) ?? '', 'base64');
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.toString('ascii', 12, 16)).toBe('IHDR');
    expect(bytes.readUInt32BE(16)).toBe(1);
    expect(bytes.readUInt32BE(20)).toBe(1);
  });

  it.each(['truetype', 'opentype'] as const)(
    'embeds supplied %s bytes and escapes selectable source text',
    (format) => {
      const layout = simpleLayout('&<>"');
      const vector = outline(layout);
      const selectable = {
        familyOf: () => 'Test Face',
        embed: () => ({ bytes: Uint8Array.of(0, 1, 2), format }),
      };
      const embedded = textSvg(layout, [vector], { ...OPTIONS, selectable }).svg;
      expect(embedded).toContain('@font-face');
      expect(embedded).toContain(`data:font/${format === 'truetype' ? 'ttf' : 'otf'};base64,AAEC`);
      expect(embedded).toContain(`format('${format}')`);
      expect(embedded).toMatch(/&amp;&lt;&gt;(?:&quot;|&#34;)/);
      const absent = textSvg(layout, [vector], {
        ...OPTIONS,
        selectable: { familyOf: selectable.familyOf, embed: () => undefined },
      }).svg;
      expect(absent).not.toContain('@font-face');
    },
  );
});
