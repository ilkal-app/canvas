import {
  hitRect,
  hitTopmost,
  pickFlattenBucket,
  readFill,
  sortTopmostFirst,
  type HitPointOptions,
  type HitRectMode,
  type SpatialSearch,
  type WorldBounds,
} from '@canvas/engine';
import { isPaintVisible, type ObjectId, type Point } from '@canvas/schema';

import { isInsideEnteredGroup, scopeOfTarget } from './entered-group.js';
import { frameTitleAt } from './frame-title.js';
import { isMarqueeEligible } from './marquee-eligibility.js';
import { MarqueeHits, type MarqueeSelect } from './marquee-hits.js';
import {
  isAncestorOf,
  selectTargetOf,
  unlockedTopmostIds,
  type SelectionSource,
} from './selection-geometry.js';

/**
 * What a press landed on: an object's own geometry, a
 * frame's title band, or a frame's background. The press decides what each does: a background
 * is passed through to start a marquee unless mod is held.
 */
export interface PointHit {
  /**
   * The id a click would select: the object, or its outermost group not entered
   * (`selectTargetOf`).
   */
  readonly id: ObjectId;
  /**
   * The entered group that id sits in (`scopeOfTarget`), which a press on it makes the
   * innermost entered group: the entered level, an outer entered level, or null when the hit
   * is outside every entered group.
   */
  readonly scope: ObjectId | null;
  /**
   * `object`: an object other than a frame; `title`: a frame's title band
   * (`FRAME_TITLE_BAND_PX`); `background`: a frame's own area where no child is.
   */
  readonly part: 'object' | 'title' | 'background';
}

/**
 * How the select tool asks what is under the pointer: injected, so the tool's state machine is
 * tested without an index, and the app answers from its R-tree.
 */
export interface SelectHitTester {
  /**
   * Whether a hit frame paints above every selected object, blocking the selection interior.
   * Required for injected implementations. A frame between selected objects does not block
   * the multi-selection interior; it must paint above every selected object.
   *
   * @param frameId - The background hit.
   * @param ids - The selection.
   * @returns True when that frame is frontmost.
   */
  isAboveSelection(frameId: ObjectId, ids: readonly ObjectId[]): boolean;
  /**
   * What a press at a point lands on: the topmost object there unless it is a frame, then the
   * topmost title band there of a frame inside that frame (any frame's over empty board), then
   * the topmost frame's background.
   *
   * @param point - The pointer, world units.
   * @param zoom - The camera zoom, CSS px per world unit, for the stroke tolerance and the
   *   title band's height.
   * @param enteredGroupId - The innermost entered group, or null or omitted at the top
   *   level: grouped objects inside it are selected at its level.
   * @returns The hit, or undefined over empty board.
   */
  hitPoint(point: Point, zoom: number, enteredGroupId?: ObjectId | null): PointHit | undefined;
  /**
   * What a marquee selects: the objects it touches (`intersect`) or encloses (`contain`), as
   * groups, frames only when enclosed (`isMarqueeEligible`), without locked objects or objects
   * whose parent it takes as well.
   *
   * @param rect - The marquee, world units.
   * @param mode - Touching or enclosing.
   * @param enteredGroupId - The innermost entered group, or null or omitted at the top
   *   level: with one, the marquee takes only what is inside it, at its level.
   * @returns The ids, topmost first.
   */
  hitRect(
    rect: WorldBounds,
    mode: HitRectMode,
    enteredGroupId?: ObjectId | null,
  ): readonly ObjectId[];
  /**
   * A marquee drag's hits kept between pointer moves: the same answers as `hitRect`,
   * testing only what a move changed. Absent, a marquee calls `hitRect` on every move.
   *
   * @returns A tracker for one drag.
   */
  marquee?(): MarqueeHits;
  /**
   * The top-most frame whose area holds a point, among the frames the caller accepts: where a
   * moved object whose centre is there lands.
   *
   * @param point - The point, world units.
   * @param isEligible - Whether a frame may take the object (not the object, nothing inside it,
   *   nothing that moves with it).
   * @returns The frame's id, or undefined when no accepted frame holds the point.
   */
  frameAt(point: Point, isEligible: (frameId: ObjectId) => boolean): ObjectId | undefined;
}

