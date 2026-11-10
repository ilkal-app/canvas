import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { StyleRun, TextStyle } from '@canvas/schema';

import {
  createFontMetrics,
  createShapingMeasurer,
  layoutText,
  loadShaper,
  parseFont,
  shapeText,
  type Shaper,
  type TextLayout,
} from '../index.js';
import * as text from '../index.js';
import { acceptanceFont, type AcceptanceFont } from '../shaping/__fixtures__/shaping-fonts.js';

import { glyphPathData, glyphTransform } from './glyph-path-data.js';
import { textVectors } from './text-vectors.js';

const INK: [number, number, number, number] = [0.2, 0.4, 0.8, 1];
const EMOJI = new URL('../../../app/assets/fonts/script-coverage/notocoloremoji/', import.meta.url);

/**
 * Makes a checked-in font's regular style and keeps test geometry deterministic.
 *
 * @param family - The font family.
 * @param fontSize - The font size in box units.
 * @returns A regular text style.
 */
function style(family: string, fontSize = 20): TextStyle {
  return { fontFamily: family, fontSize, color: INK, weight: 400, italic: false };
}

/**
 * Lays out one styled run through the real HarfBuzz measurer.
 *
 * @param shaper - The loaded HarfBuzz shaper.
 * @param font - Bundled font bytes and metrics.
 * @param text - The source string.
 * @param fontSize - The font size in box units.
 * @returns Positioned glyphs from real shaping.
 */
function shapedLayout(
  shaper: Shaper,
  font: AcceptanceFont,
  text: string,
  fontSize = 20,
): TextLayout {
  const runs: StyleRun[] = [
    { length: text.length, style: style(font.metrics.face.family, fontSize) },
  ];
  return layoutText(text, runs, null, createShapingMeasurer(shaper, [font]));
}

/**
 * Adapts a real shaper face to the proposed face-id based vector source.
 *
 * @param shaper - The loaded HarfBuzz shaper.
 * @param font - Bundled font bytes and metrics.
 * @param faceId - The layout's resolved face ID.
 * @returns Outline and colour callbacks for that face.
 */
function vectorSource(shaper: Shaper, font: AcceptanceFont, faceId: string) {
  const face = shaper.face(faceId, font.bytes);
  return {
    outline: (requestedFaceId: string, glyphId: number) => {
      expect(requestedFaceId).toBe(faceId);
      return shaper.outline(face, glyphId);
    },
    colourGlyph: (requestedFaceId: string, glyphId: number) => {
      expect(requestedFaceId).toBe(faceId);
      return shaper.colourGlyph(face, glyphId);
    },
  };
}

/**
 * Loads the full COLRv1 drawing face with its smaller metrics-only companion.
 *
 * @returns The drawing bytes and layout metrics.
 */
function emojiFont(): AcceptanceFont {
  const bytes = readFileSync(new URL('400.ttf', EMOJI));
  const metricsBytes = readFileSync(new URL('400-metrics.ttf', EMOJI));
  const metrics = createFontMetrics(
    { family: 'Noto Color Emoji', weight: 400, isItalic: false },
    parseFont(metricsBytes),
  );
  return { bytes, metrics };
}

/**
 * Requires a value whose presence is part of a test's setup.
 *
 * @param value - A value that must exist.
 * @returns The present value.
 * @throws {Error} When the fixture did not produce the expected value.
 */
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing fixture value');
  return value;
}

