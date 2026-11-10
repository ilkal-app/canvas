// A PDF 1.7 file around exported content: a catalog, a page tree, one page per input with
// its media box, content stream and resources (graphics states, shadings, images with soft
// masks), an xref table whose offsets point exactly at each object, and a trailer. Streams are
// uncompressed; nothing varies between runs. Pure.
import { formatNumber } from './glyph-path-data.js';
import { jpegInfo } from './jpeg-info.js';
import type { JpegImage, PdfTilingPattern } from './pdf-resources.js';
import { glyphHex } from './pdf-text-layer.js';
import type { PdfFont } from './pdf-text-layer.js';
import { FORM_EXTENT, type PdfForm, type PdfResources } from './text-pdf.js';

/** One page of {@link pdfDocument}. */
export interface PdfPage {
  /** Its width, in PDF units. */
  readonly width: number;
  /** Its height. */
  readonly height: number;
  /** Its content-stream operators. */
  readonly content: string;
  /** The resources its content names. */
  readonly resources: PdfResources;
}

/** The objects of a file being written, numbered from 1. */
class Objects {
  /** Each object's bytes, `N 0 obj` to `endobj`. */
  readonly bodies: Uint8Array[] = [];

  /**
   * Reserves the next object number.
   *
   * @returns The number.
   */
  reserve(): number {
    this.bodies.push(new Uint8Array(0));
    return this.bodies.length;
  }

  /**
   * Sets an object's body: a dictionary, and a stream after it when given.
   *
   * @param number - The object.
   * @param dictionary - Its dictionary text (a stream's without `/Length`, which is added).
   * @param stream - Its stream's bytes.
   */
  set(number: number, dictionary: string, stream?: Uint8Array): void {
    const head = `${String(number)} 0 obj\n`;
    if (stream === undefined) {
      this.bodies[number - 1] = latin1(`${head}${dictionary}\nendobj\n`);
      return;
    }
    const open = dictionary.replace(/>>\s*$/, ` /Length ${String(stream.length)} >>`);
    const start = latin1(`${head}${open}\nstream\n`);
    const end = latin1('\nendstream\nendobj\n');
    this.bodies[number - 1] = concat([start, stream, end]);
  }

  /**
   * Adds an object.
   *
   * @param dictionary - Its dictionary text.
   * @param stream - Its stream's bytes.
   * @returns Its number.
   */
  add(dictionary: string, stream?: Uint8Array): number {
    const number = this.reserve();
    this.set(number, dictionary, stream);
    return number;
  }
}

/**
 * Text as bytes, one per character (the file's ASCII and Latin-1 parts).
 *
 * @param text - The text.
 * @returns The bytes.
 */
function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/**
 * Byte arrays joined.
 *
 * @param parts - The arrays.
 * @returns One array.
 */
function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A value in font units scaled to the PDF's 1/1000 em.
 *
 * @param value - The value.
 * @param unitsPerEm - The font's units per em.
 * @returns The scaled, rounded value.
 */
function perMille(value: number, unitsPerEm: number): number {
  return Math.round((value * 1000) / unitsPerEm);
}

/**
 * A ToUnicode CMap: each glyph id mapped to the UTF-16BE of its text.
 *
 * @param entries - Text by glyph id.
 * @returns The CMap program.
 */
