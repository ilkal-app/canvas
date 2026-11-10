import { describe, expect, it } from 'vitest';

import { jpegInfo } from './jpeg-info.js';
import { pdfDocument } from './pdf-document.js';

/**
 * A marker segment: FF, the marker, a length covering itself and the body, the body.
 *
 * @param marker - The marker byte.
 * @param body - Its body.
 * @returns The segment's bytes.
 */
function segment(marker: number, body: readonly number[]): number[] {
  const length = body.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...body];
}

/**
 * A baseline frame header body: 8-bit samples, a height, a width and some components.
 *
 * @param width - The width.
 * @param height - The height.
 * @param components - The component count.
 * @returns The body.
 */
function frame(width: number, height: number, components: number): number[] {
  const descriptors = Array.from({ length: components }, (unused, index) => [index + 1, 0x11, 0]);
  return [
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    components,
    ...descriptors.flat(),
  ];
}

const SOI = [0xff, 0xd8];
const ADOBE = segment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 2]);

describe('jpegInfo', () => {
  it('reads a frame after other segments, with an Adobe marker for CMYK', () => {
    const jpeg = Uint8Array.from([
      ...SOI,
      ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
      ...ADOBE,
      ...segment(0xc2, frame(640, 480, 4)),
    ]);
    expect(jpegInfo(jpeg)).toEqual({ width: 640, height: 480, components: 4, isAdobe: true });
    expect(jpegInfo(Uint8Array.from([...SOI, ...segment(0xc0, frame(3, 2, 1))]))).toEqual({
      width: 3,
      height: 2,
      components: 1,
      isAdobe: false,
    });
  });

  it('skips fill bytes before a marker and the markers that carry no length', () => {
    const padded = Uint8Array.from([
      ...SOI,
      0xff,
      0xff,
      ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
      0xff,
      0xd0,
      0xff,
      0x01,
      0xff,
      ...segment(0xc0, frame(5, 4, 3)),
    ]);
    expect(jpegInfo(padded)).toEqual({ width: 5, height: 4, components: 3, isAdobe: false });
  });

  it('describes only whole 8-bit frames', () => {
    const twelveBit = [12, ...frame(3, 2, 1).slice(1)];
    expect(jpegInfo(Uint8Array.from([...SOI, ...segment(0xc1, twelveBit)]))).toBeUndefined();
    // A frame without its component descriptors.
    const bare = [8, 0, 2, 0, 3, 3];
    expect(jpegInfo(Uint8Array.from([...SOI, ...segment(0xc0, bare)]))).toBeUndefined();
    // A frame segment shorter than a frame header, and one running past the file.
    expect(jpegInfo(Uint8Array.from([...SOI, ...segment(0xc0, [8, 0, 2, 0])]))).toBeUndefined();
    expect(
      jpegInfo(Uint8Array.from([...SOI, 0xff, 0xc0, 0, 40, ...frame(3, 2, 1)])),
    ).toBeUndefined();
    expect(jpegInfo(Uint8Array.from([...SOI, 0xff, 0xe0, 0, 1]))).toBeUndefined();
    expect(jpegInfo(Uint8Array.from([...SOI, 0xff, 0xff]))).toBeUndefined();
    expect(jpegInfo(Uint8Array.from([...SOI, 0xff, 0xe0, 0]))).toBeUndefined();
  });

  it('reads nothing from bytes that are not a JPEG frame it can describe', () => {
    expect(jpegInfo(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    expect(jpegInfo(Uint8Array.from([...SOI, 0x00, 0xc0, 0, 8]))).toBeUndefined();
    expect(jpegInfo(Uint8Array.from([...SOI, ...segment(0xc0, frame(3, 2, 2))]))).toBeUndefined();
    expect(jpegInfo(Uint8Array.from([...SOI, 0xff, 0xc0, 0, 8, 8]))).toBeUndefined();
    expect(jpegInfo(Uint8Array.from([...SOI, ...segment(0xe0, [1, 2])]))).toBeUndefined();
  });
});

describe('pdfDocument JPEG images', () => {
  it('decodes Adobe CMYK back and refuses bytes with no frame', () => {
    const page = (bytes: Uint8Array) => ({
      width: 1,
      height: 1,
      content: '',
      resources: { extGStates: {}, shadings: {}, images: { J: { kind: 'jpeg' as const, bytes } } },
    });
    const cmyk = Uint8Array.from([...SOI, ...ADOBE, ...segment(0xc0, frame(1, 1, 4))]);
    const pdf = new TextDecoder('latin1').decode(pdfDocument([page(cmyk)]));
    expect(pdf).toContain('/ColorSpace /DeviceCMYK /Filter /DCTDecode /Decode [1 0 1 0 1 0 1 0]');
    expect(() => pdfDocument([page(Uint8Array.from([1, 2, 3]))])).toThrow(RangeError);
  });
});
