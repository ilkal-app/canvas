import type { HitRectMode, WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import type { ScreenPoint } from '../camera/camera-moves.js';

import type { ResizeHandle } from './handle-layout.js';
import type { MarqueeHits } from './marquee-hits.js';
import { boxCentreOf, type OrientedBox } from './oriented-box.js';
import { FREE_RESIZE, isProportionalResize, type ResizeAspect } from './resize-aspect.js';
import { resizeFrame } from './resize-frame.js';
import { rotationAngle } from './rotation-angle.js';
import type { SelectHitTester } from './select-hit-tester.js';
import type { SelectPointer } from './select-input.js';
import type { SelectIntent } from './select-intent.js';
import type { PressTarget, SelectToolContext } from './select-press.js';

/** What a drag does, fixed when it starts. */
export type SelectDrag =
  | {
      /** Moves the selection. */
      readonly kind: 'move';
    }
  | {
      /** Resizes the selection by a handle. */
      readonly kind: 'resize';
      /** The handle. */
      readonly handle: ResizeHandle;
      /** The frame when the drag began. */
      readonly from: OrientedBox;
      /** How the resize keeps its aspect (an image's: proportional unless Shift is held). */
      readonly aspect: ResizeAspect;
    }
  | {
      /** Turns the selection about its centre. */
      readonly kind: 'rotate';
      /** The frame when the drag began. */
      readonly from: OrientedBox;
      /** The frame's centre, world units. */
      readonly pivot: Point;
    }
  | {
      /** Draws a marquee. */
      readonly kind: 'marquee';
      /** Whether Shift was held at the press: the hits add to `previousIds`. */
      readonly isAdditive: boolean;
      /** The selection before the press, restored when the marquee is cancelled. */
      readonly previousIds: readonly ObjectId[];
      /** The innermost entered group at the press: the marquee takes only what is inside it. */
      readonly enteredGroupId: ObjectId | null;
      /** The drag's hits kept between moves, filled on the first move. */
      readonly hits?: {
        /** The tracker the drag's moves update. */
        tracker?: MarqueeHits;
        /** The hit tester it was made by: another one makes a new tracker. */
        tester?: SelectHitTester;
      };
    }
  | {
      /** Pans the view: a finger's drag from empty board. */
      readonly kind: 'pan';
      /** Where the finger was last reported, CSS px on the viewport. */
      readonly last: ScreenPoint;
    };

/**
 * The drag a press starts once the pointer passes the click threshold.
 *
 * @param target - What the press landed on.
 * @param isShiftPressed - Whether Shift was held at the press.
 * @param previousIds - The selection before the press.
 * @param enteredGroupId - The innermost entered group, or null at the top level.
 * @returns The drag.
 */
export function beginDrag(
  target: PressTarget,
  isShiftPressed: boolean,
  previousIds: readonly ObjectId[],
  enteredGroupId: ObjectId | null = null,
): SelectDrag {
  switch (target.kind) {
    case 'handle':
      return {
        kind: 'resize',
        handle: target.handle,
        from: target.frame,
        aspect: target.aspect ?? FREE_RESIZE,
      };
    case 'rotation':
      return { kind: 'rotate', from: target.frame, pivot: boxCentreOf(target.frame) };
    case 'empty':
      return { kind: 'marquee', isAdditive: isShiftPressed, previousIds, enteredGroupId, hits: {} };
    default:
      return { kind: 'move' };
  }
}

/**
 * A Shift move keeps only its larger component.
 *
 * @param delta - The displacement.
 * @returns The displacement along its dominant axis.
 */
function lockToAxis(delta: Point): Point {
  return Math.abs(delta.x) >= Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y };
}

/**
 * The marquee between the press and the pointer.
 *
 * @param from - The press, world units.
 * @param to - The pointer, world units.
 * @returns The rectangle, world units.
 */
