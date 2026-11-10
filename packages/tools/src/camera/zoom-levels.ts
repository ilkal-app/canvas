import { MAX_ZOOM, MIN_ZOOM } from '@canvas/engine';

/**
 * The zoom levels that zoom in and zoom out step through (the zoom control's − and +, mod+= and
 * mod+-; item 1), as browsers and design tools do: 10%, 25%, 33%, 50%, 67%, 75%, 90%,
 * 100%, 110%, 125%, 150%, 175%, 200%, 250%, 300%, 400%, 500%, 800%, 1600% and 3200%, as zoom
 * factors in ascending order. Beyond either end a step goes to the camera's limit
 * ({@link MIN_ZOOM}, {@link MAX_ZOOM}), which a pinch or the wheel also reaches.
 */
export const ZOOM_LEVELS: readonly number[] = [
  0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 8, 16, 32,
];

/**
 * How near a zoom must be to a level to count as on it, as a fraction of the level: a camera
 * zoom that went through arithmetic (a fit, a pinch) is never exactly a level.
 */
const ON_LEVEL_TOLERANCE = 1e-6;

/**
 * The zoom one zoom-in or zoom-out step goes to from a zoom: the next level of
 * {@link ZOOM_LEVELS} above or below it, from a level or from any zoom between two (after a pinch
 * or the wheel). Past the last level up it is {@link MAX_ZOOM}, past the first down
 * {@link MIN_ZOOM}; at a limit it stays there. Pure.
 *
 * @param zoom - The camera's zoom now, in screen pixels per world unit.
 * @param direction - `in` for the next level up, `out` for the next level down.
 * @returns The zoom to go to.
 */
export function steppedZoom(zoom: number, direction: 'in' | 'out'): number {
  if (direction === 'in') {
    const next = ZOOM_LEVELS.find((level) => level > zoom * (1 + ON_LEVEL_TOLERANCE));
    return Math.max(zoom, next ?? MAX_ZOOM);
  }
  const lower = ZOOM_LEVELS.filter((level) => level < zoom * (1 - ON_LEVEL_TOLERANCE));
  return Math.min(zoom, lower.at(-1) ?? MIN_ZOOM);
}
