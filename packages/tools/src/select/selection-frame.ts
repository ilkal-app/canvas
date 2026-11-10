import { resolveConnectorShape } from '@canvas/engine';
import type { ConnectorObject, ObjectId, Rect } from '@canvas/schema';

import { boxAround, boxCornersOf, type OrientedBox } from './oriented-box.js';
import {
  farAmong,
  orientedBoxOf,
  placedBoxOf,
  type SelectionSource,
} from './selection-geometry.js';

/**
 * A connector's bounds in its own frame: the box round the route it draws on the document as it
 * is now (`resolveConnectorShape`), a curve's control points included, as a path's bounds include
 * its handles.
 *
 * @param connector - The connector.
 * @param source - The document, for its targets.
 * @returns The bounds, or undefined when the route has no point.
 */
function connectorRect(connector: ConnectorObject, source: SelectionSource): Rect | undefined {
  const { path } = resolveConnectorShape(connector, source);
  const around = boxAround([...path.route, ...(path.curve ?? [])]);
  return around && { x: around.x, y: around.y, width: around.width, height: around.height };
}

/**
 * The box the selection outlines and frames an object by: its
 * `orientedBoxOf`, or for a connector, which has no box of its own to snap to, arrange or drop by,
 * the box round the route it draws now, turned and placed by its world transform. Pure.
 *
 * @param id - The object's id.
 * @param source - The document.
 * @returns The box, world units, or undefined as for `orientedBoxOf`.
 */
export function selectionBoxOf(id: ObjectId, source: SelectionSource): OrientedBox | undefined {
  const object = source.get(id);
  if (object?.type !== 'connector') return orientedBoxOf(id, source);
  if (source.isDrawable?.(id) === false) return undefined;
  const rect = connectorRect(object, source);
  return rect && placedBoxOf(object, rect, source);
}

/**
 * The selection frame the handles sit on: one object's own turned box (`selectionBoxOf`), or for
 * several objects the axis-aligned box around all of theirs, far objects left out (a
 * transform skips them, so the handles, the pivot and the origin come from the rest). Pure.
 *
 * @param ids - The selected ids.
 * @param source - The document.
 * @param far - The selected objects that are far, when already worked out (`selectionScopeOf`).
 * @returns The frame, world units, or undefined when nothing near that is selected has geometry.
 */
export function selectionFrameOf(
  ids: readonly ObjectId[],
  source: SelectionSource,
  far?: ReadonlySet<ObjectId>,
): OrientedBox | undefined {
  const isFar = farAmong(ids, source, far);
  const near = ids.filter((id) => !isFar.has(id));
  const boxes = near.flatMap((id) => selectionBoxOf(id, source) ?? []);
  if (ids.length === 1) return boxes[0];
  if (near.length < ids.length && boxes.length === 1) return boxes[0];
  return boxAround(boxes.flatMap(boxCornersOf));
}
