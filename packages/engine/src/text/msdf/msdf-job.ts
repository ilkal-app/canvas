import {
  loadShaper,
  parseFont,
  type GlyphOutline,
  type ParsedFont,
  type Shaper,
  type ShapingFace,
} from '@canvas/text';

import type { JobHandler, JobOutcome } from '../../workers/job-handlers.js';
import { glyphIdOfKey, type GlyphKey } from '../atlas/glyph-key.js';
import type { ColourCanvasFactory } from '../colour/colour-canvas.js';
import { withColourGlyphs } from '../colour/colour-glyph-job.js';

import { FontCache } from './font-cache.js';
import { generateMsdfGlyph, loadMsdfgenFont } from './msdf-generator.js';
import { fontBytesOf, type GeneratedGlyph, type MsdfJobRequest } from './msdf-job-payload.js';
import type { MsdfgenFont, MsdfgenModule, MsdfgenModuleLoader } from './msdfgen-module.js';
import { rasterizeSdfGlyph } from './sdf-rasterizer.js';

/** Fonts a handler keeps loaded (in msdfgen, and parsed for the fallback) by default. */
const DEFAULT_MAX_CACHED_FONTS = 8;

/** How to build an `msdf` job handler. */
export interface MsdfJobHandlerOptions {
  /** Instantiates msdfgen; without it every job uses the raster fallback. */
  readonly loadMsdfgen?: MsdfgenModuleLoader;
  /** Fonts to keep loaded per handler, least recently used dropped first. Default 8. */
  readonly maxCachedFonts?: number;
  /** Rasterises colour glyphs as colour bitmaps; without it they draw as outlines. */
  readonly colourCanvas?: ColourCanvasFactory;
}

/**
 * Whether a request draws a variable font at coordinates other than its defaults.
 *
 * @param request - The request.
 * @returns True when it carries coordinates.
 */
function isVaried(request: MsdfJobRequest): boolean {
  return Object.keys(request.variations ?? {}).length > 0;
}

/**
 * Creates the handler of `msdf` jobs: glyph distance fields for a batch of characters of one
 * face at one tier. It runs in a job worker (or the pool's
 * main-thread fallback) and ports the prototype's msdfgen worker (`src/atlas/msdfSource.ts`)
 * onto the pool's protocol. With `loadMsdfgen` it instantiates msdfgen on its first job and
 * generates MSDF glyphs; the raster fallback (`rasterizeSdfGlyph`, single channel, from
 * HarfBuzz's outlines of the font, so CFF and CFF2 faces draw too; the first raster job
 * waits for `loadShaper`) serves every job when there is no loader, the module fails to load, or
 * msdfgen cannot read the font, and whenever the request asks for `sdf`.
 *
 * Only the first jobs wait for the module; afterwards a job runs synchronously, so on the
 * main-thread fallback its work counts against the frame budget. msdfgen holds per-font state,
 * but no job yields between loading a font and generating from it, so jobs in flight together
 * cannot interleave (the prototype serialised calls for its asynchronous worker).
 *
 * @param options - The msdfgen loader and the font cache size.
 * @returns The handler.
 */
export function createMsdfJobHandler(options: MsdfJobHandlerOptions = {}): JobHandler<'msdf'> {
  const capacity = options.maxCachedFonts ?? DEFAULT_MAX_CACHED_FONTS;
  const parsedFonts = new FontCache<ParsedFont>(capacity, () => undefined);
  const msdfgenFonts = new FontCache<MsdfgenFont | undefined>(capacity, (font) => font?.delete());
  const field = fieldHandler(options, { parsedFonts, msdfgenFonts });
  const handler = withColourOption(field, options.colourCanvas, parsedFonts);
  // The font file comes as the job's resource (sent to each worker once), else in the
  // request; the handler reads it from the request.
  return (request, context) => {
    const resource = context?.resource(request.fontKey);
    return handler(resource === undefined ? request : { ...request, fontBytes: resource }, context);
  };
}

/** A handler's font caches. */
interface FieldFonts {
  /** Parsed faces, shared with the colour step. */
  readonly parsedFonts: FontCache<ParsedFont>;
  /** msdfgen's loaded faces; undefined for one it cannot load. */
  readonly msdfgenFonts: FontCache<MsdfgenFont | undefined>;
}

/**
 * The distance-field handler: msdfgen when it loads, else the raster fallback.
 *
 * @param options - The msdfgen loader.
 * @param fonts - The handler's font caches.
 * @returns The handler.
 */
