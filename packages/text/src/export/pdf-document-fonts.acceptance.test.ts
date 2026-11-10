// Embedded and standard fonts form valid, byte-exact PDF object chains.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { pdfDocument, type PdfFont, type PdfResources } from '../index.js';

/**
 * Reads a checked-in font as bytes to embed without modifying it.
 *
 * @param file - Name within the format corpus.
 * @returns The font's bytes.
 */
function fontBytes(file: string): Uint8Array {
  return readFileSync(new URL(`../__fixtures__/format-corpus/${file}`, import.meta.url));
}

/**
 * Treats each PDF byte as one character so offsets remain byte offsets.
 *
 * @param bytes - PDF bytes.
 * @returns Latin-1 PDF text.
 */
function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/**
 * Extracts exact object offsets from the xref and verifies every pointed-to header.
 *
 * @param pdf - PDF bytes decoded as Latin-1.
 * @returns Object bodies keyed by number.
 */
function objectsOf(pdf: string): Map<number, string> {
  const start = /startxref\n(\d+)\n%%EOF\n$/.exec(pdf);
  expect(start).not.toBeNull();
  const xrefAt = Number(start?.[1]);
  expect(pdf.slice(xrefAt)).toMatch(/^xref\n/);
  const table = /^xref\n0 (\d+)\n([\s\S]*?)trailer\n/.exec(pdf.slice(xrefAt));
  expect(table).not.toBeNull();
  const count = Number(table?.[1]);
  const rows = (table?.[2] ?? '').trimEnd().split('\n');
  expect(rows).toHaveLength(count);
  expect(rows[0]).toMatch(/^0000000000 65535 f/);
  const offsets = rows.slice(1).map((row) => {
    expect(row).toMatch(/^\d{10} 00000 n/);
    return Number(row.slice(0, 10));
  });
  const objects = new Map<number, string>();
  offsets.forEach((offset, index) => {
    const number = index + 1;
    const whole = pdf.slice(offset, offsets[index + 1] ?? xrefAt);
    expect(whole).toMatch(new RegExp(`^${String(number)} 0 obj\\n`));
    expect(whole).toMatch(/\nendobj\n$/);
    objects.set(number, whole);
  });
  return objects;
}

/**
 * Follows an indirect reference in one object.
 *
 * @param objects - All resolved objects.
 * @param body - Referring object.
 * @param key - PDF dictionary key.
 * @returns The referenced object's body.
 */
function ref(objects: Map<number, string>, body: string, key: string): string {
  const number = new RegExp(`/${key}\\s+\\[?\\s*(\\d+) 0 R`).exec(body)?.[1];
  expect(number, `missing /${key} reference`).toBeDefined();
  const target = objects.get(Number(number));
  expect(target, `dangling /${key} reference`).toBeDefined();
  return target ?? '';
}

/**
 * Checks an uncompressed stream's actual bytes and declared lengths.
 *
 * @param object - Object containing a stream.
 * @returns Its exact stream data.
 */
function streamOf(object: string): string {
  const marker = /\nstream\n/.exec(object);
  expect(marker).not.toBeNull();
  const length = Number(/\/Length\s+(\d+)/.exec(object)?.[1]);
  expect(Number.isInteger(length)).toBe(true);
  const start = (marker?.index ?? 0) + (marker?.[0].length ?? 0);
  const data = object.slice(start, start + length);
  expect(data).toHaveLength(length);
  expect(object.slice(start + length)).toMatch(/^\nendstream\nendobj\n$/);
  return data;
}

const TRUE_TYPE = fontBytes('corpus-serif-regular.ttf');
const OPEN_TYPE = fontBytes('corpus-serif-regular.cff.otf');
const FONTS: Record<string, PdfFont> = {
  PageF1: {
    kind: 'embedded',
    format: 'truetype',
    bytes: TRUE_TYPE,
    baseFont: 'ABCDEF+Lora',
    unitsPerEm: 1000,
    ascent: 800,
    descent: 200,
    widths: [
      [7, 510],
      [42, 630],
    ],
    toUnicode: [
      [7, 'A'],
      [42, 'ffi'],
    ],
  },
  PageF2: {
    kind: 'embedded',
    format: 'opentype',
    bytes: OPEN_TYPE,
    baseFont: 'GHIJKL+LoraCFF',
    unitsPerEm: 1000,
    ascent: 800,
    descent: 200,
    widths: [[11, 550]],
    toUnicode: [[11, 'é']],
  },
  PageF3: { kind: 'standard', baseFont: 'Helvetica' },
};
const RESOURCES: PdfResources = { extGStates: {}, shadings: {}, images: {}, fonts: FONTS };
const PAGE = {
  width: 240,
  height: 120,
  content: 'q\nBT\n3 Tr\n/PageF1 18 Tf\n<002A> Tj\nET\nQ\n',
  resources: RESOURCES,
};

