// A laid-out text's vectors as PDF content: outlines filled non-zero, colour glyph layers
// clipped by their regions and outer clips, gradients as shadings, sweeps as wedges, groups with
// their blend modes, bitmaps as image XObjects with soft masks. The selectable text layer is
// `pdf-text-layer.ts`'s. Pure apart from PNG inflating, which is asynchronous.
import type { TextLayout } from '../layout/text-layout.js';

import type { VectorGroup, VectorLayer, VectorSweepGradient } from './colour-layers.js';
import {
  colourAtStops,
  colourLineOf,
  type ColorOf,
  type ColourLine,
  type Rgba,
} from './colour-line.js';
import { formatNumber, type Affine } from './glyph-path-data.js';
import { pdfBlendMode, matrixOperands, rgbOperands, shadingOf } from './pdf-paint.js';
import type { JpegImage, PdfTilingPattern } from './pdf-resources.js';
import { pdfTextLayer, type PdfFont, type PdfSelectableOptions } from './pdf-text-layer.js';
import { decodePng, splitSamples, type DecodedBitmap } from './png-decode.js';
import type { VectorGlyph } from './text-vectors.js';

/**
 * An image XObject: decoded samples (RGB, and an alpha mask when not opaque), or a JPEG file
 * embedded as it is.
 */
export type PdfImage = DecodedBitmap | JpegImage;

/**
 * A transparency group's form: its content, drawn in a box reaching {@link FORM_EXTENT} round the
 * origin, or its content and its own box, `[left, bottom, right, top]` in user space.
 */
export type PdfForm = string | BoxedPdfForm;

/** A transparency group's form with its own box. */
export interface BoxedPdfForm {
  /** Its content-stream operators. */
  readonly content: string;
  /** The box it draws in, `[left, bottom, right, top]` in user space. */
  readonly bbox: readonly [number, number, number, number];
}

/** How far a transparency group's form reaches round the origin by default, in user space. */
export const FORM_EXTENT = 1e6;

/** The named resources a text's content uses, each defined once per call. */
export interface PdfResources {
  /** Graphics states by name: a dictionary's text (`/ca`, `/BM`). */
  readonly extGStates: Readonly<Record<string, string>>;
  /** Shadings by name: a dictionary's text, its functions inline. */
  readonly shadings: Readonly<Record<string, string>>;
  /** Image XObjects by name. */
  readonly images: Readonly<Record<string, PdfImage>>;
  /**
   * Isolated transparency groups by name, as form XObjects drawing with the same resources as the
   * page: their content, or their content and the box it draws in.
   */
  readonly forms?: Readonly<Record<string, PdfForm>>;
  /** The selectable text layer's fonts by name: embedded faces, or the standard Helvetica. */
  readonly fonts?: Readonly<Record<string, PdfFont>>;
  /** Tiling patterns by name, drawing with the same resources as the page. */
  readonly patterns?: Readonly<Record<string, PdfTilingPattern>>;
}

/** The resources of one text's content: its groups' forms are their content alone. */
export interface TextPdfResources extends PdfResources {
  /** Its colour glyphs' bitmaps by name, decoded. */
  readonly images: Readonly<Record<string, DecodedBitmap>>;
  /** Its colour glyphs' transparency groups by name: their content. */
  readonly forms?: Readonly<Record<string, string>>;
}

/** How {@link textPdf} writes a text. */
export interface TextPdfOptions {
  /** Resolves a fill (`ink`, a token reference, an RGBA tuple or a colour glyph's) to RGBA. */
  readonly colorOf: ColorOf;
  /** The text box (y down) to PDF user space, applied with `cm`; the identity when absent. */
  readonly transform?: Affine;
  /** The prefix of every resource name the text defines, e.g. `T1` for `/T1Gs1`. */
  readonly namePrefix: string;
  /** An invisible text layer for selection, search and copy; absent: vectors only. */
  readonly selectable?: PdfSelectableOptions;
}

