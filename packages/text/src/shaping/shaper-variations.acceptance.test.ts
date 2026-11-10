import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { GlyphOutline } from '../font/glyph-outline.js';

import { acceptanceFont } from './__fixtures__/shaping-fonts.js';
import { MAX_VARIATION_INSTANCES, loadShaper, shapeText } from './shaper.js';

type PenOperation = readonly [string, readonly (readonly [number, number])[]];
type Bounds = readonly [number, number, number, number];

interface ReferenceGlyph {
  readonly glyphId: number;
  readonly advance: number;
  readonly outline: readonly PenOperation[];
}

interface ReferenceInstance {
  readonly unitsPerEm: number;
  readonly glyphs: Readonly<Record<string, ReferenceGlyph>>;
}

const CORPUS = new URL('../__fixtures__/format-corpus/', import.meta.url);
const bytes = new Uint8Array(readFileSync(new URL('corpus-sans-variable.ttf', CORPUS)));
const reference = JSON.parse(
  readFileSync(new URL('corpus-sans-variable.reference.json', CORPUS), 'utf8'),
) as { at: Readonly<Record<string, ReferenceInstance>> };

function instance(weight: number): ReferenceInstance {
  const found = reference.at[String(weight)];
  if (found === undefined) throw new Error(`Missing reference at wght ${String(weight)}`);
  return found;
}

function glyph(weight: number, char: string): ReferenceGlyph {
  const found = instance(weight).glyphs[char];
  if (found === undefined) throw new Error(`Missing reference glyph ${char}`);
  return found;
}

function outlineBounds(outline: GlyphOutline): Bounds {
  const points = outline.contours.flatMap((contour) =>
    contour.flatMap(({ x0, y0, x1, y1 }) => [[x0, y0] as const, [x1, y1] as const]),
  );
  if (points.length === 0) throw new Error('Expected a nonempty outline');
  return [
    Math.min(...points.map(([x]) => x)),
    Math.max(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([, y]) => y)),
  ];
}

function referenceBounds(outline: readonly PenOperation[], unitsPerEm: number): Bounds {
  // A's reference contour has only moveTo and lineTo operations: every point is on-curve.
  const points = outline.flatMap(([, operationPoints]) => operationPoints);
  if (points.length === 0) throw new Error('Expected reference outline points');
  return [
    Math.min(...points.map(([x]) => x / unitsPerEm)),
    Math.max(...points.map(([x]) => x / unitsPerEm)),
    Math.min(...points.map(([, y]) => y / unitsPerEm)),
    Math.max(...points.map(([, y]) => y / unitsPerEm)),
  ];
}

