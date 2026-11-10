import type { Point } from '@canvas/schema';
import type { TextLayout } from '@canvas/text';

import { GREEK_PAGE_RECT } from './greek-quads.js';
import type { PagedGlyphQuad } from './ordered-glyph-quads.js';

/**
 * A text's underlines and strikethroughs: one flat bar per segment the layout gives
 * (`TextLayout.decorations`), centred where the face puts the line and as thick (at least a
 * device pixel), in its run's colour. An underline under a link is left to the link's own,
 * so it is not drawn twice. The bars sample no page (`GREEK_PAGE_RECT`), as link
 * underlines do. Pure.
 *
 * @param layout - The laid-out text.
 * @param origin - Where the laid-out text starts in the object's frame (`textOriginOf`).
 * @param scale - Device pixels per world unit, which sets the thinnest bar.
 * @returns The bars, in the layout's order; none for text without decorations.
 */
export function decorationQuads(
  layout: TextLayout,
  origin: Point,
  scale: number,
): PagedGlyphQuad[] {
  const decorations = layout.decorations ?? [];
  if (decorations.length === 0) return [];
  const [u0, v0, u1, v1] = GREEK_PAGE_RECT;
  const quads: PagedGlyphQuad[] = [];
  for (const decoration of decorations) {
    const run = layout.runs[decoration.run];
    if (run === undefined) continue;
    if (decoration.kind === 'underline' && run.isLink === true) continue;
    const height = Math.max(decoration.thickness, 1 / scale);
    quads.push({
      pageId: 0,
      quad: {
        x: origin.x + decoration.x,
        y: origin.y + decoration.y - height / 2,
        width: decoration.width,
        height,
        u0,
        v0,
        u1,
        v1,
        color: run.color,
      },
    });
  }
  return quads;
}

/** Each layout's marker glyphs as a layout of their own, kept while the layout lives. */
const MARKER_LAYOUTS = new WeakMap<TextLayout, TextLayout | undefined>();

/**
 * A layout's list markers as a layout of glyphs alone, sharing its runs, so the glyph
 * quad builder draws them as it draws the text: the same faces, tiers and atlas. One object per
 * layout, so its quads are reused while the layout is.
 *
 * @param layout - The laid-out text.
 * @returns The markers' layout, or `undefined` when the text has no list.
 */
export function markerLayoutOf(layout: TextLayout): TextLayout | undefined {
  if (MARKER_LAYOUTS.has(layout)) return MARKER_LAYOUTS.get(layout);
  const markers = layout.markers ?? [];
  const markerLayout =
    markers.length === 0
      ? undefined
      : {
          ...layout,
          glyphs: markers.flatMap((marker) => marker.glyphs),
          markers: [],
          decorations: [],
        };
  MARKER_LAYOUTS.set(layout, markerLayout);
  return markerLayout;
}
