// The selectable text layer and colour layers of really shaped text, through
// HarfBuzz and the checked-in fonts (split from text-svg.acceptance.test.ts for length).
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import {
  createFontMetrics,
  createShapingMeasurer,
  layoutText,
  loadShaper,
  parseFont,
  textVectors,
  type TextLayout,
  type VectorFill,
  type VectorGlyph,
} from '../index.js';
import { acceptanceFont, type AcceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';

import { textSvg } from './text-svg.js';

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
 * Reads a quoted attribute from a checked SVG tag.
 *
 * @param tag - The opening tag.
 * @param name - Attribute name.
 * @returns Its decoded spelling, if present.
 */
function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];
}

/**
 * Shapes a checked-in font with HarfBuzz and exports its vectors.
 *
 * @param family - Fixture family key.
 * @param source - Source text.
 * @returns The real layout and vectors.
 */
async function shaped(
  family: Parameters<typeof acceptanceFont>[0] | 'noto-color-emoji',
  source: string,
): Promise<{ layout: TextLayout; vectors: VectorGlyph[] }> {
  const shaper = await loadShaper();
  const font = family === 'noto-color-emoji' ? emojiFont() : acceptanceFont(family);
  // prettier-ignore
  const style: TextStyle = { fontFamily: font.metrics.face.family, fontSize: 20, color: [0.2, 0.4, 0.8, 1], weight: 400, italic: false };
  // prettier-ignore
  const layout = layoutText(source, [{ length: source.length, style }], null, createShapingMeasurer(shaper, [font]));
  const faceId = layout.runs[0]?.faceId;
  if (faceId === undefined) throw new Error('missing shaped face');
  const face = shaper.face(faceId, font.bytes);
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
  return { layout, vectors };
}

/**
 * Loads the full emoji face with its metrics-only companion.
 *
 * @returns The colour face and layout metrics.
 */
function emojiFont(): AcceptanceFont {
  // prettier-ignore
  const base = new URL('../../../app/assets/fonts/script-coverage/notocoloremoji/', import.meta.url);
  return {
    bytes: readFileSync(new URL('400.ttf', base)),
    // prettier-ignore
    metrics: createFontMetrics({ family: 'Noto Color Emoji', weight: 400, isItalic: false }, parseFont(readFileSync(new URL('400-metrics.ttf', base)))),
  };
}

const OPTIONS = { colorOf, idPrefix: 'text-a' };

describe('textSvg with shaped text', () => {
  it('emits one logical-order tspan for the EB Garamond ffi ligature with its advance', async () => {
    const { layout, vectors } = await shaped('eb-garamond', 'office');
    const svg = textSvg(layout, vectors, {
      ...OPTIONS,
      selectable: { familyOf: () => 'EB Garamond' },
    }).svg;
    const spans = [...svg.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
    expect(spans.map((match) => match[2])).toEqual(['o', 'ffi', 'c', 'e']);
    const ligature = spans[1]?.[1] ?? '';
    const glyph = layout.glyphs.find(({ index, end }) => index === 1 && end === 4);
    expect(glyph).toBeDefined();
    expect(Number(attribute(ligature, 'x'))).toBeCloseTo(glyph?.x ?? NaN);
    expect(Number(attribute(ligature, 'y'))).toBeCloseTo(glyph?.y ?? NaN);
    expect(Number(attribute(ligature, 'textLength'))).toBeCloseTo(glyph?.advance ?? NaN);
    expect(attribute(ligature, 'lengthAdjust')).toBe('spacingAndGlyphs');
    expect(svg).toMatch(/<text\b[^>]*(?:fill-opacity="0"|fill="transparent")/);
    expect(svg).toContain('font-family="EB Garamond"');
    expect(svg).toContain('font-size="20"');
    expect(svg.indexOf('<text')).toBeGreaterThan(svg.lastIndexOf('<path'));
  });

  it('orders Noto Sans Arabic tspans by source cluster despite visual-order outlines', async () => {
    const { layout, vectors } = await shaped('noto-sans-arabic', 'سلام');
    expect(vectors.map(({ cluster }) => cluster.start)).toEqual(
      [...vectors.map(({ cluster }) => cluster.start)].sort((a, b) => b - a),
    );
    const svg = textSvg(layout, vectors, {
      ...OPTIONS,
      selectable: { familyOf: () => 'Noto Sans Arabic' },
    }).svg;
    const actual = [...svg.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)].map((match) => match[1]);
    // prettier-ignore
    const expected = [...new Map(vectors.map(({ cluster }) => [cluster.start, layout.text.slice(cluster.start, cluster.end)])).entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
    expect(actual).toEqual(expected);
  });

  it('exports real Noto Color Emoji layers with prefixed unique defs ids and deterministic output', async () => {
    const { layout, vectors } = await shaped('noto-color-emoji', '😀');
    expect(vectors[0]?.kind).toBe('layers');
    const first = textSvg(layout, vectors, OPTIONS);
    expect(textSvg(layout, vectors, OPTIONS)).toEqual(first);
    const ids = [...first.svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id?.startsWith('text-a'))).toBe(true);
    expect(textSvg(layout, vectors, { ...OPTIONS, idPrefix: 'text-b' }).svg).not.toContain(
      'id="text-a',
    );
  });
});