describe('Shaper variable font acceptance', () => {
  it('keeps one permanent default face and ignores later bytes for the same id', async () => {
    const shaper = await loadShaper();
    const id = 'acceptance-variations-default';
    const regular = shaper.face(id, bytes);
    expect(shaper.face(id, bytes, {})).toBe(regular);
    expect(shaper.face(id, bytes, { wght: 400 })).toBe(regular);
    expect(regular.variations).toEqual({});
    expect(regular.variationKey).toBe('');
    const bold = shaper.face(id, acceptanceFont('eb-garamond').bytes, { wght: 700 });
    expect(shaper.face(id, bytes, { wght: 700 })).toBe(bold);
    expect(bold.variationKey).toBe('wght=700');
    expect(shapeText(shaper, bold, 'A', 0, 1).glyphs[0]?.advance).toBeCloseTo(
      glyph(700, 'A').advance / instance(700).unitsPerEm,
      9,
    );
  });

  it('drops unknown axes and reuses faces with the same normalised variation key', async () => {
    const shaper = await loadShaper();
    const id = 'acceptance-variations-normalised';
    const defaultFace = shaper.face(id, bytes);
    expect(shaper.face(id, bytes, { wdth: 125 })).toBe(defaultFace);
    const bold = shaper.face(id, bytes, { wght: 700, wdth: 125 });
    expect(bold.variations).toEqual({ wght: 700 });
    expect(bold.variationKey).toBe('wght=700');
    expect(shaper.face(id, bytes, { wght: 700 })).toBe(bold);
    expect(shaper.face(id, bytes, { wght: 699.99 })).toBe(bold);
  });

  it('ignores coordinates on a static font and keeps its shaping unchanged', async () => {
    const shaper = await loadShaper();
    const staticBytes = acceptanceFont('eb-garamond').bytes;
    const face = shaper.face('acceptance-variations-static', staticBytes);
    const withVariations = shaper.face('acceptance-variations-static', staticBytes, {
      wght: 700,
    });
    expect(withVariations).toBe(face);
    expect(withVariations.variations).toEqual({});
    expect(withVariations.variationKey).toBe('');
    expect(shapeText(shaper, withVariations, 'office', 0, 6)).toEqual(
      shapeText(shaper, face, 'office', 0, 6),
    );
  });

  it.each([400, 550, 700])('shapes A and a at wght %i like fontTools', async (weight) => {
    const shaper = await loadShaper();
    const face = shaper.face(`acceptance-variations-shape-${String(weight)}`, bytes, {
      wght: weight,
    });
    expect(face.variations).toEqual(weight === 400 ? {} : { wght: weight });
    expect(face.variationKey).toBe(weight === 400 ? '' : `wght=${String(weight)}`);
    for (const char of ['A', 'a']) {
      const shaped = shapeText(shaper, face, char, 0, 1);
      expect(shaped.glyphs).toHaveLength(1);
      expect(shaped.glyphs[0]?.glyphId).toBe(glyph(weight, char).glyphId);
      expect(shaped.glyphs[0]?.advance).toBeCloseTo(
        glyph(weight, char).advance / instance(weight).unitsPerEm,
        9,
      );
    }
  });

  it('draws the 700 outline at fontTools bounds, distinct from the 400 outline', async () => {
    const shaper = await loadShaper();
    const id = 'acceptance-variations-outline';
    const regular = shaper.face(id, bytes, { wght: 400 });
    const bold = shaper.face(id, bytes, { wght: 700 });
    const regularBounds = outlineBounds(shaper.outline(regular, glyph(400, 'A').glyphId));
    const boldBounds = outlineBounds(shaper.outline(bold, glyph(700, 'A').glyphId));
    const expected = referenceBounds(glyph(700, 'A').outline, instance(700).unitsPerEm);
    for (const [index, coordinate] of expected.entries()) {
      expect(boldBounds[index]).toBeCloseTo(coordinate, 9);
    }
    expect(boldBounds).not.toEqual(regularBounds);
  });

  it('keeps an evicted face usable and recreates equivalent instances', async () => {
    const shaper = await loadShaper();
    expect(Number.isInteger(MAX_VARIATION_INSTANCES)).toBe(true);
    expect(MAX_VARIATION_INSTANCES).toBeGreaterThan(0);
    const id = 'acceptance-variations-cache';
    const first = shaper.face(id, bytes, { wght: 401 });
    for (let index = 1; index <= MAX_VARIATION_INSTANCES; index += 1) {
      shaper.face(id, bytes, { wght: 401 + index });
    }
    const fresh = shaper.face('acceptance-variations-cache-fresh', bytes, { wght: 401 });
    const recreated = shaper.face(id, bytes, { wght: 401 });
    expect(first.variationKey).toBe('wght=401');
    expect(recreated.variationKey).toBe(first.variationKey);
    expect(shapeText(shaper, first, 'A', 0, 1)).toEqual(shapeText(shaper, fresh, 'A', 0, 1));
    expect(shapeText(shaper, recreated, 'A', 0, 1)).toEqual(shapeText(shaper, fresh, 'A', 0, 1));
    expect(shaper.outline(first, glyph(400, 'A').glyphId)).toEqual(
      shaper.outline(fresh, glyph(400, 'A').glyphId),
    );
  });

  it('reuses a held face after its font is recreated', async () => {
    const shaper = await loadShaper();
    const id = 'acceptance-held-face-identity';
    const first = shaper.face(id, bytes, { wght: 401 });

    for (let i = 1; i <= MAX_VARIATION_INSTANCES; i += 1) {
      shaper.face(id, bytes, { wght: 401 + i });
    }

    shapeText(shaper, first, 'A', 0, 1);
    expect(shaper.face(id, bytes, { wght: 401 })).toBe(first);
  });

  it('finds a held face after a newer face with its key is evicted', async () => {
    const shaper = await loadShaper();
    const id = 'acceptance-held-face-replacement';
    const held = shaper.face(id, bytes, { wght: 401 });

    for (let weight = 402; weight <= 433; weight += 1) {
      shaper.face(id, bytes, { wght: weight });
    }
    shaper.face(id, bytes, { wght: 401 }); // New face takes the evicted key.
    shapeText(shaper, held, 'A', 0, 1); // Held face becomes resident again.
    for (let weight = 434; weight <= 464; weight += 1) {
      shaper.face(id, bytes, { wght: weight }); // Evicts the newer face.
    }

    expect(shaper.face(id, bytes, { wght: 401 })).toBe(held);
  });

  it('rejects an imitation face even when its id and variation key match', async () => {
    const shaper = await loadShaper();
    const face = shaper.face('acceptance-variations-ownership', bytes, { wght: 700 });
    const imitation = {
      id: face.id,
      unitsPerEm: face.unitsPerEm,
      variations: face.variations,
      variationKey: face.variationKey,
    };
    expect(() => shapeText(shaper, imitation, 'A', 0, 1)).toThrow(RangeError);
    expect(() => shaper.outline(imitation, glyph(700, 'A').glyphId)).toThrow(RangeError);
  });
});
