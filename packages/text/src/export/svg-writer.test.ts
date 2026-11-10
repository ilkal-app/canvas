// The SVG writer's edges: base64 padding, multi-block PNGs, sweep colour lines,
// multi-glyph clusters, empty and unfilled vectors.
import { describe, expect, it } from 'vitest';

import type { TextLayout } from '../layout/text-layout.js';

import type { VectorGradientStop, VectorSweepGradient } from './colour-layers.js';
import { colourLineOf } from './colour-line.js';
import { base64Of, bgraToPng } from './png-encode.js';
import { sweepWedges, type Rgba } from './svg-paint.js';
import { textSvg } from './text-svg.js';
import type { VectorGlyph } from './text-vectors.js';

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

/**
 * Resolves a test fill: `red`/`blue` names or an RGBA tuple.
 *
 * @param fill - The fill.
 * @returns The colour.
 */
function colorOf(fill: unknown): Rgba {
  if (fill === 'blue') return BLUE;
  return Array.isArray(fill) ? (fill as unknown as Rgba) : RED;
}

/**
 * The colours of a sweep's wedges, in order.
 *
 * @param stops - The colour line.
 * @param extend - Past its ends.
 * @param endAngle - The line's end angle; it starts at 0.
 * @returns Each wedge's fill.
 */
