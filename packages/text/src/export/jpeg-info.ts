// What a PDF needs to embed a JPEG as it is: its size and colour components, read from
// its start-of-frame marker, and whether an Adobe marker says its CMYK is stored inverted. Pure.

/** A JPEG's frame, as a PDF image dictionary describes it. */
export interface JpegInfo {
  /** Its width in pixels. */
  readonly width: number;
  /** Its height in pixels. */
  readonly height: number;
  /** Its colour components: 1 gray, 3 RGB (YCbCr), 4 CMYK. */
  readonly components: 1 | 3 | 4;
  /** Whether an Adobe APP14 marker is present, so CMYK samples are stored inverted. */
  readonly isAdobe: boolean;
}

/** The start-of-frame markers: every SOFn but DHT (C4), JPG (C8) and DAC (CC). */
const FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/** Markers with no length or body: TEM and the restart markers RST0–RST7. */
const STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);

/** A frame header's least length: precision, height, width and component count, with the length. */
const MIN_FRAME_LENGTH = 8;

/**
 * A JPEG's frame: walks its marker segments from the start of image to the first start of
 * frame, skipping the fill bytes (`FF`) a marker may be padded with and the markers that carry no
 * length, and noting an Adobe APP14 segment on the way. Only 8-bit frames are described, as a PDF
 * image says 8 bits a component.
 *
 * @param bytes - The JPEG file.
 * @returns Its frame, or `undefined` for bytes that are not a whole 8-bit JPEG frame with 1, 3 or
 *   4 components.
 */
export function jpegInfo(bytes: Uint8Array): JpegInfo | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let isAdobe = false;
  let at = 2;
  while (at + 1 < bytes.length) {
    if (view.getUint8(at) !== 0xff) return undefined;
    // Fill bytes: any number of FF before the marker itself.
    while (at + 1 < bytes.length && view.getUint8(at + 1) === 0xff) at += 1;
    if (at + 1 >= bytes.length) return undefined;
    const marker = view.getUint8(at + 1);
    if (STANDALONE_MARKERS.has(marker)) {
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) return undefined;
    const length = view.getUint16(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return undefined;
    if (FRAME_MARKERS.has(marker)) {
      if (length < MIN_FRAME_LENGTH || view.getUint8(at + 4) !== 8) return undefined;
      const height = view.getUint16(at + 5);
      const width = view.getUint16(at + 7);
      const components = view.getUint8(at + 9);
      if (components !== 1 && components !== 3 && components !== 4) return undefined;
      // Each component has a 3-byte descriptor the frame must hold.
      if (length < MIN_FRAME_LENGTH + 3 * components) return undefined;
      return { width, height, components, isAdobe };
    }
    const tag = String.fromCharCode(...bytes.subarray(at + 4, Math.min(end, at + 9)));
    if (marker === 0xee && tag === 'Adobe') isAdobe = true;
    at = end;
  }
  return undefined;
}
