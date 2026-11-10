import { DRAFT_PREVIEW_Z } from '@canvas/schema';

import type { DrawnPath } from './drawn-path.js';

/**
 * A stroke with this many mesh segments or fewer, without a mesh yet, is one just begun: its first
 * mesh is built in the frame, so the first points of a stroke show at once. A board's
 * strokes loading for the first time take the builder, past the frame's segment budget.
 */
export const FRESH_STROKE_SEGMENTS = 32;

/**
 * The most mesh segments a frame meshes itself: one full freehand piece
 * (`MAX_FREEHAND_POINTS`), about 0.7 ms at the median on an M1 Max. Past it, and for a path larger
 * than it, the builder takes the mesh and a stand-in draws meanwhile, so many strokes changing at
 * once (an undo, an eraser, collaborators) never mesh all in one frame.
 */
export const INLINE_MESH_SEGMENTS_PER_FRAME = 1024;

/**
 * The most mesh segments a frame gives the live stroke outside its budgets: two pieces,
 * since the move that fills a piece also starts the next, and both previews change in that frame.
 */
export const LIVE_STROKE_SEGMENTS_PER_FRAME = 2 * INLINE_MESH_SEGMENTS_PER_FRAME;

/**
 * Whether a path's mesh is built in the frame rather than by the mesh builder: a connector drawn
 * before and re-routed since (its geometry changed), and a stroke being drawn: one drawn
 * before whose points changed, or one just begun ({@link FRESH_STROKE_SEGMENTS} or fewer). So a
 * live stroke's ink follows the pen in the frame its points arrive, and its first points show at
 * once, instead of an older stand-in, or nothing, until the builder answers a frame or more
 * later; only while the frame's inline allowance ({@link INLINE_MESH_SEGMENTS_PER_FRAME}) holds
 * it. Pure.
 *
 * @param type - The path's object type.
 * @param hasOlderVersion - Whether a mesh of an older version of it is cached.
 * @param segments - Its mesh segments (`meshSegmentsOf`).
 * @param inlineSegments - The segments the frame has meshed itself so far.
 * @returns True to mesh it now.
 */
export function isMeshedInline(
  type: DrawnPath['type'],
  hasOlderVersion: boolean,
  segments: number,
  inlineSegments: number,
): boolean {
  if (type !== 'connector' && type !== 'freehand') return false;
  if (inlineSegments + segments > INLINE_MESH_SEGMENTS_PER_FRAME) return false;
  return hasOlderVersion || (type === 'freehand' && segments <= FRESH_STROKE_SEGMENTS);
}

/**
 * Whether a path is a stroke being drawn: the draw tool's live preview, a freehand path
 * on the draft key (`DRAFT_PREVIEW_Z`, which no stored object has), no larger than one piece
 * ({@link INLINE_MESH_SEGMENTS_PER_FRAME}). Its pieces are meshed in the frame outside the shared
 * segment budget and the inline allowance, up to {@link LIVE_STROKE_SEGMENTS_PER_FRAME} (the
 * filled piece and the next at a boundary), so other paths' builds (a zoom's buckets, an undo)
 * never leave the ink behind. Pure.
 *
 * @param object - The path.
 * @param segments - Its mesh segments (`meshSegmentsOf`).
 * @returns True for a live stroke.
 */
export function isLiveStroke(object: DrawnPath, segments: number): boolean {
  return (
    object.type === 'freehand' &&
    object.z === DRAFT_PREVIEW_Z &&
    segments <= INLINE_MESH_SEGMENTS_PER_FRAME
  );
}
