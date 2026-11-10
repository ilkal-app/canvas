import {
  freehandFieldsOf,
  freehandTolerance,
  MAX_FREEHAND_POINTS,
  simplifyFreehand,
  smoothFreehand,
  splitFreehand,
  type FreehandObject,
  type FreehandSample,
  type ObjectId,
} from '@canvas/schema';

import type { DrawStyle } from './draw-style.js';

/**
 * What the draw tool creates: a freehand object as the `createObjects` input takes it, without
 * the fields the command fills in (stacking key, author and times).
 */
export type NewFreehandObject = Omit<FreehandObject, 'z' | 'createdBy' | 'createdAt' | 'updatedAt'>;

/** How strongly a stroke is smoothed before it is simplified (`smoothFreehand`). */
export const DRAW_SMOOTHING = 0.3;

/**
 * The freehand objects a gesture's samples make, before smoothing and simplification: the
 * samples split at the per-object cap, each piece an object whose origin is its first sample
 * and whose points are relative to it, in the tool's style. Pressures are kept only for the
 * marker; the pencil and the highlighter draw at a constant width. The draw tool previews these
 * while the stroke is drawn. Pure.
 *
 * @param samples - The samples, world units, in drawing order.
 * @param style - The draw tool's style, its colour resolved.
 * @param createId - Gives each piece's id.
 * @param max - The most points per object; `MAX_FREEHAND_POINTS` by default.
 * @returns One object per piece, in drawing order; none for no samples.
 */
export function freehandObjectsOf(
  samples: readonly FreehandSample[],
  style: DrawStyle,
  createId: () => ObjectId,
  max: number = MAX_FREEHAND_POINTS,
): NewFreehandObject[] {
  if (samples.length === 0) return [];
  const isPressured = style.tool === 'marker';
  return splitFreehand(samples, max).flatMap((piece) => {
    const origin = piece[0];
    if (origin === undefined) return [];
    const relative = piece.map(({ x, y, pressure }) =>
      isPressured && pressure !== undefined
        ? { x: x - origin.x, y: y - origin.y, pressure }
        : { x: x - origin.x, y: y - origin.y },
    );
    const object: NewFreehandObject = {
      id: createId(),
      type: 'freehand',
      parentId: null,
      x: origin.x,
      y: origin.y,
      rotation: 0,
      locked: false,
      tool: style.tool,
      ...freehandFieldsOf(relative),
      stroke: style.stroke,
      ...(style.opacity === undefined ? {} : { opacity: style.opacity }),
    };
    return [object];
  });
}

/**
 * The freehand objects a finished gesture draws: its samples smoothed
 * (`smoothFreehand` at {@link DRAW_SMOOTHING}, when there are three or more), simplified at half
 * a screen pixel for the zoom it was drawn at (`simplifyFreehand`, `freehandTolerance`), then
 * split and placed as {@link freehandObjectsOf} does. A press without movement is one sample:
 * a one-point dot. Pure.
 *
 * @param samples - The gesture's samples, world units, in drawing order.
 * @param style - The draw tool's style, its colour resolved.
 * @param zoom - The camera zoom the stroke was drawn at, CSS px per world unit.
 * @param createId - Gives each object's id.
 * @param max - The most points per object; `MAX_FREEHAND_POINTS` by default.
 * @returns The objects to create in one `createObjects`, in drawing order; none for no samples.
 */
export function newFreehandObjects(
  samples: readonly FreehandSample[],
  style: DrawStyle,
  zoom: number,
  createId: () => ObjectId,
  max: number = MAX_FREEHAND_POINTS,
): NewFreehandObject[] {
  // A constant-width stroke's pressures would only keep points the simplification could drop.
  const input = style.tool === 'marker' ? samples : samples.map(({ x, y }) => ({ x, y }));
  const smoothed = input.length >= 3 ? smoothFreehand(input, DRAW_SMOOTHING) : input;
  const simplified = simplifyFreehand(smoothed, freehandTolerance(zoom));
  return freehandObjectsOf(simplified, style, createId, max);
}
