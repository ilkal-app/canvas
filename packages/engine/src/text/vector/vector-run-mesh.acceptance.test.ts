/// <reference types="node" />
// Acceptance: lookup, placement, bounds, ownership, and winding of one vector run.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadShaper, SPACE, type LayoutGlyph, type TextLayout } from '@canvas/text';

import { glyphFaceOf, glyphKeyOf } from '../atlas/glyph-key.js';

import { tessellateGlyph, type GlyphGeometry } from './glyph-geometry.js';
import { buildVectorRunMesh, glyphGeometryKey } from './vector-run-mesh.js';

const TRIANGLE: GlyphGeometry = {
  vertices: new Float32Array([0, 0, 0, 1, 1, 0, 0.5, 0, 0, 2, 1, 1]),
  vertexCount: 3,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 2 },
};
const EMPTY: GlyphGeometry = { vertices: new Float32Array(), vertexCount: 0, bounds: undefined };

function glyph(codepoint: number, overrides: Partial<LayoutGlyph> = {}): LayoutGlyph {
  return {
    codepoint,
    index: 0,
    end: 1,
    glyphId: null,
    level: 0,
    line: 0,
    x: 0,
    y: 0,
    advance: 0,
    run: 0,
    ...overrides,
  };
}

function layout(glyphs: readonly LayoutGlyph[], fontSize = 10): TextLayout {
  return {
    text: '',
    runs: [
      { faceId: 'inter', variations: { wght: 0.5 }, fontSize, color: 'ink' },
      { faceId: 'other', fontSize: 20, color: 'ink' },
    ],
    glyphs,
    lines: [],
    width: 0,
    height: 0,
  };
}

function requireMesh(result: ReturnType<typeof buildVectorRunMesh>) {
  expect(result.missing).toBeUndefined();
  if (result.mesh === undefined) throw new Error('expected a complete vector mesh');
  return result.mesh;
}

function signedAreaSum(vertices: Float32Array): number {
  let sum = 0;
  for (let offset = 0; offset < vertices.length; offset += 12) {
    const ax = vertices[offset] ?? 0;
    const ay = vertices[offset + 1] ?? 0;
    const bx = vertices[offset + 4] ?? 0;
    const by = vertices[offset + 5] ?? 0;
    const cx = vertices[offset + 8] ?? 0;
    const cy = vertices[offset + 9] ?? 0;
    sum += ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
  }
  return sum;
}

