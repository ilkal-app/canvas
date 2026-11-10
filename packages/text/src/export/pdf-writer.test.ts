// The PDF writer's edges: number text, stopless and partial colour lines, radial
// spreads, PNG faults and the Paeth filter, shared states, sweeps and groups, images without alpha.
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import type { TextLayout } from '../layout/text-layout.js';

import type { VectorGradient, VectorRadialGradient } from './colour-layers.js';
import { colourLineOf, type Rgba } from './colour-line.js';
import { pdfDocument } from './pdf-document.js';
import { pdfNumber, shadingOf } from './pdf-paint.js';
import { decodePng } from './png-decode.js';
import { textPdf } from './text-pdf.js';
import type { VectorGlyph } from './text-vectors.js';

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const RED: Rgba = [1, 0, 0, 1];
const EMPTY = { text: '', runs: [], glyphs: [], lines: [], width: 0, height: 0 } as TextLayout;
const BASE = { glyphId: 1, faceId: 'f', cluster: { start: 0, end: 1 }, d: '', fill: 'ink' };

/**
 * A PNG chunk with a CRC.
 *
 * @param type - Its type.
 * @param data - Its data.
 * @returns The chunk.
 */
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, sum]);
}

/**
 * A PNG of RGB rows (filter bytes included), or with a given header depth.
 *
 * @param width - Columns.
 * @param height - Rows.
 * @param rows - The filtered scanlines.
 * @param depth - Bits a sample.
 * @returns The file.
 */
function png(width: number, height: number, rows: number[], depth = 8): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Uint8Array.from(rows))),
    chunk('IEND', new Uint8Array()),
  ]);
}

/**
 * A radial gradient between two concentric circles, red to red.
 *
 * @param r0 - Start radius.
 * @param r1 - End radius.
 * @param extend - Its spread.
 * @returns The gradient.
 */
function radial(r0: number, r1: number, extend: 'repeat' | 'reflect'): VectorRadialGradient {
  return {
    ...{ kind: 'radial', x0: 0, y0: 0, r0, x1: 0, y1: 0, r1, extend, transform: IDENTITY },
    stops: [
      { offset: 0, color: RED },
      { offset: 1, color: RED },
    ],
  } as unknown as VectorRadialGradient;
}

/**
 * A gradient's shading, through its resolved line.
 *
 * @param gradient - The gradient, not a sweep.
 * @returns The shading dictionary.
 * @throws {Error} When the gradient resolves to nothing or to a sweep.
 */
function shading(gradient: VectorGradient): string {
  const line = colourLineOf(gradient, (fill) => fill as unknown as Rgba);
  if (line === null || line.gradient.kind === 'sweep') throw new Error('expected a shading');
  return shadingOf({ ...line, gradient: line.gradient });
}