/**
 * The select tool's hit tester over the engine's spatial queries (`hitPoint`, `hitRect` of
 * `@canvas/engine`, exact geometry, stroke tolerance from the zoom), mapping hits to what the
 * person selects: a grouped object selects its outermost group; a frame is picked by its title
 * band, its background reported as such so the tool can pass a plain press through; a marquee
 * takes a frame only when it encloses it and, in `contain` mode, a group only when it encloses
 * the whole group; locked objects are dropped from a marquee before the objects their taken
 * ancestor carries, so a locked frame never hides its children; a moved object lands in the
 * top-most accepted frame under its centre. Pure: reads the index and the document.
 *
 * @param index - The spatial index over the objects' world boxes, kept in step with `source`.
 * @param source - The document.
 * @param devicePixelRatio - The canvas's device pixel ratio now, so paths are flattened as the
 *   renderer draws them (the camera's `dpr`). Default 1.
 * @param paletteOf - What an object's colour tokens resolve in (`hitPaletteOf`), so a shape fill
 *   or frame background token transparent in its mode is picked as no fill; the light
 *   theme's built-ins when absent.
 * @returns The hit tester.
 */
export function createSelectHitTester(
  index: SpatialSearch,
  source: SelectionSource,
  devicePixelRatio: () => number = () => 1,
  paletteOf?: HitPointOptions['paletteOf'],
): SelectHitTester {
  // What a marquee's raw hits select: their targets, eligible and topmost (shared with MarqueeHits).
  const select: MarqueeSelect = (raw, rect, mode, enteredGroupId) => {
    const targets = new Set(raw.map((id) => selectTargetOf(id, source, enteredGroupId)));
    const eligible = [...targets].filter(
      (id) =>
        source.get(id)?.locked === false &&
        isInsideEnteredGroup(id, enteredGroupId, source) &&
        isMarqueeEligible(id, rect, mode, source),
    );
    return unlockedTopmostIds(eligible, source);
  };
  // The flattening bucket's hysteresis state, as the path pass keeps its own across frames.
  let flattenBucket: number | undefined;
  return {
    isAboveSelection(frameId, ids) {
      return sortTopmostFirst([frameId, ...ids], source)[0] === frameId;
    },
    hitPoint(point, zoom, enteredGroupId = null) {
      const hitOf = (id: ObjectId, part: PointHit['part']): PointHit => {
        const target = selectTargetOf(id, source, enteredGroupId);
        return { id: target, part, scope: scopeOfTarget(target, source, enteredGroupId) };
      };
      const dpr = devicePixelRatio();
      flattenBucket = pickFlattenBucket(zoom * dpr, flattenBucket);
      const options = { zoom, dpr, flattenBucket, ...(paletteOf && { paletteOf }) };
      // Top down, stopping at the first hit: a frame whose background paints nothing
      // is passed over, as if not there.
      const top = hitTopmost(
        index,
        source,
        point,
        options,
        (object) =>
          object.type !== 'frame' ||
          isPaintVisible(readFill(object.background, paletteOf?.(object))),
      );
      if (top !== undefined && source.get(top)?.type !== 'frame') return hitOf(top, 'object');
      // A band is sized on screen, so zoomed out it reaches over neighbouring frames: it beats
      // a frame's background only when that frame holds the band's frame (a nested title), or
      // over empty board.
      const title = frameTitleAt(
        index,
        source,
        point,
        zoom,
        (frameId) => top === undefined || isAncestorOf(top, frameId, source),
      );
      if (title !== undefined) return hitOf(title, 'title');
      return top === undefined ? undefined : hitOf(top, 'background');
    },
    hitRect(rect, mode, enteredGroupId = null) {
      return select(hitRect(index, source, rect, mode), rect, mode, enteredGroupId);
    },
    marquee: () => new MarqueeHits(index, source, select),
    frameAt(point, isEligible) {
      // A frame is a box, which takes no stroke tolerance, so the zoom does not matter.
      return hitTopmost(
        index,
        source,
        point,
        { zoom: 1, tolerancePx: 0 },
        (object) => object.type === 'frame' && isEligible(object.id),
      );
    },
  };
}
