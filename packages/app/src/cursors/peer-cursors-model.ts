import {
  colorForPrincipal,
  colourwayForPrincipal,
  type PresenceColourway,
  type PresenceSnapshot,
} from '@canvas/collab';
import { screenToWorld, type Camera } from '@canvas/engine';
import type { Point } from '@canvas/schema';

/** One collaborator's pointer as the cursor layer draws it (item 10). */
export interface PeerCursor {
  /** The peer's awareness client id: one cursor per open tab. */
  readonly clientId: number;
  /** The peer's principal id. */
  readonly principalId: string;
  /** The name drawn beside the arrow. */
  readonly name: string;
  /** The presence colour, `#rrggbb`: the colourway's dark (`colorForPrincipal` of the id). */
  readonly color: string;
  /**
   * The peer's colourway, which their round cursor and name tag are drawn in: the one
   * every client gives their principal id (`colourwayForPrincipal`), so all views agree.
   */
  readonly colourway: PresenceColourway;
  /** Whether the peer is an agent, whose cursor carries a ✦. */
  readonly isAgent: boolean;
  /** Where the pointer is, world units. */
  readonly point: Point;
}

/**
 * The peers' cursors on the page shown: every remote client whose presence has a cursor and
 * shows that page (a client of a build without pages shows the first). Pure.
 *
 * @param snapshot - The remote presence.
 * @param page - The page shown.
 * @param firstPage - The board's first page.
 * @returns The cursors, in the snapshot's order.
 */
export function peerCursorsOf(
  snapshot: PresenceSnapshot,
  page: string,
  firstPage: string,
): PeerCursor[] {
  const cursors: PeerCursor[] = [];
  for (const [clientId, state] of snapshot) {
    const { cursor, principal } = state;
    if (cursor === undefined || (state.page ?? firstPage) !== page) continue;
    cursors.push({
      clientId,
      principalId: principal.id,
      name: principal.name,
      color: colorForPrincipal(principal.id),
      colourway: colourwayForPrincipal(principal.id),
      isAgent: principal.kind === 'agent',
      point: { x: cursor.x, y: cursor.y },
    });
  }
  return cursors;
}

/** How quickly a drawn cursor closes on its peer's latest position: the time constant, ms. */
export const CURSOR_EASE_MS = 40;

/** Within this many CSS px of its target a cursor stops easing and sits on it. */
export const CURSOR_SETTLE_PX = 0.25;

/**
 * Moves a drawn cursor toward its peer's latest position for one frame (since presence arrives at
 * 20–30 Hz, cursors move at the frame rate): exponential easing that covers the same share of the
 * gap per millisecond whatever the frame rate, and lands on the target once within
 * {@link CURSOR_SETTLE_PX} at the zoom. Pure.
 *
 * @param drawn - Where the cursor is drawn, world units.
 * @param target - The peer's latest position, world units.
 * @param elapsedMs - The time since the last frame, ms; non-negative.
 * @param zoom - The camera zoom, CSS px per world unit; positive.
 * @returns The new drawn position, `target` itself once settled.
 */
export function easeCursor(drawn: Point, target: Point, elapsedMs: number, zoom: number): Point {
  const share = 1 - Math.exp(-Math.max(0, elapsedMs) / CURSOR_EASE_MS);
  const x = drawn.x + (target.x - drawn.x) * share;
  const y = drawn.y + (target.y - drawn.y) * share;
  const gapPx = Math.hypot(target.x - x, target.y - y) * zoom;
  return gapPx <= CURSOR_SETTLE_PX ? target : { x, y };
}

/**
 * Where a pointer on the canvas is on the board. Pure.
 *
 * @param camera - The camera on screen.
 * @param canvasPoint - The pointer, CSS px from the canvas's top-left corner.
 * @returns The point, world units; null when it lies outside the canvas.
 */
export function cursorPointOf(camera: Camera, canvasPoint: Point): Point | null {
  const { x, y } = canvasPoint;
  if (x < 0 || y < 0 || x > camera.viewportWidthPx || y > camera.viewportHeightPx) return null;
  return screenToWorld(camera, canvasPoint);
}
