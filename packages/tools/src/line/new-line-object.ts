import type { LineObject, Point } from '@canvas/schema';

import { strokeStyleOf } from '../stroke-style-of.js';

import type { LineStyle } from './line-context.js';

/**
 * What the line tool creates: a line object as the `createObject` input takes it, without the
 * fields the command fills in (stacking key, author and times); its id is chosen when the drag
 * starts, so the preview and the created line share it.
 */
export type NewLineObject = Omit<LineObject, 'z' | 'createdBy' | 'createdAt' | 'updatedAt'>;

/**
 * The line a drag of the line tool draws: at the board's root, its
 * origin on the drag's start and its points in its own frame, from there to the drag's end,
 * unturned, in the tool's style. Pure.
 *
 * @param id - The new line's id.
 * @param start - Where the drag started (snapped), world units.
 * @param end - Where it is now (snapped or constrained), world units.
 * @param style - The line tool's style.
 * @returns The line to create.
 */
export function newLineObject(
  id: LineObject['id'],
  start: Point,
  end: Point,
  style: LineStyle,
): NewLineObject {
  return {
    id,
    type: 'line',
    parentId: null,
    x: start.x,
    y: start.y,
    rotation: 0,
    locked: false,
    points: [
      { x: 0, y: 0 },
      { x: end.x - start.x, y: end.y - start.y },
    ],
    route: style.route,
    stroke: style.stroke,
    startCap: style.startCap,
    endCap: style.endCap,
    ...strokeStyleOf(style),
  };
}
