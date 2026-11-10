// The PDF writer's selectable text layer: invisible text (render mode 3) over the drawn
// vectors, so a viewer selects, searches and copies the text where it is drawn. Each cluster is a
// marked span whose /ActualText is its exact source text; its glyphs are shown by glyph id in the
// face's embedded font (when the caller allows embedding) at their shaped pen positions, or as
// WinAnsi text in Helvetica. Pure.
import { parseFont } from '../font/parse-font.js';
import type { LayoutGlyph, TextLayout } from '../layout/text-layout.js';

import { formatNumber } from './glyph-path-data.js';

/** A face's font file to embed for the selectable layer. */
export interface PdfEmbeddedFile {
  /** The file's bytes. */
  readonly bytes: Uint8Array;
  /** Its outlines: TrueType (`glyf`) or OpenType CFF. */
  readonly format: 'truetype' | 'opentype';
}

/** The selectable text layer's fonts. */
export interface PdfSelectableOptions {
  /**
   * The face's font file, only when the caller found it embeddable (`fsTypeOf`).
   *
   * @param faceId - The face, as the layout names it.
   * @returns The file, or undefined to fall back to Helvetica.
   */
  embed?(faceId: string): PdfEmbeddedFile | undefined;
}

/** A font the text layer uses: an embedded face, or the standard Helvetica. */
export type PdfFont =
  | {
      /** An embedded face, shown by glyph id (Identity-H). */
      readonly kind: 'embedded';
      /** Its outlines' format. */
      readonly format: 'truetype' | 'opentype';
      /** The font file. */
      readonly bytes: Uint8Array;
      /** Its PostScript-safe name. */
      readonly baseFont: string;
      /** Its units per em. */
      readonly unitsPerEm: number;
      /** Its ascent, in font units. */
      readonly ascent: number;
      /** Its descent, in font units (positive below the baseline). */
      readonly descent: number;
      /** Each used glyph's advance, in 1/1000 em, by glyph id, sorted. */
      readonly widths: readonly (readonly [number, number])[];
      /** The text each glyph that starts a cluster maps to, by glyph id. */
      readonly toUnicode: readonly (readonly [number, string])[];
    }
  | {
      /** The standard Helvetica, shown as WinAnsi text. */
      readonly kind: 'standard';
      /** Its name. */
      readonly baseFont: 'Helvetica';
    };

/** The Windows-1252 bytes of the characters it places in 0x80–0x9F. */
const WIN_ANSI_EXTRAS: Readonly<Record<number, number>> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/**
 * Text as a PDF literal string in WinAnsi: `(`, `)` and `\` escaped, a character WinAnsi lacks as
 * `?`, one per code point.
 *
 * @param text - The text.
 * @returns The literal, parentheses included.
 */
export function winAnsiLiteral(text: string): string {
  let out = '';
  for (const character of text) {
    // An astral character's first code unit is a surrogate, which WinAnsi lacks: `?`.
    const code = character.charCodeAt(0);
    const byte =
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)
        ? code
        : (WIN_ANSI_EXTRAS[code] ?? 0x3f);
    const letter = String.fromCharCode(byte);
    out += letter === '(' || letter === ')' || letter === '\\' ? `\\${letter}` : letter;
  }
  return `(${out})`;
}

/**
 * Text as a PDF hex string in UTF-16BE with its byte-order mark, as /ActualText takes it.
 *
 * @param text - The text.
 * @returns The hex string, angle brackets included.
 */