/** A text's PDF content, its resources, and what it could only approximate or leave out. */
export interface TextPdf {
  /** Content-stream operators, in one `q … Q`. */
  readonly content: string;
  /** The resources the content names. */
  readonly resources: TextPdfResources;
  /** What was approximated or left out. */
  readonly warnings: readonly string[];
}

/** How many wedges approximate a sweep gradient. */
const SWEEP_WEDGES = 64;

/** A sweep's wedge radius, in em: far past any glyph's clip. */
const SWEEP_RADIUS_EM = 64;

/** The state of one write. */
interface Writer {
  /** The options. */
  readonly options: TextPdfOptions;
  /** Graphics states by dictionary, so equal ones share a name. */
  readonly states: Map<string, string>;
  /** Shadings by name. */
  readonly shadings: Record<string, string>;
  /** Images by name. */
  readonly images: Record<string, DecodedBitmap>;
  /** Transparency-group forms by name: their content. */
  readonly forms: Record<string, string>;
  /** The warnings, each once. */
  readonly warnings: Set<string>;
}

/**
 * The name of a graphics state, defining it the first time.
 *
 * @param writer - The write.
 * @param dictionary - Its dictionary text.
 * @returns Its name.
 */
function stateOf(writer: Writer, dictionary: string): string {
  const known = writer.states.get(dictionary);
  if (known !== undefined) return known;
  const name = `${writer.options.namePrefix}Gs${String(writer.states.size + 1)}`;
  writer.states.set(dictionary, name);
  return name;
}

/**
 * A flat fill of a region: its alpha's graphics state when not opaque, the colour, the path.
 *
 * @param writer - The write.
 * @param rgba - The colour.
 * @param pdf - The region's path operators.
 * @param alpha - A further alpha to multiply in.
 * @returns The operators.
 */
function solidFill(writer: Writer, rgba: Rgba, pdf: string, alpha = 1): string[] {
  const opacity = rgba[3] * alpha;
  const state =
    opacity === 1 ? [] : [`/${stateOf(writer, `<< /ca ${formatNumber(opacity)} >>`)} gs`];
  return [...state, `${rgbOperands(rgba)} rg`, `${pdf} f`];
}

/**
 * A sweep's wedges about its centre, each a flat colour from its resolved line at the wedge's
 * middle angle, in the text box.
 *
 * @param line - The sweep's resolved line.
 * @returns The operators.
 */
function sweepWedges(line: ColourLine<VectorSweepGradient>): string[] {
  const { x0, y0, startAngle, endAngle, extend, transform: m } = line.gradient;
  const span = endAngle - startAngle;
  const place = (x: number, y: number) =>
    `${formatNumber(m.a * x + m.c * y + m.e)} ${formatNumber(m.b * x + m.d * y + m.f)}`;
  const tip = (angle: number) =>
    place(x0 + Math.cos(angle) * SWEEP_RADIUS_EM, y0 + Math.sin(angle) * SWEEP_RADIUS_EM);
  const ops: string[] = [];
  for (let index = 0; index < SWEEP_WEDGES; index += 1) {
    const from = (index / SWEEP_WEDGES) * Math.PI * 2;
    const to = ((index + 1) / SWEEP_WEDGES) * Math.PI * 2;
    const raw = span === 0 ? 0 : ((from + to) / 2 - startAngle) / span;
    const cycle = raw - Math.floor(raw);
    const t =
      extend === 'pad'
        ? Math.min(1, Math.max(0, raw))
        : extend === 'repeat' || Math.floor(raw) % 2 === 0
          ? cycle
          : 1 - cycle;
    const rgba = colourAtStops(line.stops, t);
    ops.push(`${rgbOperands(rgba)} rg`, `${place(x0, y0)} m ${tip(from)} l ${tip(to)} l h f`);
  }
  return ops;
}

/**
 * One colour layer, inside `q … Q`: its outer clips, then its paint (a flat fill, a shading
 * clipped to its region, or a sweep's wedges); a gradient that paints nothing is left out.
 *
 * @param writer - The write.
 * @param layer - The layer.
 * @returns The operators.
 */
