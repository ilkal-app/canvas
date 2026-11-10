import { z } from 'zod';

/** How a child follows a sized parent's change along one axis. */
export const CONSTRAINT_MODES = ['start', 'center', 'end', 'stretch'] as const;

/** One per-axis pin or stretch mode. */
export type ConstraintMode = (typeof CONSTRAINT_MODES)[number];

/** Validates the two independent axes of a child's layout constraints. */
export const constraintsSchema = z.strictObject({
  /** Horizontal pin or stretch, in the parent's frame. */
  x: z.enum(CONSTRAINT_MODES).describe('Horizontal pin or stretch in the parent frame.'),
  /** Vertical pin or stretch, in the parent's frame. */
  y: z.enum(CONSTRAINT_MODES).describe('Vertical pin or stretch in the parent frame.'),
});

/** The child's layout constraints, in its parent's axes. */
export type Constraints = z.output<typeof constraintsSchema>;

/** Older objects keep their position and size when their frame grows. */
export const DEFAULT_CONSTRAINTS: Readonly<Constraints> = Object.freeze({
  x: 'start',
  y: 'start',
});

/**
 * Reads constraints without adding fields to an older stored object.
 *
 * @param object - An object whose constraints may be absent.
 * @param object.constraints - Its optional stored constraints.
 * @returns Its constraints, or the immutable start/start default.
 */
export function effectiveConstraints(object: {
  readonly constraints?: Constraints | undefined;
}): Readonly<Constraints> {
  return object.constraints ?? DEFAULT_CONSTRAINTS;
}
