import { frameCornerRadii, type CornerRadii } from '@canvas/schema';

/**
 * Whether four corner radii round anything: any of them above 0. Pure.
 *
 * @param radii - The radii, top-left clockwise.
 * @returns True when a corner is rounded.
 */
export function hasRoundedCorner(radii: CornerRadii): boolean {
  return radii[0] > 0 || radii[1] > 0 || radii[2] > 0 || radii[3] > 0;
}

/**
 * The radii a frame draws with: its stored `cornerRadius` read as four
 * (`frameCornerRadii`: absent or refused is sharp), each capped at half the shorter side of its
 * box, so two corners never overlap, as a shape's one radius is. A box with no area draws sharp.
 * A sharp frame allocates nothing. Pure.
 *
 * @param value - The stored `cornerRadius`, or anything.
 * @param width - The box's width, world units.
 * @param height - Its height, world units.
 * @returns The four capped radii, top-left clockwise.
 */
export function drawnFrameCornerRadii(value: unknown, width: number, height: number): CornerRadii {
  const radii = frameCornerRadii(value);
  if (!hasRoundedCorner(radii)) return radii;
  const cap = Math.max(0, Math.min(width, height) / 2);
  return [
    Math.min(radii[0], cap),
    Math.min(radii[1], cap),
    Math.min(radii[2], cap),
    Math.min(radii[3], cap),
  ];
}
