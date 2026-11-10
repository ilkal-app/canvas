/// <reference types="node" />
import { describe, expect, it } from 'vitest';

import { pdfDocument } from './pdf-document.js';
import type { PdfImage } from './text-pdf.js';

// Pillow 10.3.0: 2 x 1 pixels, Image.new('L') or Image.new('RGB'), saved as
// baseline JPEG with quality=80, subsampling=0, optimize=True. SOF carries 1 or 3 components.
const GRAY = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/wAALCAABAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABsQAAAHAQAAAAAAAAAAAAAAAAACBAYHN3Wz/9oACAEBAAA/AH+J6sZuKi4EH//Z',
  'base64',
);
const RGB = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABsQAAAHAQAAAAAAAAAAAAAAAAABAgQFNHOx/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgf/xAAcEQAABwEBAAAAAAAAAAAAAAAAAQIENXOyBQb/2gAMAwEAAhEDEQA/AAOQvudVdMXnzsS0rRkgO7JubF6Mf//Z',
  'base64',
);

/**
 * Numbered PDF objects, including binary stream bodies, indexed by object number.
 *
 * @param pdf - The PDF in Latin-1.
 * @returns Objects by number.
 */
function objectsOf(pdf: string): Map<number, { offset: number; body: string }> {
  const objects = new Map<number, { offset: number; body: string }>();
  for (const match of pdf.matchAll(/(?:^|\n)(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) {
    objects.set(Number(match[1]), {
      offset: match.index + (match[0].startsWith('\n') ? 1 : 0),
      body: match[2] ?? '',
    });
  }
  return objects;
}

/**
 * The exact xref offsets required for every object in the minimal PDF.
 *
 * @param pdf - The PDF in Latin-1.
 * @param objects - Its numbered objects.
 */
function expectExactXref(
  pdf: string,
  objects: Map<number, { offset: number; body: string }>,
): void {
  const start = /startxref\n(\d+)\n%%EOF\n$/.exec(pdf);
  expect(start).not.toBeNull();
  const xrefAt = Number(start?.[1]);
  const xref = pdf.slice(xrefAt);
  expect(xref).toMatch(/^xref\n0 6\n/);
  const rows = /^xref\n0 6\n([^]*?)trailer\n/.exec(xref)?.[1]?.trimEnd().split('\n') ?? [];
  expect(rows).toHaveLength(6);
  expect(rows[0]).toMatch(/^0000000000 65535 f/);
  for (let number = 1; number <= 5; number += 1) {
    expect(Number(rows[number]?.slice(0, 10))).toBe(objects.get(number)?.offset);
    expect(pdf.slice(objects.get(number)?.offset)).toMatch(
      new RegExp(`^${String(number)} 0 obj\\b`),
    );
  }
}

describe('pdfDocument direct JPEG resources', () => {
  it.each([
    ['gray', GRAY, 'DeviceGray'],
    ['rgb', RGB, 'DeviceRGB'],
  ] as const)(
    'reads the %s baseline SOF and writes the original DCT stream',
    (name, jpeg, colorSpace) => {
      expect(name).toMatch(/gray|rgb/);
      // The new resource kind owns SOF parsing. Its public shape is deliberately only original bytes.
      const image = { kind: 'jpeg', bytes: jpeg } as unknown as PdfImage;
      const bytes = pdfDocument([
        {
          width: 20,
          height: 10,
          content: 'q\n20 0 0 10 0 0 cm\n/J Do\nQ\n',
          resources: { extGStates: {}, shadings: {}, images: { J: image } },
        },
      ]);
      const pdf = Buffer.from(bytes).toString('latin1');
      const objects = objectsOf(pdf);
      expect([...objects.keys()]).toEqual([1, 2, 3, 4, 5]);
      expect(objects.get(1)?.body).toContain('/Type /Catalog /Pages 2 0 R');
      expect(objects.get(2)?.body).toContain('/Type /Pages /Kids [3 0 R] /Count 1');
      expect(objects.get(3)?.body).toMatch(
        /\/Type \/Page\b[^]*\/XObject << \/J 4 0 R >>[^]*\/Contents 5 0 R/,
      );
      const imageBody = objects.get(4)?.body ?? '';
      expect(imageBody).toMatch(
        new RegExp(
          `/Subtype /Image[^>]*?/Width 2 /Height 1[^>]*?/BitsPerComponent 8[^>]*?/ColorSpace /${colorSpace}[^>]*?/Filter /DCTDecode`,
        ),
      );
      expect(imageBody).toContain(`/Length ${String(jpeg.length)} >>\nstream\n`);
      expect(
        imageBody.slice(imageBody.indexOf('stream\n') + 7, imageBody.lastIndexOf('\nendstream')),
      ).toBe(jpeg.toString('latin1'));
      expect(objects.get(5)?.body).toContain('20 0 0 10 0 0 cm');
      expectExactXref(pdf, objects);
      expect(
        pdfDocument([
          {
            width: 20,
            height: 10,
            content: 'q\n20 0 0 10 0 0 cm\n/J Do\nQ\n',
            resources: { extGStates: {}, shadings: {}, images: { J: image } },
          },
        ]),
      ).toEqual(bytes);
    },
  );
});