function wedgeFills(
  stops: readonly VectorGradientStop[],
  extend: 'pad' | 'repeat' | 'reflect',
  endAngle = Math.PI,
): string[] {
  const gradient: VectorSweepGradient = {
    ...{ kind: 'sweep', x0: 0, y0: 0, startAngle: 0, endAngle, extend, stops, transform: IDENTITY },
  };
  const line = colourLineOf(gradient, colorOf as never);
  if (line === null) return [];
  const svg = sweepWedges(line);
  return [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((match) => match[1] ?? '');
}

describe('the SVG writer edges', () => {
  it('pads base64 for one, two and three trailing bytes', () => {
    expect(base64Of(Uint8Array.of(0))).toBe('AA==');
    expect(base64Of(Uint8Array.of(0, 1))).toBe('AAE=');
    expect(base64Of(Uint8Array.of(0, 1, 2))).toBe('AAEC');
    expect(base64Of(new Uint8Array(0))).toBe('');
  });

  it('writes a large bitmap in several stored deflate blocks, and an empty one', () => {
    const big = bgraToPng(new Uint8Array(200 * 100 * 4), 200, 100);
    expect(big.length).toBeGreaterThan(200 * 100 * 4);
    expect(Buffer.from(big.subarray(12, 16)).toString('ascii')).toBe('IHDR');
    expect(bgraToPng(new Uint8Array(0), 0, 0).length).toBeGreaterThan(8);
  });

  it('colours a sweep along its stops, clamped by pad and cycled by repeat and reflect', () => {
    const stops = [
      { offset: 0.25, color: 'red' },
      { offset: 0.75, color: 'blue' },
    ] as unknown as VectorGradientStop[];
    const pad = wedgeFills(stops, 'pad');
    expect(pad[0]).toBe('#ff0000');
    expect(pad.at(-1)).toBe('#0000ff');
    expect(wedgeFills(stops, 'repeat')).not.toEqual(pad);
    expect(wedgeFills(stops, 'reflect')).not.toEqual(wedgeFills(stops, 'repeat'));
    expect(new Set(wedgeFills(stops, 'pad', 0))).toEqual(new Set(['#ff0000']));
    expect(wedgeFills([], 'pad')).toEqual([]);
    const same = [
      { offset: 0.5, color: 'red' },
      { offset: 0.5, color: 'blue' },
    ] as unknown as VectorGradientStop[];
    expect(wedgeFills(same, 'pad')).toContain('#ff0000');
  });

  it('merges a cluster of several glyphs into one tspan, and skips empty or unfilled vectors', () => {
    const glyph = { codepoint: 65, level: 0, line: 0, y: 10, run: 0, glyphId: 1 };
    const layout = {
      text: 'ab',
      runs: [{ faceId: 'f', fontSize: 10, color: 'ink' }],
      glyphs: [
        { ...glyph, index: 0, end: 2, x: 6, advance: 4 },
        { ...glyph, index: 0, end: 2, x: 2, advance: 4 },
      ],
      lines: [],
      width: 10,
      height: 10,
    } as unknown as TextLayout;
    const base = { glyphId: 1, faceId: 'f', cluster: { start: 0, end: 2 }, pdf: '', fill: 'ink' };
    const vectors = [
      { ...base, kind: 'outline', d: '' },
      {
        ...base,
        kind: 'layers',
        d: 'M 0 0 Z',
        groups: [],
        layers: [{ d: 'M 1 1 Z', pdf: '', clips: [], groups: [] }],
      },
      {
        ...base,
        kind: 'image',
        d: '',
        image: { pixelWidth: 0, pixelHeight: 0, x: 0, y: 0, width: 1, height: 1 },
      },
    ] as unknown as VectorGlyph[];
    const { svg } = textSvg(layout, vectors, {
      colorOf: colorOf,
      idPrefix: 'e',
      selectable: { familyOf: () => 'F' },
    });
    expect(svg).toContain('<tspan x="2" y="10" textLength="8"');
    expect(svg).toContain('d="M 1 1 Z" fill="#000000" fill-opacity="0"');
    expect(svg).toContain('<image');
    expect(svg).not.toContain('d=""');
  });
  it('closes groups a layer leaves, opens src-over groups plainly, and tolerates a missing group', () => {
    const layout = {
      text: 'a',
      runs: [],
      glyphs: [],
      lines: [],
      width: 0,
      height: 0,
    } as unknown as TextLayout;
    const layer = (groups: number[]) => ({ d: 'M 0 0 Z', pdf: '', clips: [], groups, fill: 'red' });
    const vector = {
      kind: 'layers',
      ...{ glyphId: 1, faceId: 'f', cluster: { start: 0, end: 1 }, d: '', pdf: '', fill: 'ink' },
      groups: [
        { mode: 'src-over', parent: null },
        { mode: 'multiply', parent: 0 },
      ],
      layers: [layer([0, 1]), layer([0]), layer([]), layer([7])],
    } as unknown as VectorGlyph;
    const { svg } = textSvg(layout, [vector], { colorOf: colorOf, idPrefix: 'g' });
    expect(svg).toBe(
      [
        '<g>',
        '<g style="isolation:isolate"><g style="isolation:isolate; mix-blend-mode: multiply">',
        '<path d="M 0 0 Z" fill="#ff0000" fill-rule="nonzero"/></g>',
        '<path d="M 0 0 Z" fill="#ff0000" fill-rule="nonzero"/></g>',
        '<path d="M 0 0 Z" fill="#ff0000" fill-rule="nonzero"/>',
        '<g style="isolation:isolate"><path d="M 0 0 Z" fill="#ff0000" fill-rule="nonzero"/></g>',
        '</g>',
      ].join(''),
    );
  });

  it('embeds a face once for several clusters, and sizes a glyph with no run at zero', () => {
    const glyph = { codepoint: 97, level: 0, line: 0, y: 10, advance: 5, glyphId: 1 };
    const layout = {
      text: 'abc',
      runs: [{ faceId: 'f', fontSize: 10, color: 'ink' }],
      glyphs: [
        { ...glyph, index: 0, end: 1, x: 0, run: 0 },
        { ...glyph, index: 1, end: 2, x: 5, run: 0 },
        { ...glyph, index: 2, end: 3, x: 10, run: 9 },
      ],
      lines: [],
      width: 15,
      height: 10,
    } as unknown as TextLayout;
    let calls = 0;
    const { svg } = textSvg(layout, [], {
      colorOf: colorOf,
      idPrefix: 't',
      selectable: {
        familyOf: (faceId) => `F${faceId}`,
        embed: () => {
          calls += 1;
          return { bytes: Uint8Array.of(1), format: 'opentype' };
        },
      },
    });
    expect(calls).toBe(2);
    expect(svg.match(/@font-face/g)).toHaveLength(2);
    expect(svg).toContain('font-family="F" font-size="0">c</tspan>');
  });
});
