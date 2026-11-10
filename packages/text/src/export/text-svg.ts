// A laid-out text as an SVG fragment: its vectors as paths (outlines, colour layers with
// their clips, gradients and blend groups, bitmaps as PNG images) and, for selection and search,
// an invisible text layer over them. Pure.
import type { TextLayout } from '../layout/text-layout.js';

import type { VectorGroup, VectorLayer } from './colour-layers.js';
import { colourLineOf } from './colour-line.js';
import { formatNumber, type Affine } from './glyph-path-data.js';
import { base64Of, bgraToPng } from './png-encode.js';
import {
  cssBlendMode,
  escapeXml,
  fillAttributes,
  gradientElement,
  matrixOf,
  sweepWedges,
  type ColorOf,
} from './svg-paint.js';
import type { VectorGlyph } from './text-vectors.js';

/** A font file to embed for the selectable layer. */
export interface EmbeddedFontFile {
  /** The file's bytes. */
  readonly bytes: Uint8Array;
  /** Its format, for the `@font-face` source. */
  readonly format: 'truetype' | 'opentype';
}

/** The invisible text layer for selection and search. */
export interface SelectableTextOptions {
  /**
   * The CSS font family the layer uses for a face.
   *
   * @param faceId - The face, as the layout names it.
   * @returns The family.
   */
  familyOf(faceId: string): string;
  /**
   * The face's font file to embed as `@font-face`; only for a font the caller found embeddable
   * (`fsTypeOf`).
   *
   * @param faceId - The face.
   * @returns The file, or undefined to embed none.
   */
  embed?(faceId: string): EmbeddedFontFile | undefined;
}

/** How {@link textSvg} writes a text. */
export interface TextSvgOptions {
  /** Resolves a fill (`ink`, a token reference, an RGBA tuple or a colour glyph's) to RGBA. */
  readonly colorOf: ColorOf;
  /** The text box to SVG user space; the identity when absent. */
  readonly transform?: Affine;
  /** The prefix of every id the fragment defines, so several texts share a document. */
  readonly idPrefix: string;
  /** An invisible text layer for selection and search; absent: outlines only. */
  readonly selectable?: SelectableTextOptions;
}

/** An SVG fragment, and what it could only approximate. */
export interface TextSvg {
  /** One `<g>` holding its `<defs>`, the vectors and the text layer. */
  readonly svg: string;
  /** What was approximated: a sweep gradient, a composite mode SVG has no blend for. */
  readonly warnings: readonly string[];
}

/** The state of one write: definitions, ids, warnings. */
interface Writer {
  /** The options. */
  readonly options: TextSvgOptions;
  /** The `<defs>` entries. */
  readonly defs: string[];
  /** The warnings, each once. */
  readonly warnings: Set<string>;
  /** The next id's number. */
  next: number;
}

/**
 * A fresh id with the write's prefix.
 *
 * @param writer - The write.
 * @param kind - A short kind, for readability.
 * @returns The id.
 */
function idOf(writer: Writer, kind: string): string {
  writer.next += 1;
  return `${writer.options.idPrefix}-${kind}${String(writer.next)}`;
}

/**
 * A region defined as a `<clipPath>`.
 *
 * @param writer - The write.
 * @param d - The region's path data.
 * @returns The clip path's id.
 */
function clipOf(writer: Writer, d: string): string {
  const id = idOf(writer, 'clip');
  writer.defs.push(`<clipPath id="${id}"><path d="${d}" clip-rule="nonzero"/></clipPath>`);
  return id;
}

/**
 * One colour layer: its region filled by its colour or gradient (its resolved colour line,
 * `colourLineOf`; a sweep as clipped wedges), inside its outer clips. A gradient that paints
 * nothing (equal-offset stops repeating or reflecting, a cone whose radius is negative everywhere)
 * leaves the layer out.
 *
 * @param writer - The write.
 * @param layer - The layer.
 * @returns Its elements.
 */
function layerElement(writer: Writer, layer: VectorLayer): string {
  const { colorOf } = writer.options;
  let body: string;
  const line = layer.gradient === undefined ? undefined : colourLineOf(layer.gradient, colorOf);
  if (line === null) return '';
  if (line === undefined) {
    const fill = layer.fill === undefined ? ([0, 0, 0, 0] as const) : colorOf(layer.fill);
    body = `<path d="${layer.d}" ${fillAttributes(fill, layer.fillAlpha)} fill-rule="nonzero"/>`;
  } else if (line.gradient.kind === 'sweep') {
    writer.warnings.add(`sweep gradient approximated by wedges`);
    const wedges = sweepWedges({ ...line, gradient: line.gradient });
    body = `<g clip-path="url(#${clipOf(writer, layer.d)})">${wedges}</g>`;
  } else {
    const id = idOf(writer, 'grad');
    writer.defs.push(gradientElement(id, { ...line, gradient: line.gradient }));
    body = `<path d="${layer.d}" fill="url(#${id})" fill-rule="nonzero"/>`;
  }
  // Outer clips are defined outermost first and wrap from the inside out.
  const clips = layer.clips.map((clip) => clipOf(writer, clip.d));
  for (const id of clips.reverse()) body = `<g clip-path="url(#${id})">${body}</g>`;
  return body;
}

/**
 * A group's opening tag: isolated, with its blend mode; a Porter-Duff mode SVG cannot draw is
 * painted src-over and warned about.
 *
 * @param writer - The write.
 * @param group - The group.
 * @returns The tag.
 */