describe('the PDF writer edges', () => {
  it('writes reals without exponents or negative zero', () => {
    expect(pdfNumber(-1e-12)).toBe('0');
    expect(pdfNumber(1.5e-7)).toBe('0.00000015');
    expect(pdfNumber(2.5)).toBe('2.5');
  });

  it('stitches partial and stopless lines, and spreads radial cones only while r stays ≥ 0', () => {
    const line = (stops: { offset: number; rgba: Rgba }[]) =>
      shadingOf({ gradient: { ...radial(1, 2, 'repeat'), extend: 'pad' }, stops });
    expect(line([])).toContain('/C0 [0 0 0] /C1 [0 0 0]');
    expect(line([{ offset: 0.5, rgba: RED }])).toMatch(/\/Bounds \[0\.5\]/);
    expect(shading(radial(1, 3, 'repeat'))).toMatch(/\/Domain \[-0\.5 17\]/);
    expect(shading(radial(3, 1, 'repeat'))).toMatch(/\/Domain \[-16 1\.5\]/);
    // Period -16 is even, so reflect's encode starts forward and alternates.
    expect(shading(radial(2, 2, 'reflect'))).toMatch(
      /\/Domain \[-16 17\][\s\S]*\/Encode \[0 1 1 0 /,
    );
  });

  it('decodes the Paeth filter’s upper-left choice, and refuses broken PNGs', async () => {
    const rows = [0, 20, 20, 20, 30, 30, 30, 4, 246, 246, 246, 30, 30, 30];
    const decoded = await decodePng(png(2, 2, rows));
    expect(typeof decoded === 'string' ? decoded : [...decoded.rgb]).toEqual([
      20, 20, 20, 30, 30, 30, 10, 10, 10, 50, 50, 50,
    ]);
    // Left is nearer than up, but upper-left is nearer still: Paeth picks upper-left.
    const nearer = await decodePng(png(2, 2, [0, 4, 4, 4, 0, 0, 0, 4, 6, 6, 6, 16, 16, 16]));
    expect(typeof nearer === 'string' ? nearer : [...nearer.rgb]).toEqual([
      4, 4, 4, 0, 0, 0, 10, 10, 10, 20, 20, 20,
    ]);
    // With no neighbours (all zero), Paeth picks the left byte.
    const lone = await decodePng(png(1, 1, [4, 1, 2, 3]));
    expect(typeof lone === 'string' ? lone : [...lone.rgb]).toEqual([1, 2, 3]);
    expect(await decodePng(Uint8Array.of(1, 2, 3))).toBe('not a PNG file');
    const noHeader = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IEND', new Uint8Array(30)),
    ]);
    expect(await decodePng(noHeader)).toBe('not a PNG file');
    expect(await decodePng(png(1, 1, [0, 1, 2, 3], 16))).toMatch(/not supported/);
    expect(await decodePng(png(1, 1, [5, 1, 2, 3]))).toMatch(/malformed/);
    expect(await decodePng(png(1, 2, [0, 1, 2, 3]))).toMatch(/malformed/);
    // A wrong signature, a chunk running past the file, broken zlib.
    const good = png(1, 1, [0, 1, 2, 3]);
    expect(await decodePng(Uint8Array.from([0, ...good.subarray(1)]))).toBe('not a PNG file');
    expect(await decodePng(good.subarray(0, good.length - 20))).toBe('not a PNG file');
    const broken = Buffer.from(good);
    const idat = broken.indexOf('IDAT');
    broken[idat + 4] = 0xff;
    expect(await decodePng(broken)).toMatch(/malformed/);
  });

  it('shares an alpha state, colours sweeps by spread, and skips empty or missing paint', async () => {
    const layer = (extra: object) => ({ d: '', pdf: '0 0 m h', clips: [], groups: [], ...extra });
    const sweep = (extend: string, endAngle: number) => ({
      kind: 'sweep',
      ...{ x0: 0, y0: 0, startAngle: 0, endAngle, extend, transform: IDENTITY },
      stops: [
        { offset: 0, color: RED },
        { offset: 1, color: [0, 0, 1, 1] },
      ],
    });
    const vectors = [
      { ...BASE, kind: 'outline', pdf: '0 0 m h', fill: [1, 0, 0, 0.5] },
      { ...BASE, kind: 'outline', pdf: '1 1 m h', fill: [1, 0, 0, 0.5] },
      { ...BASE, kind: 'outline', pdf: '' },
      {
        ...BASE,
        kind: 'layers',
        pdf: '',
        groups: [{ mode: 'multiply', parent: null }],
        layers: [
          layer({ groups: [0] }),
          layer({ groups: [0] }),
          layer({ groups: [9] }),
          layer({ gradient: sweep('pad', 1) }),
          layer({ gradient: sweep('repeat', 1) }),
          layer({ gradient: sweep('reflect', 1) }),
          layer({ gradient: sweep('pad', 0) }),
        ],
      },
      {
        ...BASE,
        kind: 'image',
        pdf: '',
        image: { pixelWidth: 0, pixelHeight: 0, x: 0, y: 0, width: 1, height: 1 },
      },
    ] as unknown as VectorGlyph[];
    const result = await textPdf(EMPTY, vectors, {
      colorOf: (fill) => fill as unknown as Rgba,
      namePrefix: 'E',
    });
    // The shared half alpha, the group's blend, and the unfilled layer's zero alpha.
    expect(Object.keys(result.resources.extGStates)).toEqual(['EGs1', 'EGs2', 'EGs3']);
    expect(result.content.match(/\/EGs1 gs/g)).toHaveLength(2);
    expect(result.content).not.toContain(' f\nQ\nq\n f');
    expect(result.content).toContain('/EIm1 Do');
    expect(result.warnings.some((warning) => warning.includes('sweep'))).toBe(true);
  });

  it('writes a transparency group form drawing with its page’s resources', () => {
    const pdf = Buffer.from(
      pdfDocument([
        {
          ...{ width: 1, height: 1, content: 'q /G1 gs /F1 Do Q' },
          resources: {
            extGStates: { G1: '<< /BM /Multiply >>' },
            shadings: {},
            images: {},
            forms: { F1: 'q /G1 gs /F2 Do Q', F2: '0 0 m h f' },
          },
        },
      ]),
    ).toString('latin1');
    const forms = [...pdf.matchAll(/\/Subtype \/Form ([^\n]*)/g)].map((match) => match[1] ?? '');
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(form).toContain('/BBox [-1000000 -1000000 1000000 1000000]');
      expect(form).toContain('/Group << /Type /Group /S /Transparency /I true /K false >>');
      // Each form draws with the page's resources, so the nested form and the state resolve.
      expect(form).toMatch(/\/G1 \d+ 0 R[\s\S]*\/F1 \d+ 0 R \/F2 \d+ 0 R/);
    }
    expect(pdf).toContain('0 0 m h f');
  });

  it('writes an opaque image without a soft mask', () => {
    const pdf = Buffer.from(
      pdfDocument([
        {
          ...{ width: 1, height: 1, content: '' },
          resources: {
            extGStates: {},
            shadings: {},
            images: { I: { width: 1, height: 1, rgb: Uint8Array.of(1, 2, 3) } },
          },
        },
      ]),
    ).toString('latin1');
    expect(pdf).toContain('/ColorSpace /DeviceRGB');
    expect(pdf).not.toContain('/SMask');
  });
  // A hard step at a padded end keeps its outer colour past the end.
  it('extends a padded shading past an end step in the outer stop’s colour', () => {
    const blue: Rgba = [0, 0, 1, 1];
    const linear = {
      ...radial(1, 2, 'repeat'),
      kind: 'linear',
      x0: 0,
      y0: 0,
      x1: 4,
      y1: 0,
      extend: 'pad',
    };
    const stepped = shadingOf({
      gradient: linear as never,
      stops: [
        { offset: 0, rgba: RED },
        { offset: 0, rgba: blue },
        { offset: 1, rgba: blue },
        { offset: 1, rgba: RED },
      ],
    });
    expect(stepped).toContain('/Coords [-4 0 8 0] /Domain [-1 2]');
    expect(stepped).toMatch(/\/Bounds \[0 1\]/);
    expect(stepped).toContain('/C0 [1 0 0] /C1 [1 0 0]');
    const tip = shadingOf({
      gradient: { ...radial(0, 2, 'repeat'), extend: 'pad' },
      stops: [
        { offset: 0, rgba: RED },
        { offset: 0, rgba: blue },
        { offset: 1, rgba: blue },
      ],
    });
    expect(tip).toContain('/Domain [0 1]');
    expect(
      shadingOf({ gradient: { ...radial(1, 2, 'repeat'), extend: 'pad' }, stops: [] }),
    ).toContain('/Domain [0 1]');
  });
});