describe('vector run mesh acceptance', () => {
  it('keys geometry by the exact face string and decimal glyph key', () => {
    expect(glyphGeometryKey('inter@wght=0.5', 65)).toBe('inter@wght=0.5#65');
    expect(glyphGeometryKey('inter@wght=0.5', -37)).toBe('inter@wght=0.5#-37');
    expect(glyphGeometryKey('inter@wght=0.5', 65)).not.toBe(glyphGeometryKey('inter', 65));
    expect(glyphGeometryKey('inter@wght=0.5', 65)).not.toBe(glyphGeometryKey('inter@wght=0.5', 66));
  });

  it('places all selected glyph triangles in layout order with unchanged curve coordinates', () => {
    const first = glyph(65, { x: 3, y: 8 });
    const second = glyph(66, { glyphId: 24, x: -2, y: 5 });
    const source = layout([first, glyph(67, { run: 1 }), second]);
    const before = JSON.stringify(source);
    const run = source.runs[0];
    if (run === undefined) throw new Error('expected the first run');
    const calls: [string, number][] = [];
    const mesh = requireMesh(
      buildVectorRunMesh(source, 0, { originX: 7, originY: 11 }, (face, key) => {
        calls.push([face, key]);
        return TRIANGLE;
      }),
    );
    expect(calls).toEqual([
      [glyphFaceOf(run), glyphKeyOf(first)],
      [glyphFaceOf(run), glyphKeyOf(second)],
    ]);
    expect(mesh.run).toBe(0);
    expect(mesh.vertexCount).toBe(6);
    expect(mesh.vertices).toBeInstanceOf(Float32Array);
    expect(Array.from(mesh.vertices)).toEqual([
      10, 19, 0, 1, 20, 19, 0.5, 0, 10, -1, 1, 1, 5, 16, 0, 1, 15, 16, 0.5, 0, 5, -4, 1, 1,
    ]);
    expect(mesh.bounds).toEqual({ minX: 5, minY: -4, maxX: 20, maxY: 19 });
    expect(JSON.stringify(source)).toBe(before);
    expect(Array.from(TRIANGLE.vertices)).toEqual([0, 0, 0, 1, 1, 0, 0.5, 0, 0, 2, 1, 1]);
    mesh.vertices[0] = 999;
    expect(TRIANGLE.vertices[0]).toBe(0);
  });

  it('reports distinct missing keys in first appearance order and returns no partial mesh', () => {
    const source = layout([
      glyph(65),
      glyph(66),
      glyph(65, { x: 10 }),
      glyph(SPACE),
      glyph(67, { run: 1 }),
      glyph(68),
    ]);
    const called: number[] = [];
    const result = buildVectorRunMesh(source, 0, { originX: 0, originY: 0 }, (face, key) => {
      expect(face).toBe('inter@wght=0.5');
      called.push(key);
      return key === 66 ? TRIANGLE : undefined;
    });
    expect(result).toEqual({ missing: [65, 68] });
    expect(result.mesh).toBeUndefined();
    expect(called).not.toContain(SPACE);
    expect(called).not.toContain(67);
  });

  it('skips spaces and empty geometry, and returns an empty mesh for absent runs', () => {
    const source = layout([glyph(SPACE), glyph(65), glyph(66, { run: 1 })]);
    const calls: number[] = [];
    const lookup = (face: string, key: number) => {
      expect(face).toBe('inter@wght=0.5');
      calls.push(key);
      return EMPTY;
    };
    const emptyGeometry = requireMesh(
      buildVectorRunMesh(source, 0, { originX: 2, originY: 3 }, lookup),
    );
    expect(calls).toEqual([65]);
    expect(emptyGeometry).toEqual({
      run: 0,
      vertices: new Float32Array(),
      vertexCount: 0,
      bounds: undefined,
      edges: new Float32Array(),
      edgeVertexCount: 0,
    });
    expect(requireMesh(buildVectorRunMesh(source, 2, { originX: 2, originY: 3 }, lookup))).toEqual({
      run: 2,
      vertices: new Float32Array(),
      vertexCount: 0,
      bounds: undefined,
      edges: new Float32Array(),
      edgeVertexCount: 0,
    });
    expect(calls).toEqual([65]);
    expect(
      requireMesh(buildVectorRunMesh(layout([]), 0, { originX: 2, originY: 3 }, lookup)),
    ).toEqual({
      run: 0,
      vertices: new Float32Array(),
      vertexCount: 0,
      bounds: undefined,
      edges: new Float32Array(),
      edgeVertexCount: 0,
    });
    expect(calls).toEqual([65]);
  });

  it('reverses the signed area of real HarfBuzz triangles by fontSize squared', async () => {
    const shaper = await loadShaper();
    const font = readFileSync(
      new URL(
        '../../../../text/src/__fixtures__/format-corpus/corpus-sans-regular.ttf',
        import.meta.url,
      ),
    );
    const face = shaper.face('corpus', Uint8Array.from(font));
    const glyphId = 36;
    const geometry = tessellateGlyph(shaper.outline(face, glyphId));
    const emArea = signedAreaSum(geometry.vertices);
    expect(geometry.vertexCount).toBeGreaterThan(0);
    expect(Math.abs(emArea)).toBeGreaterThan(0.01);
    const fontSize = 4;
    const source = layout([glyph(65, { glyphId, x: 1, y: 3 })], fontSize);
    const mesh = requireMesh(
      buildVectorRunMesh(source, 0, { originX: 0, originY: 0 }, (face, key) => {
        expect(face).toBe('inter@wght=0.5');
        return key === -1 - glyphId ? geometry : undefined;
      }),
    );
    expect(mesh.vertexCount).toBe(geometry.vertexCount);
    const expectedArea = -(fontSize * fontSize) * emArea;
    expect(
      Math.abs(signedAreaSum(mesh.vertices) - expectedArea) / Math.abs(expectedArea),
    ).toBeLessThan(1e-6);
  });
});
