// The `glyphGeometry` job: HarfBuzz reads each glyph's outline, as the msdf job's
// raster fallback does (TrueType, CFF and CFF2 alike, at variable-font coordinates), and
// `tessellateGlyph` turns it into the vector tier's triangles, in the worker, so the rendering
// thread only uploads them.
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
import { FontCache } from '../msdf/font-cache.js';

import { glyphEdgeMesh } from './glyph-edge-mesh.js';
import { glyphEdges } from './glyph-edges.js';
import type {
  GlyphGeometryJobRequest,
  GlyphGeometryJobGlyph,
} from './glyph-geometry-job-payload.js';
import { DEFAULT_CUBIC_TOLERANCE_EM, tessellateGlyph } from './glyph-geometry.js';

/** The outline of a glyph the font lacks, or of any glyph of a font that cannot be read. */
const EMPTY_OUTLINE: GlyphOutline = { contours: [] };

/** Parsed fonts a handler keeps, for glyph ids, least recently used dropped first. */
const MAX_CACHED_FONTS = 8;

/**
 * Creates the handler of `glyphGeometry` jobs: the triangles of a batch of one face's glyphs, at
 * the request's coordinates and cubic tolerance. A glyph's id is the key's own (a shaped glyph)
 * or the font's for the codepoint; a codepoint the font lacks (glyph 0), and every glyph of a
 * font that cannot be read, has empty geometry, so a bad font never fails a job. The first job
 * waits for `loadShaper`.
 *
 * @returns The handler.
 */
export function createGlyphGeometryJobHandler(): JobHandler<'glyphGeometry'> {
  const parsedFonts = new FontCache<ParsedFont>(MAX_CACHED_FONTS, () => undefined);
  let shaper: Shaper | undefined;
  let shaperLoading: Promise<Shaper> | undefined;

  // The parsed font and the shaper's face of a request's bytes; none when they cannot be read.
  const read = (
    loaded: Shaper,
    request: GlyphGeometryJobRequest,
  ): { readonly font: ParsedFont; readonly face: ShapingFace } | undefined => {
    try {
      const font = parsedFonts.get(request.fontKey, () => parseFont(request.fontBytes));
      // The face's id is its font key, as the layout and msdf jobs load the same bytes.
      const bytes = new Uint8Array(request.fontBytes);
      return { font, face: loaded.face(request.fontKey, bytes, request.variations) };
    } catch {
      return undefined;
    }
  };

  const build = (loaded: Shaper, request: GlyphGeometryJobRequest): JobOutcome<'glyphGeometry'> => {
    const tolerance = request.toleranceEm ?? DEFAULT_CUBIC_TOLERANCE_EM;
    const source = read(loaded, request);
    const outlineOf = (key: GlyphKey): GlyphOutline => {
      if (source === undefined) return EMPTY_OUTLINE;
      const glyphId = glyphIdOfKey(key) ?? source.font.glyphIdOf(key);
      return glyphId === 0 ? EMPTY_OUTLINE : loaded.outline(source.face, glyphId);
    };
    const glyphs = request.keys.map((key): GlyphGeometryJobGlyph => {
      const outline = outlineOf(key);
      // The edge hulls the vector tier antialiases with.
      const edges = glyphEdgeMesh(glyphEdges(outline, { toleranceEm: tolerance }));
      return { key, ...tessellateGlyph(outline, tolerance), edges };
    });
    return {
      response: { faceId: request.faceId, glyphs },
      transfer: glyphs.flatMap(({ vertices, edges }) =>
        edges === undefined ? [vertices.buffer] : [vertices.buffer, edges.vertices.buffer],
      ),
    };
  };

  return (request) => {
    if (shaper !== undefined) return build(shaper, request);
    shaperLoading ??= loadShaper().then((loaded) => {
      shaper = loaded;
      return loaded;
    });
    return shaperLoading.then((loaded) => build(loaded, request));
  };
}