function groupOpen(writer: Writer, group: VectorGroup | undefined): string {
  const mode = group === undefined ? 'src-over' : group.mode;
  const css = cssBlendMode(mode);
  if (css === undefined) writer.warnings.add(`composite ${mode} drawn as src-over`);
  return css === null || css === undefined
    ? '<g style="isolation:isolate">'
    : `<g style="isolation:isolate; mix-blend-mode: ${css}">`;
}

/**
 * A colour glyph's layers, nested in the groups each was painted in.
 *
 * @param writer - The write.
 * @param layers - The layers, in paint order.
 * @param groups - The groups they name.
 * @returns The elements.
 */
function layersElement(
  writer: Writer,
  layers: readonly VectorLayer[],
  groups: readonly VectorGroup[],
): string {
  const parts: string[] = [];
  const open: number[] = [];
  for (const layer of layers) {
    let shared = 0;
    while (shared < open.length && open[shared] === layer.groups[shared]) shared += 1;
    for (let depth = open.length; depth > shared; depth -= 1) parts.push('</g>');
    open.length = shared;
    for (const group of layer.groups.slice(shared)) {
      parts.push(groupOpen(writer, groups[group]));
      open.push(group);
    }
    parts.push(layerElement(writer, layer));
  }
  parts.push(...open.map(() => '</g>'));
  return parts.join('');
}

/**
 * One vector glyph's elements.
 *
 * @param writer - The write.
 * @param vector - The glyph.
 * @returns The elements.
 */
function glyphElement(writer: Writer, vector: VectorGlyph): string {
  if (vector.kind === 'layers') return layersElement(writer, vector.layers, vector.groups);
  if (vector.kind === 'image') {
    const { image } = vector;
    const png =
      image.png ?? bgraToPng(image.bgra ?? new Uint8Array(0), image.pixelWidth, image.pixelHeight);
    const n = formatNumber;
    return `<image x="${n(image.x)}" y="${n(image.y)}" width="${n(image.width)}" height="${n(image.height)}" preserveAspectRatio="none" href="data:image/png;base64,${base64Of(png)}"/>`;
  }
  if (vector.d === '') return '';
  return `<path d="${vector.d}" ${fillAttributes(writer.options.colorOf(vector.fill))} fill-rule="nonzero"/>`;
}

/**
 * The invisible text layer: one `<tspan>` per cluster in logical order, at its leftmost glyph's
 * pen position and baseline, stretched to the cluster's advance, so a viewer selects and finds
 * the text where its outlines are drawn. Embeddable fonts become `@font-face` rules.
 *
 * @param writer - The write.
 * @param layout - The text's layout.
 * @param selectable - The layer's fonts.
 * @returns The `<text>` element.
 */
function textLayer(writer: Writer, layout: TextLayout, selectable: SelectableTextOptions): string {
  const clusters = new Map<
    number,
    { end: number; x: number; y: number; advance: number; run: number }
  >();
  for (const glyph of layout.glyphs) {
    const known = clusters.get(glyph.index);
    if (known === undefined)
      clusters.set(glyph.index, {
        end: glyph.end,
        x: glyph.x,
        y: glyph.y,
        advance: glyph.advance,
        run: glyph.run,
      });
    else
      clusters.set(glyph.index, {
        ...known,
        x: Math.min(known.x, glyph.x),
        advance: known.advance + glyph.advance,
      });
  }
  const embedded = new Set<string>();
  const spans = [...clusters.entries()]
    .sort(([left], [right]) => left - right)
    .map(([start, cluster]) => {
      const run = layout.runs[cluster.run];
      const faceId = run?.faceId ?? '';
      const family = selectable.familyOf(faceId);
      const file = embedded.has(faceId) ? undefined : selectable.embed?.(faceId);
      if (file !== undefined) {
        embedded.add(faceId);
        const type = file.format === 'truetype' ? 'ttf' : 'otf';
        writer.defs.push(
          `<style>@font-face { font-family: "${escapeXml(family)}"; src: url(data:font/${type};base64,${base64Of(file.bytes)}) format('${file.format}'); }</style>`,
        );
      }
      const n = formatNumber;
      const text = escapeXml(layout.text.slice(start, cluster.end));
      return `<tspan x="${n(cluster.x)}" y="${n(cluster.y)}" textLength="${n(cluster.advance)}" lengthAdjust="spacingAndGlyphs" font-family="${escapeXml(family)}" font-size="${n(run?.fontSize ?? 0)}">${text}</tspan>`;
    });
  return `<text fill-opacity="0" xml:space="preserve">${spans.join('')}</text>`;
}

/**
 * A laid-out text as an SVG fragment: one `<g>` (transformed when asked) holding its own
 * `<defs>`, each vector glyph (an outline filled non-zero; a colour glyph's layers with their
 * clips, gradients and isolated blend groups; a bitmap as a PNG `<image>`), and, when asked, an
 * invisible text layer for selection. Deterministic: the same inputs give the same text.
 *
 * @param layout - The text's layout.
 * @param vectors - Its vectors (`textVectors`).
 * @param options - Colours, placement, ids and the text layer.
 * @returns The fragment and its warnings.
 */
export function textSvg(
  layout: TextLayout,
  vectors: readonly VectorGlyph[],
  options: TextSvgOptions,
): TextSvg {
  const writer: Writer = { options, defs: [], warnings: new Set(), next: 0 };
  const body = vectors.map((vector) => glyphElement(writer, vector)).join('');
  const text =
    options.selectable === undefined ? '' : textLayer(writer, layout, options.selectable);
  const transform =
    options.transform === undefined ? '' : ` transform="${matrixOf(options.transform)}"`;
  const defs = writer.defs.length === 0 ? '' : `<defs>${writer.defs.join('')}</defs>`;
  return { svg: `<g${transform}>${defs}${body}${text}</g>`, warnings: [...writer.warnings] };
}