function layerOps(writer: Writer, layer: VectorLayer): string[] {
  const { colorOf, namePrefix } = writer.options;
  const line = layer.gradient === undefined ? undefined : colourLineOf(layer.gradient, colorOf);
  if (line === null) return [];
  const clips = layer.clips.map((clip) => `${clip.pdf} W n`);
  if (line === undefined) {
    const rgba = layer.fill === undefined ? ([0, 0, 0, 0] as const) : colorOf(layer.fill);
    return ['q', ...clips, ...solidFill(writer, rgba, layer.pdf, layer.fillAlpha), 'Q'];
  }
  if (line.stops.some(({ rgba }) => rgba[3] < 1))
    writer.warnings.add('gradient alpha is not exported to PDF; its colours are drawn opaque');
  const region = `${layer.pdf} W n`;
  const { gradient } = line;
  if (gradient.kind === 'sweep') {
    writer.warnings.add('sweep gradient approximated by wedges');
    return ['q', ...clips, region, ...sweepWedges({ ...line, gradient }), 'Q'];
  }
  const name = `${namePrefix}Sh${String(Object.keys(writer.shadings).length + 1)}`;
  writer.shadings[name] = shadingOf({ ...line, gradient });
  return ['q', ...clips, region, `${matrixOperands(gradient.transform)} cm`, `/${name} sh`, 'Q'];
}

/** A group being written: which it is, and the operators painted into it so far. */
interface OpenGroup {
  /** The group's index in the glyph's groups. */
  readonly index: number;
  /** Its operators. */
  readonly ops: string[];
}

/**
 * Closes a group into its parent's operators. A blending group becomes an isolated transparency
 * group, a form XObject drawn under its blend mode's graphics state, so its layers blend together
 * onto what is under it, as the SVG writer's isolated `<g>` does. A src-over group is painted
 * inline, and a Porter-Duff one too, with a warning.
 *
 * @param writer - The write.
 * @param closing - The group to close.
 * @param group - Its definition.
 * @param parent - The operators it closes into.
 */
function closeGroup(
  writer: Writer,
  closing: OpenGroup,
  group: VectorGroup | undefined,
  parent: string[],
): void {
  const mode = group?.mode ?? 'src-over';
  const blend = pdfBlendMode(mode);
  if (blend === undefined) writer.warnings.add(`composite ${mode} drawn as src-over`);
  if (blend === null || blend === undefined) {
    parent.push('q', ...closing.ops, 'Q');
    return;
  }
  const name = `${writer.options.namePrefix}Fx${String(Object.keys(writer.forms).length + 1)}`;
  writer.forms[name] = `${closing.ops.join('\n')}\n`;
  parent.push('q', `/${stateOf(writer, `<< /BM /${blend} >>`)} gs`, `/${name} Do`, 'Q');
}

/**
 * A colour glyph's layers, nested in the groups each was painted in.
 *
 * @param writer - The write.
 * @param layers - The layers, in paint order.
 * @param groups - The groups they name.
 * @returns The operators.
 */
function layersOps(
  writer: Writer,
  layers: readonly VectorLayer[],
  groups: readonly VectorGroup[],
): string[] {
  const root: string[] = [];
  const open: OpenGroup[] = [];
  const opsOf = (depth: number): string[] => open[depth - 1]?.ops ?? root;
  // Closes the groups deeper than `depth`, innermost first, each into the one around it.
  const closeTo = (depth: number): void => {
    const closing = open.splice(depth).reverse();
    closing.forEach((group, index) => {
      const parent = closing[index + 1]?.ops ?? opsOf(depth);
      closeGroup(writer, group, groups[group.index], parent);
    });
  };
  for (const layer of layers) {
    let shared = 0;
    while (shared < open.length && open[shared]?.index === layer.groups[shared]) shared += 1;
    if (open.length > shared) closeTo(shared);
    for (const index of layer.groups.slice(shared)) open.push({ index, ops: [] });
    opsOf(open.length).push(...layerOps(writer, layer));
  }
  if (open.length > 0) closeTo(0);
  return root;
}