describe('pdfDocument font resources', () => {
  it('resolves the page Font dictionary and the full TrueType Type0 object chain', () => {
    const pdf = latin1(pdfDocument([PAGE]));
    const objects = objectsOf(pdf);
    const page = [...objects.values()].find((body) => /\/Type \/Page\b/.test(body)) ?? '';
    expect(page).toMatch(/\/Resources\s*<<[\s\S]*\/Font\s*<</);
    const type0 = ref(objects, page, 'PageF1');
    expect(type0).toMatch(/\/Type \/Font\b[\s\S]*\/Subtype \/Type0\b/);
    expect(type0).toContain('/Encoding /Identity-H');
    expect(type0).toContain('/BaseFont /ABCDEF+Lora');
    const descendant = ref(objects, type0, 'DescendantFonts');
    expect(descendant).toContain('/Subtype /CIDFontType2');
    expect(descendant).toMatch(
      /\/CIDSystemInfo\s*<<[\s\S]*\/Registry\s*\(Adobe\)[\s\S]*\/Ordering\s*\(Identity\)[\s\S]*\/Supplement\s+0/,
    );
    expect(descendant).toContain('/CIDToGIDMap /Identity');
    expect(descendant).toContain('/DW 1000');
    expect(descendant).toMatch(/\/W\s*\[[\s\S]*7\s*\[510\][\s\S]*42\s*\[630\]/);
    const descriptor = ref(objects, descendant, 'FontDescriptor');
    expect(descriptor).toContain('/FontName /ABCDEF+Lora');
    expect(descriptor).toMatch(/\/Flags 4\b/);
    expect(descriptor).toMatch(/\/FontBBox\s*\[[^\]]+\]/);
    expect(descriptor).toMatch(/\/ItalicAngle 0\b/);
    expect(descriptor).toMatch(/\/Ascent 800\b/);
    expect(descriptor).toMatch(/\/Descent -?200\b/);
    expect(descriptor).toMatch(/\/CapHeight\s+-?\d+/);
    expect(descriptor).toMatch(/\/StemV\s+\d+/);
    const file = ref(objects, descriptor, 'FontFile2');
    expect(file).toContain(`/Length1 ${String(TRUE_TYPE.length)}`);
    expect(streamOf(file)).toBe(latin1(TRUE_TYPE));
    const cmap = streamOf(ref(objects, type0, 'ToUnicode'));
    expect(cmap).toMatch(/begincmap[\s\S]*beginbfchar[\s\S]*endbfchar[\s\S]*endcmap/);
    expect(cmap).toMatch(/<0007>\s*<0041>/);
    expect(cmap).toMatch(/<002A>\s*<006600660069>/);
    for (const object of objects.values()) if (object.includes('\nstream\n')) streamOf(object);
  });

  it('writes CFF as CIDFontType0 with FontFile3 and a WinAnsi Helvetica resource', () => {
    const pdf = latin1(pdfDocument([PAGE]));
    const objects = objectsOf(pdf);
    const page = [...objects.values()].find((body) => /\/Type \/Page\b/.test(body)) ?? '';
    const type0 = ref(objects, page, 'PageF2');
    expect(type0).toContain('/Encoding /Identity-H');
    const descendant = ref(objects, type0, 'DescendantFonts');
    expect(descendant).toContain('/Subtype /CIDFontType0');
    const descriptor = ref(objects, descendant, 'FontDescriptor');
    const file = ref(objects, descriptor, 'FontFile3');
    expect(file).toContain('/Subtype /OpenType');
    expect(streamOf(file)).toBe(latin1(OPEN_TYPE));
    expect(streamOf(ref(objects, type0, 'ToUnicode'))).toMatch(/<000B>\s*<00E9>/);
    expect(ref(objects, page, 'PageF3')).toMatch(
      /\/Type \/Font\s+\/Subtype \/Type1\s+\/BaseFont \/Helvetica\s+\/Encoding \/WinAnsiEncoding/,
    );
    expect(pdfDocument([PAGE])).toEqual(pdfDocument([PAGE]));
  });

  it('does not add a Font resource to vector-only pages', () => {
    const pages = [{ ...PAGE, resources: { extGStates: {}, shadings: {}, images: {} } }];
    const objects = objectsOf(latin1(pdfDocument(pages)));
    const page = [...objects.values()].find((body) => /\/Type \/Page\b/.test(body)) ?? '';
    expect(page).not.toMatch(/\/Font\s*<</);
  });
});