describe('pdfDocument forms', () => {
  it('draws a form in its own box when it carries one, else the default box', () => {
    const resources = {
      extGStates: {},
      shadings: {},
      images: {},
      forms: { Own: { content: 'q\nQ\n', bbox: [0, 0, 20, 10] as const }, Default: 'q\nQ\n' },
    };
    const pdf = new TextDecoder('latin1').decode(
      pdfDocument([{ width: 20, height: 10, content: '/Own Do\n/Default Do\n', resources }]),
    );
    expect(pdf).toContain('/BBox [0 0 20 10]');
    expect(pdf).toContain('/BBox [-1000000 -1000000 1000000 1000000]');
  });
});

describe('pdfDocument tiling patterns', () => {
  it('writes a pattern with its cell, steps and matrix, sharing the page resources', () => {
    const pattern = {
      content: 'q\n0 0 2 1 re\nf\nQ\n',
      bbox: [0, 0, 2, 1] as const,
      xStep: 2,
      yStep: 1,
      matrix: { a: 1, b: 0, c: 0, d: -1, e: 0, f: 10 },
    };
    const pdf = new TextDecoder('latin1').decode(
      pdfDocument([
        {
          width: 20,
          height: 10,
          content: '/Pattern cs /P1 scn\n0 0 20 10 re\nf\n',
          resources: { extGStates: {}, shadings: {}, images: {}, patterns: { P1: pattern } },
        },
      ]),
    );
    expect(pdf).toMatch(/\/Pattern << \/P1 (\d+) 0 R >>/);
    expect(pdf).toContain(
      '<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 2 1] /XStep 2 /YStep 1 /Matrix [1 0 0 -1 0 10] /Resources',
    );
    expect(pdf).toContain('stream\nq\n0 0 2 1 re\nf\nQ\n\nendstream');
  });
});
