// Validate the minimal PDF file by byte positions and indirect references.
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  pdfDocument,
  textPdf,
  type PdfResources,
  type TextLayout,
  type VectorGlyph,
} from '../index.js';

/**
 * A PDF as Latin-1, preserving one character per byte for xref and stream positions.
 *
 * @param bytes - PDF bytes.
 * @returns One character per byte.
 */
function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/**
 * Parses each numbered indirect object at its exact byte offset.
 *
 * @param pdf - Latin-1 PDF text.
 * @returns Objects by number.
 */
function objectsOf(pdf: string): Map<number, { offset: number; body: string }> {
  const objects = new Map<number, { offset: number; body: string }>();
  for (const match of pdf.matchAll(/(?:^|\n)(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)) {
    const number = Number(match[1]);
    const offset = match.index + (match[0].startsWith('\n') ? 1 : 0);
    objects.set(number, { offset, body: match[2] ?? '' });
  }
  return objects;
}

/**
 * The object number referenced by a named resource in a PDF dictionary.
 *
 * @param body - Dictionary text.
 * @param name - Resource name.
 * @returns Referenced object number.
 * @throws {Error} When absent.
 */
function referenceOf(body: string, name: string): number {
  const match = new RegExp(`/${name}\\s+(\\d+) 0 R`).exec(body);
  if (match === null) throw new Error(`missing /${name} resource`);
  return Number(match[1]);
}

/**
 * Every stream's declared byte length must end exactly before endstream.
 *
 * @param objects - Parsed indirect objects.
 */
function expectStreamLengths(objects: Map<number, { offset: number; body: string }>): void {
  for (const { body } of objects.values()) {
    const marker = /\r?\nstream\r?\n/.exec(body);
    if (marker === null) continue;
    const length = /\/Length\s+(\d+)\b/.exec(body);
    expect(length, 'a stream must have a direct /Length').not.toBeNull();
    const start = marker.index + marker[0].length;
    const end = start + Number(length?.[1]);
    expect(body.slice(end)).toMatch(/^\r?\nendstream(?:\s|$)/);
    expect(body.slice(start, end)).toHaveLength(Number(length?.[1]));
  }
}

/**
 * A PNG chunk with a real CRC, to exercise supported filters and unsupported formats.
 *
 * @param type - Four-letter chunk kind.
 * @param data - Chunk payload.
 * @returns Length, type, payload and CRC.
 */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

/**
 * An 8-bit PNG with caller-supplied filtered scanlines.
 *
 * @param width - Pixel columns.
 * @param height - Pixel rows.
 * @param colourType - PNG colour type.
 * @param rows - Filter bytes and encoded samples.
 * @param interlace - PNG interlace method.
 * @returns A complete PNG.
 */
function pngOf(
  width: number,
  height: number,
  colourType: number,
  rows: readonly number[],
  interlace = 0,
): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colourType;
  header[12] = interlace;
  const palette = colourType === 3 ? [pngChunk('PLTE', Uint8Array.from([1, 2, 3]))] : [];
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    ...palette,
    pngChunk('IDAT', deflateSync(Uint8Array.from(rows))),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

/**
 * Sends a PNG bitmap through the public text writer.
 *
 * @param png - Valid PNG bytes.
 * @param width - Pixel columns.
 * @param height - Pixel rows.
 * @returns The PDF fragment.
 */
function pngText(png: Uint8Array, width: number, height: number): ReturnType<typeof textPdf> {
  const layout: TextLayout = { text: '', runs: [], glyphs: [], lines: [], width: 0, height: 0 };
  const vector: VectorGlyph = {
    kind: 'image',
    glyphId: 1,
    faceId: 'test',
    cluster: { start: 0, end: 0 },
    d: '',
    pdf: '',
    fill: 'ink',
    image: { png, pixelWidth: width, pixelHeight: height, x: 0, y: 0, width, height },
  };
  return textPdf(layout, [vector], { namePrefix: 'Png', colorOf: () => [0, 0, 0, 1] });
}

const FIRST_RESOURCES: PdfResources = {
  extGStates: { T1Gs1: '<< /ca 0.5 /BM /Multiply >>' },
  shadings: {
    T1Sh1:
      '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 10 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> /Extend [true true] >>',
  },
  images: {
    T1Im1: {
      width: 2,
      height: 1,
      rgb: Uint8Array.from([10, 20, 30, 40, 50, 60]),
      alpha: Uint8Array.from([128, 255]),
    },
  },
};
const SECOND_RESOURCES: PdfResources = {
  extGStates: { T2Gs1: '<< /ca 0.25 >>' },
  shadings: {},
  images: {},
};
const PAGES = [
  {
    width: 100,
    height: 80,
    content: 'q\n/T1Gs1 gs\n/T1Sh1 sh\n/T1Im1 Do\nQ\n',
    resources: FIRST_RESOURCES,
  },
  { width: 200, height: 120, content: 'q\n/T2Gs1 gs\nQ\n', resources: SECOND_RESOURCES },
];

describe('pdfDocument', () => {
  it('writes deterministic PDF 1.7 with a binary marker, page tree and media boxes', () => {
    const first = pdfDocument(PAGES);
    expect(pdfDocument(PAGES)).toEqual(first);
    const pdf = latin1(first);
    expect(pdf).toMatch(/^%PDF-1\.7\r?\n%[^\r\n]*[\x80-\xff]/);
    const objects = objectsOf(pdf);
    const catalog = [...objects.values()].find(({ body }) => /\/Type \/Catalog\b/.test(body));
    const pagesTree = [...objects.values()].find(({ body }) => /\/Type \/Pages\b/.test(body));
    const pages = [...objects.values()].filter(({ body }) => /\/Type \/Page\b/.test(body));
    expect(catalog?.body).toMatch(/\/Pages \d+ 0 R/);
    expect(pagesTree?.body).toMatch(/\/Count 2\b/);
    expect(pagesTree?.body).toMatch(/\/Kids\s*\[\s*\d+ 0 R\s+\d+ 0 R\s*\]/);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.body).toMatch(/\/MediaBox\s*\[0 0 100 80\]/);
    expect(pages[1]?.body).toMatch(/\/MediaBox\s*\[0 0 200 120\]/);
    expect(
      pages.every(({ body }) => /\/Parent \d+ 0 R/.test(body) && /\/Contents \d+ 0 R/.test(body)),
    ).toBe(true);
  });

  it('points every xref entry and startxref to the exact byte offset', () => {
    const pdf = latin1(pdfDocument(PAGES));
    const objects = objectsOf(pdf);
    const start = /startxref\r?\n(\d+)\r?\n%%EOF\s*$/.exec(pdf);
    expect(start).not.toBeNull();
    const xrefAt = Number(start?.[1]);
    expect(pdf.slice(xrefAt)).toMatch(/^xref\r?\n/);
    const section = /^xref\r?\n0 (\d+)\r?\n([\s\S]*?)trailer\b/.exec(pdf.slice(xrefAt));
    expect(section).not.toBeNull();
    const count = Number(section?.[1]);
    const rows = (section?.[2] ?? '').trimEnd().split(/\r?\n/);
    expect(rows).toHaveLength(count);
    expect(rows[0]).toMatch(/^0{10} 65535 f/);
    expect(objects.size).toBe(count - 1);
    for (let number = 1; number < count; number += 1) {
      const row = /^(\d{10}) 00000 n/.exec(rows[number] ?? '');
      expect(row, `xref entry ${String(number)}`).not.toBeNull();
      const offset = Number(row?.[1]);
      expect(offset).toBe(objects.get(number)?.offset);
      expect(pdf.slice(offset)).toMatch(new RegExp(`^${String(number)} 0 obj\\b`));
    }
    const trailer = pdf.slice(xrefAt + (section?.[0].length ?? 0));
    expect(trailer).toMatch(new RegExp(`/Size\\s+${String(count)}\\b`));
    expect(trailer).toMatch(/\/Root \d+ 0 R/);
  });

  it('measures content and image streams in bytes and resolves every named resource', () => {
    const pdf = latin1(pdfDocument(PAGES));
    const objects = objectsOf(pdf);
    expectStreamLengths(objects);
    const pages = [...objects.values()].filter(({ body }) => /\/Type \/Page\b/.test(body));
    const first = pages[0]?.body ?? '';
    const second = pages[1]?.body ?? '';
    for (const [body, names] of [
      [first, ['T1Gs1', 'T1Sh1', 'T1Im1']],
      [second, ['T2Gs1']],
    ] as const) {
      expect(body).toMatch(/\/Resources\s*<</);
      for (const name of names) expect(objects.has(referenceOf(body, name))).toBe(true);
    }
    expect(objects.get(referenceOf(first, 'T1Gs1'))?.body).toContain('/BM /Multiply');
    expect(objects.get(referenceOf(first, 'T1Sh1'))?.body).toContain('/ShadingType 2');
    const image = objects.get(referenceOf(first, 'T1Im1'))?.body ?? '';
    expect(image).toMatch(/\/Subtype \/Image\b/);
    expect(image).toMatch(/\/Width 2\b[\s\S]*\/Height 1\b/);
    expect(image).toContain('/ColorSpace /DeviceRGB');
    expect(image).toContain('/BitsPerComponent 8');
    const alpha = objects.get(referenceOf(image, 'SMask'))?.body ?? '';
    expect(alpha).toMatch(/\/Subtype \/Image\b/);
    expect(alpha).toContain('/ColorSpace /DeviceGray');
    expect(alpha).toContain('/BitsPerComponent 8');
    // PdfImage is decoded samples or a JPEG; this one is decoded samples.
    const bitmap = FIRST_RESOURCES.images.T1Im1;
    if (bitmap === undefined || 'kind' in bitmap) throw new Error('T1Im1 is not a bitmap');
    expect(pdf).toContain(latin1(bitmap.rgb));
    expect(pdf).toContain(latin1(bitmap.alpha ?? new Uint8Array()));
  });
});

