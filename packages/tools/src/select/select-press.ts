import type { WorldBounds } from '@canvas/engine';
import type { ObjectId, Point } from '@canvas/schema';

import { countBadgeLayout } from './count-badge.js';
import { hitHandle, type ResizeAbility, type ResizeHandle } from './handle-layout.js';
import { isInsideBox, type OrientedBox } from './oriented-box.js';
import type { ResizeAspect } from './resize-aspect.js';
import { hitRotationBand, type SelectionCorner } from './rotation-band.js';
import type { SelectHitTester } from './select-hit-tester.js';
import type { SelectPointer, SelectPointerType } from './select-input.js';
import type { SelectIntent } from './select-intent.js';
import { MAX_OUTLINED_OBJECTS } from './selection-outlines.js';
import { isSelected, type SelectionState } from './selection-state.js';

/** What the select tool knows about the board and the view when it takes an input. */
export interface SelectToolContext {
  /** The camera zoom, CSS px per world unit: handle sizes and pick tolerances follow it. */
  readonly zoom: number;
  /** The selection now. */
  readonly selection: SelectionState;
  /** The selection's frame (`selectionFrameOf`), or undefined when nothing is selected. */
  readonly frame: OrientedBox | undefined;
  /** Whether the selection can be resized (`isResizable`); else no resize handles. */
  readonly canResize: ResizeAbility;
  /**
   * How a resize keeps its aspect (`resizeAspectOf`: an image's proportional by default, Shift
   * frees it); other objects' rule (`FREE_RESIZE`) when omitted.
   */
  readonly resizeAspect?: ResizeAspect;
  /**
   * Whether every selected object is locked (`isLockedSelection`): then the frame offers no
   * resize handles and no rotation bands.
   */
  readonly isLocked: boolean;
  /**
   * Whether the frame offers its controls, resize handles and rotation bands: `false` for a
   * lone unlocked line edited by its end handles (`SelectControllerOptions.hasLineEndHandles`),
   * whose frame is not drawn; true when omitted.
   */
  readonly hasFrameControls?: boolean;
  /** Whether the one selected object is a shape, whose whole box can be pressed. */
  readonly isSingleShape?: boolean;
  /** What is under the pointer. */
  readonly hitTester: SelectHitTester;
  /**
   * How many times the document has changed: a marquee's kept hits start over when it
   * moves on. 0 when omitted.
   */
  readonly documentGeneration?: number;
  /**
   * The world the viewport shows (`visibleWorldBounds`), where a capped selection's count badge
   * is kept (`countBadgeLayout`); absent, the badge is taken to sit below the frame.
   */
  readonly visible?: WorldBounds | undefined;
  /**
   * The group one level up from the entered group (`outerGroupOf`), where Escape and a click
   * on empty board leave to; null or omitted at the top level or one level below it.
   */
  readonly outerGroupId?: ObjectId | null;
}

/** What a press landed on, which decides what a drag from it does. */
export type PressTarget =
  | {
      /** A resize handle of the selection frame: a drag resizes. */
      readonly kind: 'handle';
      /** Which handle. */
      readonly handle: ResizeHandle;
      /** The frame the handle belongs to. */
      readonly frame: OrientedBox;
      /** How a drag from it keeps its aspect; other objects' rule when omitted. */
      readonly aspect?: ResizeAspect;
    }
  | {
      /**
       * The rotation band just outside a corner of the selection frame (`hitRotationBand`): a
       * drag turns the selection about the frame's centre.
       */
      readonly kind: 'rotation';
      /** Which corner's band. */
      readonly corner: SelectionCorner;
      /** The frame the band belongs to. */
      readonly frame: OrientedBox;
    }
  | {
      /** An object or a frame's title: a drag moves the selection, which now holds it. */
      readonly kind: 'object';
      /** What the press selects (`PointHit.id`), which a double press activates. */
      readonly id: ObjectId;
      /** What a click (release without a drag) does: narrow or toggle; nothing if handled. */
      readonly onClick: SelectIntent | undefined;
    }
  | {
      /**
       * Empty space inside a multi-selection's frame, or a selected frame's background: a drag
       * moves the selection.
       */
      readonly kind: 'selection';
      /**
       * What a click does: nothing on a selected frame's background or with Shift; otherwise
       * clear the selection.
       */
      readonly onClick: SelectIntent | undefined;
    }
  | {
      /**
       * A capped selection's count badge: inert. A press there neither selects nor
       * clears, and a drag from it does nothing (no rotation, marquee or move).
       */
      readonly kind: 'badge';
    }
  | {
      /**
       * Empty board, or a frame's background: a drag draws a marquee, or pans the view for a
       * finger.
       */
      readonly kind: 'empty';
      /** What a click does: clear the selection, or nothing with Shift. */
      readonly onClick: SelectIntent | undefined;
    };

