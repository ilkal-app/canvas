import { useEffect, useState, type RefObject } from 'react';

import { visibleWorldBounds, worldToScreen, type Camera, type WorldBounds } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';

import { announceAnchorsMoved } from '../controls/anchor-moves.js';
import type { Placement, PlacementSide, ScreenRect } from '../controls/placement.js';
import type { CameraSource } from '../editing/camera-source.js';
import { unionOfBounds } from '../editing/keep-in-view.js';
import { editedBoundsOf } from '../editing/text-bar-model.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import { measureReservedZones } from './reserved-zones.js';
import { followSelectionPopover, placeSelectionPopover } from './selection-placement.js';

/** How long the camera stays still before the popover chooses its side again, ms. */
export const POPOVER_SETTLE_MS = 120;

/** How far a press on the canvas moves before it is a drag that hides the popover, px. */
const PRESS_SLOP_PX = 4;

/**
 * World bounds on screen, in the canvas's pixels.
 *
 * @param camera - The camera.
 * @param bounds - The bounds, world units.
 * @returns The rectangle on screen.
 */
function screenRectOf(camera: Camera, bounds: WorldBounds): ScreenRect {
  const topLeft = worldToScreen(camera, { x: bounds.minX, y: bounds.minY });
  const bottomRight = worldToScreen(camera, { x: bounds.maxX, y: bounds.maxY });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

/**
 * An object's bounds for placing the popover: a box's own (the text bar's rule, rotation and all),
 * or for a connector or line the drawn bounds the hit index holds, the connector placed on the
 * objects it joins (its stored ends name objects, not points).
 *
 * @param engine - The engine.
 * @param id - The object.
 * @returns Its bounds, world units, or undefined.
 */
function selectionBoundsOf(engine: MountedEngine, id: ObjectId): WorldBounds | undefined {
  const { board } = engine.board;
  const type = board.get(id)?.type;
  const drawn = type === 'connector' || type === 'line' ? engine.board.boundsOf?.(id) : undefined;
  return drawn ?? editedBoundsOf(board, id);
}

/** What a placement measured, which following the camera reuses (item 4). */
type Measured = BesideMeasured | SheetMeasured;

/** A phone's bottom sheet: only the selection moves, which its popups avoid. */
interface SheetMeasured {
  readonly kind: 'sheet';
  /** The selection's world bounds. */
  readonly world: WorldBounds;
  /** The canvas's top left on the page. */
  readonly origin: PageOrigin;
}

/** A sheet beside the selection, which moves with it. */
interface BesideMeasured {
  readonly kind: 'beside';
  /** The selection's world bounds. */
  readonly world: WorldBounds;
  /** The popover's size. */
  readonly size: { readonly width: number; readonly height: number };
  /** The reserved chrome. */
  readonly reserved: readonly ScreenRect[];
  /** The side it took. */
  readonly side: PlacementSide;
  /** The page's direction. */
  readonly direction: 'ltr' | 'rtl';
  /** The canvas's top left on the page. */
  readonly origin: PageOrigin;
}

/** A point on the page, CSS px from its top left. */
interface PageOrigin {
  readonly x: number;
  readonly y: number;
}

/** The selection's box on the page, kept as the popover follows it, for its popups to avoid. */
interface SelectionOnPage {
  rect: ScreenRect | undefined;
}

/**
 * A rectangle in the canvas's pixels on the page.
 *
 * @param rect - The rectangle, canvas pixels.
 * @param origin - The canvas's top left on the page.
 * @returns The rectangle, page pixels.
 */
function onPage(rect: ScreenRect, origin: PageOrigin): ScreenRect {
  return { ...rect, x: rect.x + origin.x, y: rect.y + origin.y };
}

/**
 * Writes a placement's offsets on the sheet and shows it, then lets the popups open from it
 * follow (`announceAnchorsMoved`).
 *
 * @param sheet - The popover's sheet.
 * @param placement - Where its top left goes and its side.
 */
function showAt(sheet: HTMLElement, placement: Placement): void {
  // By its offsets, never a transform: a transformed sheet would become the containing block of
  // the fixed popups opened from it (its more menu, its dropdowns), which are placed in window
  // coordinates and would land that far from their button.
  sheet.style.left = `${String(placement.x)}px`;
  sheet.style.top = `${String(placement.y)}px`;
  sheet.dataset.side = placement.side;
  delete sheet.dataset.hidden;
  announceAnchorsMoved();
}

/**
 * Places the sheet beside the selection now, or hides it when the selection has no bounds or is
 * off screen.
 *
 * @param engine - The engine.
 * @param camera - The camera.
 * @param ids - The selected ids.
 * @param sheet - The popover's sheet.
 * @param shown - Where the selection is on the page, updated.
 * @returns What it measured, for following the camera; undefined when it is hidden.
 */
function placeNow(
  engine: MountedEngine,
  camera: Camera,
  ids: readonly ObjectId[],
  sheet: HTMLElement,
  shown: SelectionOnPage,
): Measured | undefined {
  const world = unionOfBounds(ids.flatMap((id) => selectionBoundsOf(engine, id) ?? []));
  const canvas = sheet.closest('main')?.querySelector('canvas')?.getBoundingClientRect();
  if (world === undefined || canvas === undefined) {
    shown.rect = undefined;
    sheet.dataset.hidden = '';
    return undefined;
  }
  const origin = { x: canvas.x, y: canvas.y };
  const selection = screenRectOf(camera, world);
  shown.rect = onPage(selection, origin);
  // A phone's bottom sheet is placed by its stylesheet, above the compact bar; its
  // popups still avoid the selection where it is now.
  if (sheet.hasAttribute('data-sheet')) {
    sheet.style.left = '';
    sheet.style.top = '';
    delete sheet.dataset.hidden;
    announceAnchorsMoved();
    return { kind: 'sheet', world, origin };
  }
  const viewport = viewportOf(camera);
  const size = { width: sheet.offsetWidth, height: sheet.offsetHeight };
  const reserved = measureReservedZones(canvas);
  const direction = getComputedStyle(sheet).direction === 'rtl' ? 'rtl' : 'ltr';
  // Off screen: hidden, as while following the camera, rather than parked at an edge.
  const onScreen = followSelectionPopover({ selection, size, viewport, reserved, side: 'top' });
  if (onScreen === undefined) {
    sheet.dataset.hidden = '';
    return undefined;
  }
  const selected = new Set<string>(ids);
  const objects = (engine.board.objectsIn?.(visibleWorldBounds(camera)) ?? [])
    .filter((object) => !selected.has(object.id))
    .map((object) => screenRectOf(camera, object.bounds));
  const placement = placeSelectionPopover({
    selection,
    size,
    viewport,
    objects,
    reserved,
    direction,
  });
  showAt(sheet, placement);
  return { kind: 'beside', world, size, reserved, side: placement.side, direction, origin };
}

/**
 * Moves the sheet with the selection for a camera frame (item 4): on the side it was
 * placed on, with what that placement measured, so a frame reads no layout and queries no
 * objects; hidden while the selection is off screen. A phone's bottom sheet stays put, and only
 * its popups place themselves again, clear of the selection.
 *
 * @param camera - The camera.
 * @param measured - What the last placement measured.
 * @param sheet - The popover's sheet.
 * @param shown - Where the selection is on the page, updated.
 */
function followNow(
  camera: Camera,
  measured: Measured,
  sheet: HTMLElement,
  shown: SelectionOnPage,
): void {
  const selection = screenRectOf(camera, measured.world);
  // Kept before the sheet moves: its popups follow it and avoid the selection where it is now.
  shown.rect = onPage(selection, measured.origin);
  if (measured.kind === 'sheet') {
    // The bottom sheet stays; its open popups place themselves again around the selection.
    announceAnchorsMoved();
    return;
  }
  const placement = followSelectionPopover({
    selection,
    size: measured.size,
    viewport: viewportOf(camera),
    reserved: measured.reserved,
    side: measured.side,
    direction: measured.direction,
  });
  if (placement === undefined) sheet.dataset.hidden = '';
  else showAt(sheet, placement);
}

/**
 * The visible canvas, in the canvas's pixels.
 *
 * @param camera - The camera.
 * @returns The viewport.
 */
function viewportOf(camera: Camera): ScreenRect {
  return { x: 0, y: 0, width: camera.viewportWidthPx, height: camera.viewportHeightPx };
}

/**
 * Where the selection is on the page, as the popover's placement keeps it, and a function that
 * reads it for the popups to avoid: the same pair throughout.
 *
 * @returns The holder the placement writes and the function that reads it.
 */
function useSelectionOnPage(): readonly [SelectionOnPage, () => readonly ScreenRect[]] {
  const [pair] = useState((): readonly [SelectionOnPage, () => readonly ScreenRect[]] => {
    const shown: SelectionOnPage = { rect: undefined };
    return [shown, () => (shown.rect === undefined ? [] : [shown.rect])];
  });
  return pair;
}

/**
 * Keeps the selection's popover beside the selection without a React render per frame:
 * it is placed by its offsets, by {@link placeSelectionPopover}, once shown and
 * after each change of the document; while the camera moves it follows the selection, a frame
 * at a time, on the side it was placed on ({@link followSelectionPopover}, item 4: it no
 * longer hides and comes back), and its side is chosen again {@link POPOVER_SETTLE_MS} after the
 * camera stops; it hides while the selection is off screen and while a press on the canvas that
 * moved more than 4 px lasts (a drag, a resize, a rotate, a marquee) and comes back on
 * release, while a click stays put (a click on the selection or in the edited text no
 * longer blinks it). Popups open from it follow it (`announceAnchorsMoved`, item 3).
 * Main thread.
 *
 * @param sheetRef - The popover's sheet, which starts hidden (`data-hidden`).
 * @param engine - The engine, once it runs.
 * @param camera - The camera's source.
 * @param ids - The selected ids; the popover follows these.
 * @param isSheet - Whether it is a phone's bottom sheet, placed by its stylesheet: a
 *   change places it again. False if absent.
 * @returns Where the selection is on the page now, for the popups opened from the popover to
 *   avoid (round 2: its menus never cover the selection); the same function throughout.
 */
export function usePopoverPlacement(
  sheetRef: RefObject<HTMLElement | null>,
  engine: MountedEngine | undefined,
  camera: CameraSource,
  ids: readonly ObjectId[],
  isSheet = false,
): () => readonly ScreenRect[] {
  const [shown, selectionOnPage] = useSelectionOnPage();
  useEffect(() => {
    const sheet = sheetRef.current;
    if (sheet === null || engine === undefined || ids.length === 0) return undefined;
    const canvas = sheet.closest('main')?.querySelector('canvas');
    // The press on the canvas: where it started, and whether it moved far enough to hide.
    let press: { readonly x: number; readonly y: number; isMoved: boolean } | undefined;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    // What the last placement measured; none while the sheet is not beside the selection.
    let measured: Measured | undefined;
    const hide = (): void => {
      sheet.dataset.hidden = '';
    };
    // The engine's own camera until the source hears its first change.
    const cameraNow = (): Camera => camera.read() ?? engine.camera();
    const place = (): void => {
      if (press?.isMoved !== true) measured = placeNow(engine, cameraNow(), ids, sheet, shown);
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    // Hidden (off screen): nothing to move per frame; the placement once the camera stops shows
    // it again.
    const follow = (): void => {
      if (press?.isMoved === true || measured === undefined) return;
      followNow(cameraNow(), measured, sheet, shown);
    };
    const stopCamera = camera.subscribe(() => {
      // One follow per frame, however many cameras the frame reports.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(follow);
      clearTimeout(settle);
      settle = setTimeout(place, POPOVER_SETTLE_MS);
    });
    const stopBoard = engine.board.subscribe((change) => {
      if (change.kind === 'document') schedule();
    });
    const onPress = (event: PointerEvent): void => {
      press = { x: event.clientX, y: event.clientY, isMoved: false };
    };
    // A click (on the selected object, in the edited text) leaves the sheet; a drag hides it.
    const onMove = (event: PointerEvent): void => {
      if (press === undefined || press.isMoved) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= PRESS_SLOP_PX) return;
      press.isMoved = true;
      hide();
    };
    const onRelease = (): void => {
      if (press === undefined) return;
      press = undefined;
      schedule();
    };
    canvas?.addEventListener('pointerdown', onPress);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onRelease);
    window.addEventListener('pointercancel', onRelease);
    schedule();
    return () => {
      stopCamera();
      stopBoard();
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      canvas?.removeEventListener('pointerdown', onPress);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onRelease);
      window.removeEventListener('pointercancel', onRelease);
    };
  }, [sheetRef, engine, camera, ids, isSheet, shown]);
  return selectionOnPage;
}