describe('textVectors with shaped text', () => {
  it('exports the vector API from @canvas/text', () => {
    expect(text.textVectors).toBe(textVectors);
  });

  it('exports one EB Garamond ffi outline for the three-character office cluster', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const layout = shapedLayout(shaper, font, 'office');
    const source = vectorSource(shaper, font, required(layout.runs[0]).faceId);
    const vectors = textVectors(layout, source);
    expect(vectors).toHaveLength(4);
    expect(vectors.map(({ cluster }) => cluster)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 4 },
      { start: 4, end: 5 },
      { start: 5, end: 6 },
    ]);
    const ligature = required(vectors[1]);
    const glyph = required(layout.glyphs[1]);
    expect(ligature).toMatchObject({
      kind: 'outline',
      glyphId: glyph.glyphId,
      faceId: required(layout.runs[0]).faceId,
      fill: INK,
    });
    expect(ligature.d).toBe(
      glyphPathData(
        shaper.outline(shaper.face(ligature.faceId, font.bytes), required(glyph.glyphId)),
        glyphTransform(glyph, required(layout.runs[0]).fontSize),
      ),
    );
    expect(ligature.d).not.toBe('');
    expect(ligature.pdf).not.toBe('');
  });

  it('preserves Arabic visual order, joining forms and their positioned outlines', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('noto-sans-arabic');
    const text = 'سلام';
    const layout = shapedLayout(shaper, font, text);
    const faceId = required(layout.runs[0]).faceId;
    const face = shaper.face(faceId, font.bytes);
    const vectors = textVectors(layout, vectorSource(shaper, font, faceId));
    expect(vectors).toHaveLength(layout.glyphs.length);
    expect(vectors.map(({ glyphId }) => glyphId)).toEqual(
      layout.glyphs.map(({ glyphId }) => glyphId),
    );
    expect(vectors.map(({ cluster }) => cluster.start)).toEqual(
      [...vectors.map(({ cluster }) => cluster.start)].sort((a, b) => b - a),
    );
    const isolatedIds = new Set(
      Array.from(text).flatMap((letter) =>
        shapeText(shaper, face, letter, 0, letter.length).glyphs.map(({ glyphId }) => glyphId),
      ),
    );
    expect(vectors.some(({ glyphId }) => !isolatedIds.has(glyphId))).toBe(true);
    expect(vectors.every(({ d }) => d.length > 0)).toBe(true);
    const advancing = layout.glyphs.filter(({ advance }) => advance > 0).map(({ x }) => x);
    expect(advancing).toEqual([...advancing].sort((a, b) => a - b));
  });

  it('exports Noto Color Emoji 😀 as colour layers rather than a plain outline', async () => {
    const shaper = await loadShaper();
    const font = emojiFont();
    const layout = shapedLayout(shaper, font, '😀');
    const faceId = required(layout.runs[0]).faceId;
    const face = shaper.face(faceId, font.bytes);
    const glyphId = required(required(layout.glyphs[0]).glyphId);
    expect(shaper.colourGlyph(face, glyphId)).toBeDefined();
    const vectors = textVectors(layout, vectorSource(shaper, font, faceId));
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toMatchObject({ kind: 'layers', cluster: { start: 0, end: 2 } });
    expect(required(required(vectors[0]).layers).length).toBeGreaterThan(0);
    expect(required(required(vectors[0]).layers).some((layer) => layer.d.length > 0)).toBe(true);
    expect(
      required(required(vectors[0]).layers).every(
        (layer) => layer.fill !== undefined || layer.gradient !== undefined,
      ),
    ).toBe(true);
  });

  it('preserves COLR layer order and PNG bitmap placement with distinct colour variants', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const layout = shapedLayout(shaper, font, 'A');
    const faceId = required(layout.runs[0]).faceId;
    const outline = { contours: [[{ kind: 'line' as const, x0: 0, y0: 0, x1: 1, y1: 0 }]] };
    const red = { r: 1, g: 0, b: 0, a: 1 };
    const blue = { r: 0, g: 0, b: 1, a: 1 };
    const source = {
      outline: () => outline,
      colourGlyph: () => ({
        ops: [
          { op: 'push-clip-glyph' as const, outline },
          { op: 'solid' as const, color: red, isForeground: false },
          { op: 'pop-clip' as const },
          { op: 'push-clip-glyph' as const, outline },
          { op: 'solid' as const, color: blue, isForeground: false },
          { op: 'pop-clip' as const },
        ],
      }),
    };
    expect(textVectors(layout, source)[0]).toMatchObject({
      kind: 'layers',
      faceId,
      layers: [{ fill: red }, { fill: blue }],
    });
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gXcAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const bitmap = textVectors(layout, {
      outline: () => outline,
      colourGlyph: () => ({
        ops: [
          {
            op: 'image' as const,
            format: 'png' as const,
            bytes: png,
            width: 10,
            height: 10,
            xMin: 0,
            yMin: 0,
            xMax: 1,
            yMax: 1,
          },
        ],
      }),
    })[0];
    expect(bitmap).toMatchObject({
      kind: 'image',
      image: {
        png,
        x: required(layout.glyphs[0]).x,
        y: required(layout.glyphs[0]).y - 20,
        width: 20,
        height: 20,
      },
    });
  });

  it('keeps plain-run fill and doubles outline coordinates when font size doubles', async () => {
    const shaper = await loadShaper();
    const font = acceptanceFont('eb-garamond');
    const small = shapedLayout(shaper, font, 'A', 20);
    const large = shapedLayout(shaper, font, 'A', 40);
    const source = vectorSource(shaper, font, required(small.runs[0]).faceId);
    const first = required(textVectors(small, source)[0]);
    const second = required(textVectors(large, source)[0]);
    expect(first).toMatchObject({ kind: 'outline', fill: INK });
    expect(second.fill).toEqual(INK);
    const numbers = (path: string): number[] =>
      [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(([value]) => Number(value));
    const smallCoordinates = numbers(first.d);
    const largeCoordinates = numbers(second.d);
    expect(largeCoordinates).toHaveLength(smallCoordinates.length);
    for (let index = 0; index < smallCoordinates.length; index += 1) {
      expect(largeCoordinates[index]).toBeCloseTo(required(smallCoordinates[index]) * 2, 2);
    }
  });
});