/** A press resolved: what it landed on and what it does at once. */
export interface PressResolution {
  /** What the press landed on. */
  readonly target: PressTarget;
  /** What happens at the press itself: selecting or adding an unselected object. */
  readonly intents: readonly SelectIntent[];
  /**
   * The innermost entered group after the press (`PointHit.scope`) when it lands on an
   * object; undefined when the press does not change it.
   */
  readonly enteredGroupId?: ObjectId | null;
}

const CLEAR: SelectIntent = { type: 'select', ids: [] };

/** The context the count badge's place depends on. */
type BadgeContext = Pick<SelectToolContext, 'frame' | 'zoom' | 'selection' | 'visible'>;

/**
 * Whether a point is on the count badge a selection above the outline cap shows, where the
 * overlay draws it (`countBadgeLayout`, the same view). O(digits); false below the cap.
 *
 * @param point - The pointer, world units.
 * @param context - The frame, the zoom, the selection and the view.
 * @returns True on the badge.
 */
export function isOnCountBadge(point: Point, context: BadgeContext): boolean {
  const { frame, selection, zoom, visible } = context;
  const count = selection.ids.length;
  if (frame === undefined || count <= MAX_OUTLINED_OBJECTS) return false;
  return isInsideBox(countBadgeLayout(frame, count, zoom, visible).badge, point);
}

/** A press target on the selection frame's own controls. */
export type FrameControlTarget = Extract<PressTarget, { kind: 'handle' | 'rotation' }>;

/**
 * The selection frame's control under a point, if any: a resize handle first, then the rotation
 * band outside a corner. Both are sized on screen, so the zoom decides their reach in world units,
 * and sized for the pointer: a finger's are larger. A locked selection has neither, nor has a lone
 * line edited by its end handles (`hasFrameControls`: its frame is the box of its ends, whose
 * other corners are empty board), and the count badge, drawn over them, hides them
 * (`isOnCountBadge`). Pure; asks no hit tester, so it is cheap enough for every hover.
 *
 * @param point - The pointer, world units.
 * @param context - The frame, the zoom, whether the selection can be resized, whether it is
 *   locked and whether its frame offers controls at all.
 * @param pointerType - The pointer, which sizes the targets; `mouse` if absent.
 * @returns The handle or band, or undefined when the point is on neither (or nothing is
 *   selected, or the selection is locked, or its frame offers no controls).
 */
export function frameControlAt(
  point: Point,
  context: BadgeContext &
    Pick<SelectToolContext, 'canResize' | 'isLocked' | 'hasFrameControls' | 'resizeAspect'>,
  pointerType: SelectPointerType = 'mouse',
): FrameControlTarget | undefined {
  const { frame, zoom } = context;
  if (!frame || context.isLocked || context.hasFrameControls === false) return undefined;
  if (isOnCountBadge(point, context)) return undefined;
  const handle = hitHandle(frame, zoom, point, context.canResize, pointerType);
  if (handle) {
    const { resizeAspect } = context;
    return { kind: 'handle', handle, frame, ...(resizeAspect && { aspect: resizeAspect }) };
  }
  const corner = hitRotationBand(frame, zoom, point, pointerType);
  return corner && { kind: 'rotation', corner, frame };
}