/**
 * A bitmap glyph as an image XObject drawn into its box (images are y up, the box y down); a PNG
 * that cannot be decoded is left out and warned about.
 *
 * @param writer - The write.
 * @param vector - The bitmap glyph.
 * @returns The operators.
 */
async function imageOps(
  writer: Writer,
  vector: Extract<VectorGlyph, { kind: 'image' }>,
): Promise<string[]> {
  const { image } = vector;
  const decoded =
    image.png === undefined
      ? bgraBitmap(image.bgra ?? new Uint8Array(0), image.pixelWidth, image.pixelHeight)
      : await decodePng(image.png);
  if (typeof decoded === 'string') {
    writer.warnings.add(`bitmap glyph left out: ${decoded}`);
    return [];
  }
  const name = `${writer.options.namePrefix}Im${String(Object.keys(writer.images).length + 1)}`;
  writer.images[name] = decoded;
  const n = formatNumber;
  const place = `${n(image.width)} 0 0 ${n(-image.height)} ${n(image.x)} ${n(image.y + image.height)} cm`;
  return ['q', place, `/${name} Do`, 'Q'];
}

/**
 * Raw BGRA pixels as RGB and alpha.
 *
 * @param bgra - The pixels.
 * @param width - The width.
 * @param height - The height.
 * @returns The bitmap.
 */
function bgraBitmap(bgra: Uint8Array, width: number, height: number): DecodedBitmap {
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const [b = 0, g = 0, r = 0, a = 0] = bgra.subarray(pixel * 4, pixel * 4 + 4);
    rgba.set([r, g, b, a], pixel * 4);
  }
  return splitSamples(rgba, 4, width, height);
}

/**
 * A laid-out text's vectors as PDF content: one `q … Q` (with `cm` when a transform is given),
 * each glyph in its own `q … Q`, and the resources it names (graphics states, shadings, images),
 * prefixed and defined once. Deterministic: the same inputs give the same content and names.
 *
 * @param layout - The text's layout, which the selectable text layer reads (the vectors carry
 *   everything drawn).
 * @param vectors - Its vectors (`textVectors`).
 * @param options - Colours, placement and names.
 * @returns The content, resources and warnings.
 */
export async function textPdf(
  layout: TextLayout,
  vectors: readonly VectorGlyph[],
  options: TextPdfOptions,
): Promise<TextPdf> {
  const writer: Writer = {
    options,
    states: new Map(),
    shadings: {},
    images: {},
    forms: {},
    warnings: new Set(),
  };
  const ops: string[] = ['q'];
  if (options.transform !== undefined) ops.push(`${matrixOperands(options.transform)} cm`);
  for (const vector of vectors) {
    if (vector.kind === 'image') ops.push(...(await imageOps(writer, vector)));
    else if (vector.kind === 'layers')
      ops.push('q', ...layersOps(writer, vector.layers, vector.groups), 'Q');
    else if (vector.pdf !== '')
      ops.push('q', ...solidFill(writer, options.colorOf(vector.fill), vector.pdf), 'Q');
  }
  const text =
    options.selectable === undefined
      ? undefined
      : pdfTextLayer(layout, options.selectable, options.namePrefix);
  ops.push(...(text?.ops ?? []), 'Q');
  const extGStates = Object.fromEntries(
    [...writer.states].map(([dictionary, name]) => [name, dictionary]),
  );
  return {
    content: `${ops.join('\n')}\n`,
    resources: {
      extGStates,
      shadings: writer.shadings,
      images: writer.images,
      forms: writer.forms,
      ...(text === undefined ? {} : { fonts: text.fonts }),
    },
    warnings: [...writer.warnings, ...(text?.warnings ?? [])],
  };
}