export function utf16Hex(text: string): string {
  let hex = 'FEFF';
  for (let index = 0; index < text.length; index += 1)
    hex += text.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/**
 * A glyph id as four hex digits.
 *
 * @param glyphId - The id.
 * @returns The digits.
 */
export function glyphHex(glyphId: number): string {
  return glyphId.toString(16).padStart(4, '0').toUpperCase();
}

/** An embedded font as it is gathered: its file, the widths and mappings of the glyphs used. */
interface Gathering {
  /** The font's resource name. */
  readonly name: string;
  /** Its PostScript-safe name, from the face id. */
  readonly baseFont: string;
  /** The file and its parsed metrics. */
  readonly file: PdfEmbeddedFile;
  /** The parsed font. */
  readonly parsed: ReturnType<typeof parseFont>;
  /** Advances by glyph id. */
  readonly widths: Map<number, number>;
  /** Text by glyph id. */
  readonly toUnicode: Map<number, string>;
}

/** The state of one text layer. */
interface Layer {
  /** The resource name prefix. */
  readonly prefix: string;
  /** The layer's options. */
  readonly options: PdfSelectableOptions;
  /** Embedded fonts by face id, or null for a face that falls back. */
  readonly faces: Map<string, Gathering | null>;
  /** The shared Helvetica's name, once used. */
  helvetica?: string;
  /** How many fonts are named. */
  count: number;
  /** The faces not embedded. */
  readonly fallen: Set<string>;
}

/**
 * The embedded font for a face, gathered the first time; null when it falls back.
 *
 * @param layer - The layer.
 * @param faceId - The face.
 * @returns The gathering, or null.
 */
function faceOf(layer: Layer, faceId: string): Gathering | null {
  const known = layer.faces.get(faceId);
  if (known !== undefined) return known;
  const file = layer.options.embed?.(faceId);
  const gathering =
    file === undefined
      ? null
      : {
          name: `${layer.prefix}F${String((layer.count += 1))}`,
          baseFont: faceId.replace(/[^A-Za-z0-9]/g, '') || 'EmbeddedFont',
          file,
          parsed: parseFont(file.bytes),
          widths: new Map<number, number>(),
          toUnicode: new Map<number, string>(),
        };
  if (gathering === null) layer.fallen.add(faceId);
  layer.faces.set(faceId, gathering);
  return gathering;
}

/**
 * The shared Helvetica's name, named the first time.
 *
 * @param layer - The layer.
 * @returns The name.
 */
function helveticaOf(layer: Layer): string {
  layer.helvetica ??= `${layer.prefix}F${String((layer.count += 1))}`;
  return layer.helvetica;
}

/**
 * One cluster's operators: its span, its glyphs by id in the embedded font, or its text in
 * Helvetica at its leftmost glyph (a face not embedded, or a cluster with an unshaped glyph).
 *
 * @param layer - The layer.
 * @param layout - The text's layout.
 * @param carried - The source range its /ActualText carries: its own text and any the layout
 *   draws no glyph for up to the next cluster (a hard line break).
 * @param carried.to - Where it ends.
 * @param carried.from - Where it starts.
 * @param glyphs - Its glyphs, in layout order.
 * @returns The operators.
 */
function clusterOps(
  layer: Layer,
  layout: TextLayout,
  carried: { readonly from: number; readonly to: number },
  glyphs: readonly [LayoutGlyph, ...LayoutGlyph[]],
): string[] {
  const [first] = glyphs;
  const end = Math.max(...glyphs.map((glyph) => glyph.end));
  const text = layout.text.slice(first.index, end);
  const run = layout.runs[first.run];
  const size = formatNumber(run?.fontSize ?? 0);
  const face = run === undefined ? null : faceOf(layer, run.faceId);
  const actual = utf16Hex(layout.text.slice(carried.from, carried.to));
  const ops = [`/Span << /ActualText ${actual} >> BDC`];
  // An unshaped glyph has no id to show, so such a cluster is shown in Helvetica too: every
  // cluster gets text-showing geometry to select.
  const shaped = glyphs.filter(
    (glyph): glyph is LayoutGlyph & { readonly glyphId: number } => glyph.glyphId !== null,
  );
  if (face === null || shaped.length < glyphs.length) {
    const x = Math.min(...glyphs.map((glyph) => glyph.x));
    const { y } = first;
    ops.push(
      `/${helveticaOf(layer)} ${size} Tf`,
      `1 0 0 -1 ${formatNumber(x)} ${formatNumber(y)} Tm`,
    );
    ops.push(`${winAnsiLiteral(text)} Tj`);
  } else {
    for (const glyph of shaped) {
      face.widths.set(glyph.glyphId, Math.round(face.parsed.advanceOf(glyph.glyphId) * 1000));
      if (glyph === first && !face.toUnicode.has(glyph.glyphId))
        face.toUnicode.set(glyph.glyphId, text);
      ops.push(
        `/${face.name} ${size} Tf`,
        `1 0 0 -1 ${formatNumber(glyph.x)} ${formatNumber(glyph.y)} Tm`,
      );
      ops.push(`<${glyphHex(glyph.glyphId)}> Tj`);
    }
  }
  ops.push('EMC');
  return ops;
}

/**
 * The selectable text layer: one invisible `BT … ET` (render mode 3), its clusters in logical
 * order (source order, also for right-to-left runs), each a span carrying its exact text as
 * /ActualText; and the fonts it names, each embedded face once with the widths and ToUnicode
 * mappings of the glyphs used, the shared Helvetica for faces not embedded (warned about).
 *
 * @param layout - The text's layout.
 * @param options - Which faces to embed.
 * @param prefix - The resource name prefix.
 * @returns The operators, the fonts by name, and the warnings.
 */
export function pdfTextLayer(
  layout: TextLayout,
  options: PdfSelectableOptions,
  prefix: string,
): { ops: string[]; fonts: Record<string, PdfFont>; warnings: string[] } {
  const layer: Layer = { prefix, options, faces: new Map(), count: 0, fallen: new Set() };
  const clusters = new Map<number, [LayoutGlyph, ...LayoutGlyph[]]>();
  for (const glyph of layout.glyphs) {
    const known = clusters.get(glyph.index);
    if (known === undefined) clusters.set(glyph.index, [glyph]);
    else known.push(glyph);
  }
  const ops = ['BT', '3 Tr'];
  const ordered = [...clusters].sort(([left], [right]) => left - right);
  ordered.forEach(([start, glyphs], index) => {
    // Text no glyph draws (a hard break's newline) travels with the cluster before it, and any
    // before the first cluster with the first, so copying keeps every source character.
    const next = ordered[index + 1]?.[0] ?? layout.text.length;
    const carried = { from: index === 0 ? 0 : start, to: next };
    ops.push(...clusterOps(layer, layout, carried, glyphs));
  });
  ops.push('ET');
  const fonts: Record<string, PdfFont> = {};
  for (const face of layer.faces.values()) {
    if (face === null) continue;
    const { parsed, file } = face;
    fonts[face.name] = {
      kind: 'embedded',
      ...{ format: file.format, bytes: file.bytes, baseFont: face.baseFont },
      ...{ unitsPerEm: parsed.unitsPerEm, ascent: parsed.ascent * parsed.unitsPerEm },
      descent: parsed.descent * parsed.unitsPerEm,
      widths: [...face.widths].sort(([left], [right]) => left - right),
      toUnicode: [...face.toUnicode].sort(([left], [right]) => left - right),
    };
  }
  if (layer.helvetica !== undefined)
    fonts[layer.helvetica] = { kind: 'standard', baseFont: 'Helvetica' };
  const warnings =
    layer.fallen.size === 0
      ? []
      : [`fonts not embedded, text layer in Helvetica: ${[...layer.fallen].join(', ')}`];
  return { ops, fonts, warnings };
}
