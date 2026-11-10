/** A page image of a raster PDF: RGB, 8 bits a channel, rows top to bottom, zlib-deflated. */
export interface PdfImage {
  /** Its width, px. */
  readonly widthPx: number;
  /** Its height, px. */
  readonly heightPx: number;
  /** The deflated RGB bytes, as FlateDecode reads them. */
  readonly flateRgb: Uint8Array;
}

/** One page of a raster PDF: its size and the image that fills it. */
export interface PdfImagePage {
  /** The page's width, pt. */
  readonly widthPt: number;
  /** The page's height, pt. */
  readonly heightPt: number;
  /** The image drawn over the whole page. */
  readonly image: PdfImage;
}

/**
 * A number as the file writes it: at most 2 decimals, trailing zeros trimmed.
 *
 * @param value - The number.
 * @returns Its text.
 */
function numberText(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Text as bytes, one per character (the file's text is all ASCII but the binary comment).
 *
 * @param text - The text.
 * @returns Its bytes.
 */
function latin1(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

/** The file being written: its chunks, and where each object starts. */
class PdfBytes {
  readonly chunks: Uint8Array[] = [];
  readonly offsets: number[] = [];
  length = 0;

  /**
   * Appends bytes.
   *
   * @param bytes - The bytes, or text.
   */
  write(bytes: Uint8Array | string): void {
    const chunk = typeof bytes === 'string' ? latin1(bytes) : bytes;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  /**
   * Appends an object, numbered in order from 1.
   *
   * @param dictionary - Its dictionary.
   * @param stream - Its stream's bytes, if it has one (the dictionary then gains its length).
   */
  object(dictionary: string, stream?: Uint8Array): void {
    this.offsets.push(this.length);
    const number = this.offsets.length;
    if (stream === undefined) {
      this.write(`${String(number)} 0 obj\n${dictionary}\nendobj\n`);
      return;
    }
    const opened = `${dictionary.slice(0, -2)} /Length ${String(stream.length)} >>`;
    this.write(`${String(number)} 0 obj\n${opened}\nstream\n`);
    this.write(stream);
    this.write('\nendstream\nendobj\n');
  }

  /**
   * The whole file.
   *
   * @returns Its bytes.
   */
  bytes(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/**
 * Writes a raster PDF 1.4: one page per entry, in order, each its image drawn over the
 * whole MediaBox. Objects: 1 the catalog, 2 the page tree, then per page its page, content stream
 * and image XObject; an xref table with every object's offset, and the trailer. Text is not
 * selectable (the pages are images). Pure; never mutates the pages.
 *
 * @param pages - The pages.
 * @returns The file's bytes.
 * @throws {RangeError} When there is no page.
 */
export function writePdf(pages: readonly PdfImagePage[]): Uint8Array<ArrayBuffer> {
  if (pages.length === 0) throw new RangeError('A PDF needs at least one page.');
  const file = new PdfBytes();
  // The binary comment tells tools the file holds binary streams.
  file.write('%PDF-1.4\n%âãÏÓ\n');
  const pageNumber = (index: number): number => 3 + index * 3;
  const kids = pages.map((...[, index]) => `${String(pageNumber(index))} 0 R`).join(' ');
  file.object('<< /Type /Catalog /Pages 2 0 R >>');
  file.object(`<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  for (const [index, { widthPt, heightPt, image }] of pages.entries()) {
    const [width, height] = [numberText(widthPt), numberText(heightPt)];
    const content = String(pageNumber(index) + 1);
    const picture = String(pageNumber(index) + 2);
    file.object(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${picture} 0 R >> >> /Contents ${content} 0 R >>`,
    );
    file.object('<< >>', latin1(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`));
    file.object(
      `<< /Type /XObject /Subtype /Image /Width ${String(image.widthPx)} ` +
        `/Height ${String(image.heightPx)} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        '/Filter /FlateDecode >>',
      image.flateRgb,
    );
  }
  const xref = file.length;
  const size = file.offsets.length + 1;
  const entries = file.offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`);
  file.write(`xref\n0 ${String(size)}\n0000000000 65535 f \n${entries.join('')}`);
  file.write(`trailer\n<< /Size ${String(size)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF`);
  return file.bytes();
}
