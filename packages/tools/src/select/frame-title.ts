import {
  clipChainOf,
  isInsideClipChain,
  sortTopmostFirst,
  worldTransformOf,
  type SceneSource,
  type SpatialSearch,
} from '@canvas/engine';
import {
  applyTransform,
  invertTransform,
  isFrameNameShown,
  type FrameObject,
  type ObjectId,
  type Point,
} from '@canvas/schema';

/**
 * How tall a frame's title band is, CSS px, whatever the zoom: the strip just above the
 * frame's top edge, across its width, where its name is drawn and where a click picks the frame.
 * The engine draws the frame's name there (its frame
 * title pass, whose `FRAME_TITLE_BAND_PX` this must equal).
 */
export const FRAME_TITLE_BAND_PX = 24;

/**
 * Whether a world point lies on a frame's title band: in the frame's own frame (so the band
 * turns with it), across its width and within {@link FRAME_TITLE_BAND_PX} / `zoom` above its
 * top edge, the edge itself excluded (that is the frame). Pure.
 *
 * @param frame - The frame.
 * @param source - The document, for the frame's ancestors.
 * @param point - The point, world units.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @returns True on the band.
 */
export function isOnFrameTitle(
  frame: FrameObject,
  source: SceneSource,
  point: Point,
  zoom: number,
): boolean {
  const local = applyTransform(invertTransform(worldTransformOf(frame, source)), point);
  const band = FRAME_TITLE_BAND_PX / zoom;
  return local.x >= 0 && local.x <= frame.width && local.y >= -band && local.y < 0;
}

/**
 * The topmost frame whose title band holds a world point. A band lies within its height of the
 * frame's world box, so the index is asked for the boxes that come that close to the point, and
 * the frames among them are tested exactly (`isOnFrameTitle`), filtered by the caller's rule,
 * and ordered as the board paints them (`sortTopmostFirst`). A frame whose name is hidden
 * (`isFrameNameShown`) has no band: it is picked by its body or a marquee. A band is
 * clipped as the frame is, by its clipping ancestors (`clipChainOf`): a nested frame's
 * band shows, and is picked, only where they keep it. Pure: reads the index and the document.
 *
 * @param index - The spatial index over the objects' world boxes.
 * @param source - The document the index mirrors.
 * @param point - The point, world units.
 * @param zoom - The camera zoom, CSS px per world unit; greater than 0.
 * @param isEligible - Which frames' bands count; all of them by default.
 * @returns The frame's id, or undefined off every eligible band.
 */
export function frameTitleAt(
  index: SpatialSearch,
  source: SceneSource,
  point: Point,
  zoom: number,
  isEligible: (frameId: ObjectId) => boolean = () => true,
): ObjectId | undefined {
  const band = FRAME_TITLE_BAND_PX / zoom;
  const near = index.searchRect({
    minX: point.x - band,
    minY: point.y - band,
    maxX: point.x + band,
    maxY: point.y + band,
  });
  const titles = near.filter((id) => {
    const object = source.get(id);
    return (
      object?.type === 'frame' &&
      isFrameNameShown(object, (ancestorId) => source.get(ancestorId)) &&
      isEligible(id) &&
      isOnFrameTitle(object, source, point, zoom) &&
      isInsideClipChain(point, clipChainOf(object, source))
    );
  });
  return sortTopmostFirst(titles, source)[0];
}

/**
 * Whether a world point lies above a frame's top edge, in the frame's own frame: where a double
 * press that activated the frame landed on its title band rather than its body (the select tool
 * picks a frame by its band, so a press above the edge that picked it was on the band). Pure.
 *
 * @param frame - The frame.
 * @param source - The document, for the frame's ancestors.
 * @param point - The point, world units.
 * @returns True above the top edge.
 */
export function isAboveFrameTop(frame: FrameObject, source: SceneSource, point: Point): boolean {
  return applyTransform(invertTransform(worldTransformOf(frame, source)), point).y < 0;
}