function fieldHandler(options: MsdfJobHandlerOptions, fonts: FieldFonts): JobHandler<'msdf'> {
  const { parsedFonts, msdfgenFonts } = fonts;
  let module: MsdfgenModule | undefined;
  let loading: Promise<void> | undefined;
  let shaper: Shaper | undefined;
  let shaperLoading: Promise<Shaper> | undefined;

  // The raster fallback draws HarfBuzz's outlines (TrueType, CFF and CFF2 alike); glyph
  // ids and advances come from our parser. A face either cannot read draws every glyph empty.
  const rasterizeWith = (loaded: Shaper, request: MsdfJobRequest): JobOutcome<'msdf'> => {
    let font: ParsedFont;
    let face: ShapingFace;
    try {
      font = parsedFonts.get(request.fontKey, () => parseFont(fontBytesOf(request)));
      // The face's id is its font key: the layout jobs shape the same bytes under the same id, at
      // the same coordinates.
      face = loaded.face(request.fontKey, new Uint8Array(fontBytesOf(request)), request.variations);
    } catch {
      return outcome(request, () => rasterizeSdfGlyph({ contours: [] }, 0, request.tier));
    }
    return outcome(request, (key) =>
      rasterize(font, (glyph) => loaded.outline(face, glyph), key, request.tier),
    );
  };

  const fallback = (request: MsdfJobRequest): JobOutcome<'msdf'> | Promise<JobOutcome<'msdf'>> => {
    if (shaper !== undefined) return rasterizeWith(shaper, request);
    shaperLoading ??= loadShaper().then((loaded) => {
      shaper = loaded;
      return loaded;
    });
    return shaperLoading.then((loaded) => rasterizeWith(loaded, request));
  };

  const generate = (request: MsdfJobRequest): JobOutcome<'msdf'> | Promise<JobOutcome<'msdf'>> => {
    if (module === undefined || request.field === 'sdf') return fallback(request);
    const loaded = module;
    const font = msdfgenFonts.get(request.fontKey, () => {
      try {
        return loadMsdfgenFont(loaded, fontBytesOf(request));
      } catch {
        return undefined;
      }
    });
    if (font === undefined) return fallback(request);
    // msdfgen finds glyphs by codepoint only. A shaped glyph that a character maps to (most of
    // them: HarfBuzz gives every glyph an id) is generated through that character, so it is the
    // same glyph; one no character maps to (a ligature, a contextual form, a conjunct) takes the
    // raster fallback by its glyph id. The font is parsed only when the batch holds a shaped key.
    return outcome(request, (key) => {
      const glyphId = glyphIdOfKey(key);
      if (glyphId === undefined) return generateMsdfGlyph(font, key, request.tier);
      const parsed = parsedFonts.get(request.fontKey, () => parseFont(fontBytesOf(request)));
      const codepoint = characterOfGlyph(parsed, glyphId);
      return codepoint === undefined
        ? rasterize(parsed, (glyph) => parsed.outlineOf(glyph), key, request.tier)
        : generateMsdfGlyph(font, codepoint, request.tier);
    });
  };

  return (request) => {
    const loader = options.loadMsdfgen;
    // msdfgen reads the default instance only: glyphs at coordinates are HarfBuzz's.
    if (request.field === 'sdf' || loader === undefined || isVaried(request)) {
      return fallback(request);
    }
    loading ??= loader().then(
      (loaded) => {
        module = loaded;
      },
      () => undefined,
    );
    return module === undefined ? loading.then(() => generate(request)) : generate(request);
  };
}

/**
 * The handler with the colour step when there is a colour canvas, sharing the
 * handler's parsed fonts.
 *
 * @param handler - The distance-field handler.
 * @param canvas - The colour canvas, if any.
 * @param parsedFonts - The handler's parsed-font cache.
 * @returns The handler.
 */
function withColourOption(
  handler: JobHandler<'msdf'>,
  canvas: ColourCanvasFactory | undefined,
  parsedFonts: FontCache<ParsedFont>,
): JobHandler<'msdf'> {
  if (canvas === undefined) return handler;
  return withColourGlyphs(handler, canvas, {
    parse: (request) => parsedFonts.get(request.fontKey, () => parseFont(fontBytesOf(request))),
  });
}

/** Per parsed font, each glyph some character maps to and the lowest such character. */
const charactersOfGlyphs = new WeakMap<ParsedFont, ReadonlyMap<number, number>>();

/**
 * The character a font maps to a glyph, for msdfgen, which finds glyphs by codepoint only.
 *
 * @param font - The parsed font.
 * @param glyphId - The glyph.
 * @returns The lowest codepoint whose glyph it is; undefined when no character maps to it.
 */
function characterOfGlyph(font: ParsedFont, glyphId: number): number | undefined {
  let characters = charactersOfGlyphs.get(font);
  if (characters === undefined) {
    const built = new Map<number, number>();
    // Ascending codepoint order, so the first character seen for a glyph is its lowest.
    for (const [codepoint, glyph] of font.characterMap()) {
      if (!built.has(glyph)) built.set(glyph, codepoint);
    }
    characters = built;
    charactersOfGlyphs.set(font, characters);
  }
  return characters.get(glyphId);
}

/**
 * A glyph's raster signed distance field, by its glyph id when it was shaped, else by its
 * codepoint's glyph.
 *
 * @param font - The parsed font: the glyph id and advance.
 * @param outlineOf - The glyph's outline (HarfBuzz's on the raster fallback).
 * @param key - The glyph's key.
 * @param tier - Texels per em.
 * @returns Its field and metrics; empty for a codepoint the font lacks.
 */
function rasterize(
  font: ParsedFont,
  outlineOf: (glyphId: number) => GlyphOutline,
  key: GlyphKey,
  tier: number,
): GeneratedGlyph['bitmap'] {
  const glyphId = glyphIdOfKey(key) ?? font.glyphIdOf(key);
  const outline = glyphId === 0 ? { contours: [] } : outlineOf(glyphId);
  return rasterizeSdfGlyph(outline, font.advanceOf(glyphId), tier);
}

function outcome(
  request: MsdfJobRequest,
  generate: (key: GlyphKey) => GeneratedGlyph['bitmap'],
): JobOutcome<'msdf'> {
  const glyphs = request.keys.map((key) => ({ key, bitmap: generate(key) }));
  return {
    response: { faceId: request.faceId, tier: request.tier, glyphs },
    transfer: glyphs.map(({ bitmap }) => bitmap.pixels.buffer),
  };
}
