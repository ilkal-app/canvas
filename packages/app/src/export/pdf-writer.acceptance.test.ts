// Written before the export code. CONTRACT: a pure PDF 1.4 writer makes one
// ordered raster page per image with exact streams, dimensions, xref offsets and trailer.
// Deliberately not asserted: object numbering, compression ratio, or selectable text.
import { deflateSync, inflateSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

interface PdfImagePage {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly image: {
    readonly widthPx: number;
    readonly heightPx: number;
    readonly flateRgb: Uint8Array;
  };
}

const { writePdf } = await vi.importActual<{
  writePdf: (pages: readonly PdfImagePage[]) => Uint8Array;
}>('./pdf-writer.js');

function imagePage(widthPt: number, heightPt: number, rgb: readonly number[]): PdfImagePage {
  return {
    widthPt,
    heightPt,
    image: { widthPx: 1, heightPx: rgb.length / 3, flateRgb: deflateSync(Uint8Array.from(rgb)) },
  };
}

function objectsOf(pdf: string): Map<number, string> {
  const objects = new Map<number, string>();
  for (const match of pdf.matchAll(/(?:^|\n)(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)) {
    objects.set(Number(match[1]), match[2] ?? '');
  }
  return objects;
}

function referenceOf(object: string, key: string): number {
  const number = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(object)?.[1];
  if (number === undefined) throw new Error(`Missing ${key} reference`);
  return Number(number);
}

function streamOf(object: string): Uint8Array {
  const start = object.indexOf('stream\n');
  const end = object.lastIndexOf('\nendstream');
  if (start < 0 || end < 0) throw new Error('Missing stream');
  return Uint8Array.from(Buffer.from(object.slice(start + 7, end), 'latin1'));
}

describe('writePdf', () => {
  it('writes ordered RGB image pages, exact streams, and a navigable PDF 1.4 xref', () => {
    const rgbs = [
      [255, 0, 0, 0, 255, 0],
      [0, 0, 255],
    ];
    const pages = [imagePage(225.506, 150.2, rgbs[0] ?? []), imagePage(150, 112.5, rgbs[1] ?? [])];
    const before = pages.map((page) => [...page.image.flateRgb]);
    const bytes = writePdf(pages);
    const pdf = Buffer.from(bytes).toString('latin1');
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.endsWith('%%EOF')).toBe(true);
    expect(pages.map((page) => [...page.image.flateRgb])).toEqual(before);

    const objects = objectsOf(pdf);
    const catalogs = [...objects].filter(([, body]) => /\/Type\s+\/Catalog\b/.test(body));
    const trees = [...objects].filter(([, body]) => /\/Type\s+\/Pages\b/.test(body));
    const leafPages = [...objects].filter(([, body]) => /\/Type\s+\/Page\b/.test(body));
    expect(catalogs).toHaveLength(1);
    expect(trees).toHaveLength(1);
    expect(leafPages).toHaveLength(pages.length);
    const [catalogId, catalog] = catalogs[0] ?? [];
    const [treeId, tree] = trees[0] ?? [];
    expect(referenceOf(catalog ?? '', 'Pages')).toBe(treeId);
    expect(tree).toMatch(/\/Count\s+2\b/);
    const kids = /\/Kids\s*\[([^\]]+)\]/.exec(tree ?? '')?.[1];
    const pageIds = [...(kids ?? '').matchAll(/(\d+) 0 R/g)].map((match) => Number(match[1]));
    expect(pageIds).toHaveLength(pages.length);
    for (const [index, pageId] of pageIds.entries()) {
      const source = pages[index];
      const page = objects.get(pageId);
      if (source === undefined || page === undefined) throw new Error('Missing page');
      expect(referenceOf(page, 'Parent')).toBe(treeId);
      const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([^\s\]]+)\s+([^\s\]]+)\s*\]/.exec(page);
      const width = String(Number(source.widthPt.toFixed(2)));
      const height = String(Number(source.heightPt.toFixed(2)));
      expect(mediaBox?.slice(1)).toEqual([width, height]);
      expect(page).toMatch(/\/Contents\s+\d+ 0 R/);
      const imageId = /\/Im0\s+(\d+) 0 R/.exec(page)?.[1];
      const image = objects.get(Number(imageId));
      if (image === undefined) throw new Error('Missing image');
      expect(image).toMatch(/\/Subtype\s+\/Image\b/);
      expect(image).toMatch(new RegExp(`/Width\\s+${String(source.image.widthPx)}\\b`));
      expect(image).toMatch(new RegExp(`/Height\\s+${String(source.image.heightPx)}\\b`));
      expect(image).toMatch(/\/ColorSpace\s+\/DeviceRGB\b/);
      expect(image).toMatch(/\/BitsPerComponent\s+8\b/);
      expect(image).toMatch(/\/Filter\s+\/FlateDecode\b/);
      const compressed = streamOf(image);
      expect(Number(/\/Length\s+(\d+)/.exec(image)?.[1])).toBe(compressed.length);
      expect([...compressed]).toEqual([...source.image.flateRgb]);
      expect([...inflateSync(compressed)]).toEqual(rgbs[index] ?? []);
      const content = objects.get(referenceOf(page, 'Contents'));
      if (content === undefined) throw new Error('Missing content');
      const drawing = Buffer.from(streamOf(content)).toString('latin1');
      expect(Number(/\/Length\s+(\d+)/.exec(content)?.[1])).toBe(streamOf(content).length);
      expect(drawing).toMatch(new RegExp(`${width} 0 0 ${height} 0 0 cm\\s*/Im0 Do`));
    }

    const start = /startxref\s+(\d+)\s+%%EOF$/.exec(pdf);
    expect(start).not.toBeNull();
    const xrefOffset = Number(start?.[1]);
    expect(pdf.slice(xrefOffset, xrefOffset + 4)).toBe('xref');
    const xref = /^xref\s+0\s+(\d+)\s*\n([\s\S]*?)trailer/.exec(pdf.slice(xrefOffset));
    const size = Number(xref?.[1]);
    const entries = (xref?.[2] ?? '').trim().split(/\r?\n/);
    expect(size).toBe(Math.max(...objects.keys()) + 1);
    expect(entries).toHaveLength(size);
    for (const [id] of objects) {
      const entry = entries[id];
      expect(entry).toMatch(/^\d{10} \d{5} n\s*$/);
      expect(pdf.slice(Number(entry?.slice(0, 10)))).toMatch(new RegExp(`^${String(id)} 0 obj\\b`));
    }
    const trailer = pdf.slice(xrefOffset).split('trailer')[1] ?? '';
    expect(trailer).toMatch(new RegExp(`/Size\\s+${String(size)}\\b`));
    expect(trailer).toMatch(new RegExp(`/Root\\s+${String(catalogId)} 0 R`));
  });

  it('rejects an empty document', () => {
    expect(() => writePdf([])).toThrow(RangeError);
  });
});