function toUnicodeCMap(entries: readonly (readonly [number, string])[]): string {
  // JavaScript strings are UTF-16 already: each code unit, surrogates included, as four digits.
  const utf16 = (text: string) => {
    let hex = '';
    for (let index = 0; index < text.length; index += 1)
      hex += text.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
    return hex;
  };
  const mappings = entries.map(([glyphId, text]) => `<${glyphHex(glyphId)}> <${utf16(text)}>`);
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    `${String(mappings.length)} beginbfchar`,
    ...mappings,
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/**
 * A font as indirect objects: Helvetica as one dictionary; an embedded face as a Type0 font
 * (Identity-H) over a CIDFont (CIDFontType2 for TrueType, CIDFontType0 for CFF) with its widths and
 * descriptor, the font file (FontFile2, or FontFile3 /OpenType), and a ToUnicode CMap.
 *
 * @param objects - The file's objects.
 * @param font - The font.
 * @returns The font dictionary's object number.
 */
function fontOf(objects: Objects, font: PdfFont): number {
  if (font.kind === 'standard')
    return objects.add(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
  const { unitsPerEm, baseFont } = font;
  const ascent = perMille(font.ascent, unitsPerEm);
  const descent = -perMille(font.descent, unitsPerEm);
  const isTrueType = font.format === 'truetype';
  const file = isTrueType
    ? objects.add(`<< /Length1 ${String(font.bytes.length)} >>`, font.bytes)
    : objects.add('<< /Subtype /OpenType >>', font.bytes);
  const fileKey = isTrueType ? 'FontFile2' : 'FontFile3';
  const box = `[0 ${String(descent)} 1000 ${String(ascent)}]`;
  const descriptor = objects.add(
    `<< /Type /FontDescriptor /FontName /${baseFont} /Flags 4 /FontBBox ${box} /ItalicAngle 0 /Ascent ${String(ascent)} /Descent ${String(descent)} /CapHeight ${String(Math.round(ascent * 0.7))} /StemV 80 /${fileKey} ${String(file)} 0 R >>`,
  );
  const widths = font.widths
    .map(([glyphId, width]) => `${String(glyphId)} [${String(width)}]`)
    .join(' ');
  const subtype = isTrueType ? 'CIDFontType2' : 'CIDFontType0';
  const map = isTrueType ? ' /CIDToGIDMap /Identity' : '';
  const system = '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>';
  const cid = objects.add(
    `<< /Type /Font /Subtype /${subtype} /BaseFont /${baseFont} ${system} /FontDescriptor ${String(descriptor)} 0 R /DW 1000 /W [${widths}]${map} >>`,
  );
  const unicode = objects.add('<< >>', latin1(toUnicodeCMap(font.toUnicode)));
  return objects.add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /${baseFont} /Encoding /Identity-H /DescendantFonts [${String(cid)} 0 R] /ToUnicode ${String(unicode)} 0 R >>`,
  );
}

/** The colour space of a JPEG's components. */
const JPEG_SPACES = { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' } as const;

/**
 * A JPEG embedded as it is: its file as a `/DCTDecode` stream, its size and colour space from its
 * frame; Adobe CMYK, stored inverted, decoded back by `/Decode`.
 *
 * @param objects - The file's objects.
 * @param image - The JPEG.
 * @returns Its object number.
 * @throws {RangeError} When the bytes have no frame `jpegInfo` reads.
 */
function jpegObject(objects: Objects, image: JpegImage): number {
  const info = jpegInfo(image.bytes);
  if (info === undefined) throw new RangeError('The JPEG has no frame a PDF can describe.');
  const decode = info.components === 4 && info.isAdobe ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
  const dictionary = `<< /Type /XObject /Subtype /Image /Width ${String(info.width)} /Height ${String(info.height)} /BitsPerComponent 8 /ColorSpace ${JPEG_SPACES[info.components]} /Filter /DCTDecode${decode} >>`;
  return objects.add(dictionary, image.bytes);
}

/**
 * A page's resources as indirect objects, and its `/Resources` dictionary naming them. A
 * transparency group's form draws with this same dictionary, so its nested forms, states,
 * shadings and images resolve as the page's do.
 *
 * @param objects - The file's objects.
 * @param resources - The resources.
 * @returns The dictionary text.
 */
function resourcesOf(objects: Objects, resources: PdfResources): string {
  const refs = (entries: [string, number][]) =>
    entries.map(([name, number]) => `/${name} ${String(number)} 0 R`).join(' ');
  const states = Object.entries(resources.extGStates).map(
    ([name, dictionary]): [string, number] => [name, objects.add(dictionary)],
  );
  const shadings = Object.entries(resources.shadings).map(
    ([name, dictionary]): [string, number] => [name, objects.add(dictionary)],
  );
  const images = Object.entries(resources.images).map(([name, image]): [string, number] => {
    if ('kind' in image) return [name, jpegObject(objects, image)];
    const sample = `/Type /XObject /Subtype /Image /Width ${String(image.width)} /Height ${String(image.height)} /BitsPerComponent 8`;
    const mask =
      image.alpha === undefined
        ? ''
        : ` /SMask ${String(objects.add(`<< ${sample} /ColorSpace /DeviceGray >>`, image.alpha))} 0 R`;
    return [name, objects.add(`<< ${sample} /ColorSpace /DeviceRGB${mask} >>`, image.rgb)];
  });
  const forms = Object.entries(resources.forms ?? {}).map(
    ([name, form]): [string, number, PdfForm] => [name, objects.reserve(), form],
  );
  const xObjects = [...images, ...forms.map(([name, number]): [string, number] => [name, number])];
  const fonts = Object.entries(resources.fonts ?? {}).map(([name, font]): [string, number] => [
    name,
    fontOf(objects, font),
  ]);
  const patterns = Object.entries(resources.patterns ?? {}).map(
    ([name, pattern]): [string, number, PdfTilingPattern] => [name, objects.reserve(), pattern],
  );
  const fontEntry = fonts.length === 0 ? '' : ` /Font << ${refs(fonts)} >>`;
  const patternEntry =
    patterns.length === 0
      ? ''
      : ` /Pattern << ${refs(patterns.map(([name, number]): [string, number] => [name, number]))} >>`;
  const dictionary = `<< /ExtGState << ${refs(states)} >> /Shading << ${refs(shadings)} >> /XObject << ${refs(xObjects)} >>${fontEntry}${patternEntry} >>`;
  const extent = [-FORM_EXTENT, -FORM_EXTENT, FORM_EXTENT, FORM_EXTENT] as const;
  for (const [, number, form] of forms) {
    const { content, bbox } = typeof form === 'string' ? { content: form, bbox: extent } : form;
    const box = bbox.map((value) => formatNumber(value)).join(' ');
    const group = '/Group << /Type /Group /S /Transparency /I true /K false >>';
    const dictionaryOfForm = `<< /Type /XObject /Subtype /Form /BBox [${box}] ${group} /Resources ${dictionary} >>`;
    objects.set(number, dictionaryOfForm, latin1(content));
  }
  for (const [, number, pattern] of patterns) {
    const { a, b, c, d, e, f } = pattern.matrix;
    const matrix = [a, b, c, d, e, f].map((value) => formatNumber(value)).join(' ');
    const box = pattern.bbox.map((value) => formatNumber(value)).join(' ');
    const steps = `/XStep ${formatNumber(pattern.xStep)} /YStep ${formatNumber(pattern.yStep)}`;
    const head = `<< /Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [${box}] ${steps} /Matrix [${matrix}] /Resources ${dictionary} >>`;
    objects.set(number, head, latin1(pattern.content));
  }
  return dictionary;
}

/**
 * A PDF 1.7 file: a binary-marked header, a catalog and page tree, one page per input with its
 * media box (`0 0 width height`), content stream and resources, an xref table pointing exactly at
 * each object, and a trailer. Deterministic: no dates or ids.
 *
 * @param pages - The pages.
 * @returns The file's bytes.
 */
export function pdfDocument(pages: readonly PdfPage[]): Uint8Array {
  const objects = new Objects();
  const catalog = objects.reserve();
  const tree = objects.reserve();
  const kids = pages.map((page) => {
    const number = objects.reserve();
    const resources = resourcesOf(objects, page.resources);
    const contents = objects.add('<< >>', latin1(page.content));
    const box = `[0 0 ${String(page.width)} ${String(page.height)}]`;
    objects.set(
      number,
      `<< /Type /Page /Parent ${String(tree)} 0 R /MediaBox ${box} /Resources ${resources} /Contents ${String(contents)} 0 R >>`,
    );
    return number;
  });
  const kidRefs = kids.map((number) => `${String(number)} 0 R`).join(' ');
  objects.set(tree, `<< /Type /Pages /Kids [${kidRefs}] /Count ${String(kids.length)} >>`);
  objects.set(catalog, `<< /Type /Catalog /Pages ${String(tree)} 0 R >>`);
  const header = latin1('%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n');
  const offsets: number[] = [];
  let at = header.length;
  for (const body of objects.bodies) {
    offsets.push(at);
    at += body.length;
  }
  const rows = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  const size = objects.bodies.length + 1;
  const xref = `xref\n0 ${String(size)}\n0000000000 65535 f \n${rows}`;
  const trailer = `trailer\n<< /Size ${String(size)} /Root ${String(catalog)} 0 R >>\nstartxref\n${String(at)}\n%%EOF\n`;
  return concat([header, ...objects.bodies, latin1(xref + trailer)]);
}