/**
 * What a press on an object does. An unselected object is selected (Shift adds it) at once,
 * so a drag from it moves it; a selected one waits for the release, so a drag moves the whole
 * selection while a click narrows the selection to it (Shift: removes it).
 *
 * @param id - The object pressed.
 * @param selection - The selection before the press.
 * @param isShiftPressed - Whether Shift is held.
 * @returns The resolution.
 */
function pressObject(
  id: ObjectId,
  selection: SelectionState,
  isShiftPressed: boolean,
): PressResolution {
  const toggle: SelectIntent = { type: 'toggle', id };
  if (isSelected(selection, id)) {
    const onClick = isShiftPressed ? toggle : { type: 'select' as const, ids: [id] };
    return { target: { kind: 'object', id, onClick }, intents: [] };
  }
  const now = isShiftPressed ? toggle : { type: 'select' as const, ids: [id] };
  return { target: { kind: 'object', id, onClick: undefined }, intents: [now] };
}

/**
 * Resolves a primary-button press: a capped selection's count badge
 * first, which is inert (`isOnCountBadge`), then a resize handle of the selection frame, then the rotation band just outside one of its corners (both take priority over
 * objects: `frameControlAt`), then the topmost object or frame title, then empty space inside
 * the frame, then empty board. A single selected shape also accepts presses throughout its
 * oriented box as object presses, so its unpainted interior supports drag and activation.
 * A frame's background is not a target: a plain press there resolves as if the board were
 * empty, so a drag draws a marquee over the
 * frame's children (a finger's pans), while a mod+press picks the frame; but the background of a frame that is
 * already selected, alone or with others, is part of the selection, so a drag from it moves the
 * selection (with Shift it is still an additive marquee) and a click there keeps the
 * selection as it is. Objects are hit at the entered group's level, and a press on
 * one takes the tool to the level it sits at (`PointHit.scope`). Pure.
 *
 * @param pointer - The press.
 * @param context - The selection, its frame, the zoom and the hit tester.
 * @param enteredGroupId - The innermost entered group, or null at the top level.
 * @returns What the press landed on and what it does at once.
 */
export function resolvePress(
  pointer: SelectPointer,
  context: SelectToolContext,
  enteredGroupId: ObjectId | null = null,
): PressResolution {
  const { frame, zoom, selection } = context;
  if (isOnCountBadge(pointer.world, context)) return { target: { kind: 'badge' }, intents: [] };
  const control = frameControlAt(pointer.world, context, pointer.pointerType);
  if (control) return { target: control, intents: [] };
  const hit = context.hitTester.hitPoint(pointer.world, zoom, enteredGroupId);
  if (hit !== undefined && (hit.part !== 'background' || pointer.isModPressed)) {
    return {
      ...pressObject(hit.id, selection, pointer.isShiftPressed),
      enteredGroupId: hit.scope,
    };
  }
  if (
    hit?.part === 'background' &&
    !isSelected(selection, hit.id) &&
    context.hitTester.isAboveSelection(hit.id, selection.ids)
  ) {
    return {
      target: { kind: 'empty', onClick: pointer.isShiftPressed ? undefined : CLEAR },
      intents: [],
    };
  }
  const [selectedId] = selection.ids;
  if (
    context.isSingleShape &&
    selection.ids.length === 1 &&
    selectedId !== undefined &&
    frame !== undefined &&
    isInsideBox(frame, pointer.world)
  ) {
    return pressObject(selectedId, selection, pointer.isShiftPressed);
  }
  const onClick = pointer.isShiftPressed ? undefined : CLEAR;
  const isOnSelectedFrame =
    hit?.part === 'background' && !pointer.isShiftPressed && isSelected(selection, hit.id);
  const isInsideMultiSelection =
    frame !== undefined && selection.ids.length > 1 && isInsideBox(frame, pointer.world);
  if (isOnSelectedFrame || isInsideMultiSelection) {
    return {
      target: { kind: 'selection', onClick: isOnSelectedFrame ? undefined : onClick },
      intents: [],
    };
  }
  return { target: { kind: 'empty', onClick }, intents: [] };
}