function marqueeRect(from: Point, to: Point): WorldBounds {
  return {
    minX: Math.min(from.x, to.x),
    minY: Math.min(from.y, to.y),
    maxX: Math.max(from.x, to.x),
    maxY: Math.max(from.y, to.y),
  };
}

/**
 * The intent of a drag with the pointer at `pointer`, measured from the press: the move's
 * displacement (axis-locked with Shift), the handle's resized frame (proportional with Shift, or
 * for an image proportional unless Shift is held, at its drawn aspect: `ResizeAspect`),
 * the turn about the frame's centre (snapped to 15° with Shift), or the marquee and what it
 * selects (`intersect` dragging right, `contain` dragging left, as in common tools). Pure.
 *
 * @param drag - The drag.
 * @param start - Where the press was, world units.
 * @param pointer - The pointer now.
 * @param context - The hit tester, for the marquee.
 * @returns The intent.
 */
export function dragIntent(
  drag: SelectDrag,
  start: Point,
  pointer: SelectPointer,
  context: SelectToolContext,
): SelectIntent {
  const { world, isShiftPressed } = pointer;
  const delta = { x: world.x - start.x, y: world.y - start.y };
  switch (drag.kind) {
    case 'move':
      return {
        type: 'move',
        delta: isShiftPressed ? lockToAxis(delta) : delta,
        isAxisLocked: isShiftPressed,
      };
    case 'resize': {
      const isProportional = isProportionalResize(drag.aspect, isShiftPressed);
      const { aspect } = drag.aspect;
      return {
        type: 'resize',
        handle: drag.handle,
        delta,
        isProportional,
        ...(isProportional && aspect !== undefined ? { aspect } : {}),
        from: drag.from,
        to: resizeFrame(drag.from, drag.handle, delta, isProportional, aspect),
      };
    }
    case 'rotate':
      return {
        type: 'rotate',
        angle: rotationAngle(drag.pivot, start, world, drag.from.rotation, isShiftPressed),
        isSnapped: isShiftPressed,
        pivot: drag.pivot,
        from: drag.from,
      };
    case 'pan':
      return panIntent(drag, pointer);
    case 'marquee': {
      const rect = marqueeRect(start, world);
      const mode = world.x >= start.x ? 'intersect' : 'contain';
      const hits = marqueeHits(drag, context, rect, mode);
      const ids = drag.isAdditive ? [...new Set([...drag.previousIds, ...hits])] : hits;
      return { type: 'marquee', rect, mode, ids };
    }
  }
}

/**
 * A pan's intent: the finger's movement on screen since its last report. Pure.
 *
 * @param drag - The pan.
 * @param pointer - The finger now.
 * @returns The intent.
 */
function panIntent(
  drag: Extract<SelectDrag, { readonly kind: 'pan' }>,
  pointer: SelectPointer,
): SelectIntent {
  const { x, y } = pointer.screen;
  return { type: 'pan', deltaXPx: x - drag.last.x, deltaYPx: y - drag.last.y };
}

/**
 * A marquee move's hits: from the drag's tracker when the hit tester offers one, kept
 * across moves and started over when the document changes; else a fresh `hitRect`.
 *
 * @param drag - The marquee drag.
 * @param context - The tool's context: the hit tester and the document's change count.
 * @param rect - The marquee, world units.
 * @param mode - Touching or enclosing.
 * @returns The selected ids, topmost first.
 */
function marqueeHits(
  drag: Extract<SelectDrag, { readonly kind: 'marquee' }>,
  context: SelectToolContext,
  rect: WorldBounds,
  mode: HitRectMode,
): readonly ObjectId[] {
  const { hitTester } = context;
  const { hits } = drag;
  if (hits === undefined || hitTester.marquee === undefined)
    return hitTester.hitRect(rect, mode, drag.enteredGroupId);
  if (hits.tester !== hitTester || hits.tracker === undefined) {
    hits.tester = hitTester;
    hits.tracker = hitTester.marquee();
  }
  return hits.tracker.update(rect, mode, drag.enteredGroupId, context.documentGeneration ?? 0);
}