describe('PNG bitmap resources', () => {
  it('decodes 8-bit RGB PNG Sub-filtered samples', async () => {
    const result = await pngText(pngOf(2, 1, 2, [1, 10, 20, 30, 30, 30, 30]), 2, 1);
    expect([...(Object.values(result.resources.images)[0]?.rgb ?? [])]).toEqual([
      10, 20, 30, 40, 50, 60,
    ]);
    expect(Object.values(result.resources.images)[0]?.alpha).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('decodes 8-bit RGBA PNG Up-filtered rows and their alpha', async () => {
    const result = await pngText(pngOf(1, 2, 6, [0, 10, 20, 30, 128, 2, 30, 30, 30, 127]), 1, 2);
    expect([...(Object.values(result.resources.images)[0]?.rgb ?? [])]).toEqual([
      10, 20, 30, 40, 50, 60,
    ]);
    expect([...(Object.values(result.resources.images)[0]?.alpha ?? [])]).toEqual([128, 255]);
  });

  it('undoes the Average and Paeth PNG filters', async () => {
    const png = pngOf(1, 3, 2, [0, 10, 20, 30, 3, 35, 40, 45, 4, 30, 30, 30]);
    const result = await pngText(png, 1, 3);
    expect([...(Object.values(result.resources.images)[0]?.rgb ?? [])]).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90,
    ]);
  });

  it('omits a valid palette PNG with a warning', async () => {
    const result = await pngText(pngOf(1, 1, 3, [0, 0]), 1, 1);
    expect(Object.keys(result.resources.images)).toHaveLength(0);
    expect(result.content).not.toMatch(/\/PngIm\d+ Do/);
    expect(result.warnings.some((warning) => /png/i.test(warning))).toBe(true);
  });

  it('omits an interlaced PNG with a warning', async () => {
    const result = await pngText(pngOf(1, 1, 6, [0, 1, 2, 3, 255], 1), 1, 1);
    expect(Object.keys(result.resources.images)).toHaveLength(0);
    expect(result.warnings.some((warning) => /png/i.test(warning))).toBe(true);
  });
});
