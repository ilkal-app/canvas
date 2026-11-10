import type { TextLayout } from '@canvas/engine';
import type { Point, StyleRun } from '@canvas/schema';

import { linkSpansOf, type LinkSpan } from './runs/link-spans.js';
import { textOriginIn, worldToLocal } from './text-box-frame.js';
import type { TextEditingSession } from './text-session.js';

/** A link under a point of a laid-out text, and the box it shows in on the point's line. */
export interface LinkHit extends LinkSpan {
  /**
   * The link's characters on the line under the point, as a box from the layout's origin: from
   * the leftmost to the rightmost of their glyphs, the line box's top and height. A chip shows
   * under it.
   */
  readonly box: {
    /** Its left edge, from the layout's origin. */
    readonly x: number;
    /** The line box's top. */
    readonly y: number;
    /** From the leftmost to the rightmost of the link's glyphs on the line. */
    readonly width: number;
    /** The line box's height. */
    readonly height: number;
  };
}

/**
 * The link under a point of a laid-out text: the line whose box holds it, the
 * glyph whose box holds it, and the span of its run's link, with the box that span shows in on
 * that line. Undefined between lines, off every glyph and on a character without a link. Pure.
 *
 * @param layout - The laid-out text.
 * @param point - The point, from the layout's origin.
 * @param runs - The text's runs.
 * @returns The link, its span and box, or undefined.
 */
export function linkHitAtLayoutPoint(
  layout: TextLayout,
  point: Point,
  runs: readonly StyleRun[],
): LinkHit | undefined {
  const line = layout.lines.findIndex((at) => point.y >= at.y && point.y < at.y + at.height);
  const box = layout.lines[line];
  if (box === undefined) return undefined;
  const glyph = layout.glyphs.find(
    (at) => at.line === line && point.x >= at.x && point.x < at.x + at.advance,
  );
  if (glyph === undefined) return undefined;
  const span = linkSpansOf(runs).find((at) => glyph.index >= at.start && glyph.index < at.end);
  if (span === undefined) return undefined;
  let left = glyph.x;
  let right = glyph.x + glyph.advance;
  for (const at of layout.glyphs) {
    if (at.line !== line || at.index < span.start || at.index >= span.end) continue;
    left = Math.min(left, at.x);
    right = Math.max(right, at.x + at.advance);
  }
  return { ...span, box: { x: left, y: box.y, width: right - left, height: box.height } };
}

/**
 * The run link of the character under a point of a laid-out text: the link of
 * {@link linkHitAtLayoutPoint}. Pure.
 *
 * @param layout - The laid-out text.
 * @param point - The point, from the layout's origin.
 * @param runs - The text's runs.
 * @returns The link, or undefined.
 */
export function linkAtLayoutPoint(
  layout: TextLayout,
  point: Point,
  runs: readonly StyleRun[],
): string | undefined {
  return linkHitAtLayoutPoint(layout, point, runs)?.link;
}

/**
 * The run link under a world point in the text an editing session shows, for a
 * ⌘/Ctrl-press that opens it: its displayed content as laid out now.
 *
 * @param session - The session.
 * @param world - The point, world units.
 * @returns The link, or undefined.
 */
export function sessionLinkAt(session: TextEditingSession, world: Point): string | undefined {
  const object = session.object();
  const frame = session.frame();
  const layout = session.layout();
  if (object === undefined || frame === undefined || layout === undefined) return undefined;
  const local = worldToLocal(frame, world);
  const origin = textOriginIn(object, layout);
  return linkAtLayoutPoint(
    layout,
    { x: local.x - origin.x, y: local.y - origin.y },
    session.editor.runs,
  );
}
