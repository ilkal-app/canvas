import type { PresenceClientId, PresenceSnapshot, PresenceViewport } from './presence-state.js';
import { isValidViewport } from './presence-validation.js';

/** The local canvas size, in CSS pixels. */
export interface ScreenSize {
  /** Canvas width, in CSS pixels; positive. */
  readonly widthPx: number;
  /** Canvas height, in CSS pixels; positive. */
  readonly heightPx: number;
}

/**
 * Computes the local viewport that follows another client's: centred on the same point, zoomed
 * so the whole followed region fits the local screen. On a screen the same size as the
 * followed client's the result is its viewport; on a different aspect ratio one axis shows
 * more. The zoom is not clamped here; the camera owns its zoom range.
 *
 * @param target - The followed client's viewport, in world units.
 * @param screen - The local canvas size, in CSS pixels.
 * @returns The viewport the local camera should show, in world units, with its zoom in screen
 *   pixels per world unit.
 * @throws {RangeError} When the screen is empty or the target is not a valid viewport.
 */
export function computeFollowViewport(
  target: PresenceViewport,
  screen: ScreenSize,
): PresenceViewport {
  if (!(screen.widthPx > 0 && screen.heightPx > 0)) {
    throw new RangeError('A screen to follow on needs a positive width and height, in px.');
  }
  if (!isValidViewport(target)) {
    throw new RangeError('A followed viewport needs finite edges and a positive size and zoom.');
  }
  const zoom = Math.min(screen.widthPx / target.w, screen.heightPx / target.h);
  const w = screen.widthPx / zoom;
  const h = screen.heightPx / zoom;
  const centerX = target.x + target.w / 2;
  const centerY = target.y + target.h / 2;
  return { x: centerX - w / 2, y: centerY - h / 2, w, h, zoom };
}

/**
 * Computes the local viewport that follows a collaborator ("follow").
 *
 * @param snapshot - The remote presence.
 * @param clientId - The followed client.
 * @param screen - The local canvas size, in CSS pixels.
 * @returns The viewport to show, or undefined when the client is gone or shares no viewport.
 * @throws {RangeError} When the screen is empty.
 */
export function followClient(
  snapshot: PresenceSnapshot,
  clientId: PresenceClientId,
  screen: ScreenSize,
): PresenceViewport | undefined {
  const viewport = snapshot.get(clientId)?.viewport;
  return viewport === undefined ? undefined : computeFollowViewport(viewport, screen);
}
