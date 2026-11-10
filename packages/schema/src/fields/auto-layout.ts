import { z } from 'zod';

import { BOARD_BOUND } from './board-bound.js';

/** The axis an auto-layout container stacks its children along. */
export const AUTO_LAYOUT_DIRECTIONS = ['row', 'column'] as const;

/** Where children sit on the cross axis: at its start, centred, at its end, or stretched across. */
export const AUTO_LAYOUT_ALIGNS = ['start', 'center', 'end', 'stretch'] as const;

/**
 * How free main-axis space is shared out when the container keeps its own main size and no child
 * fills: children packed at the start, centred, at the end, or spread with equal gaps.
 */
export const AUTO_LAYOUT_JUSTIFIES = ['start', 'center', 'end', 'space-between'] as const;

/** Whether a container's size on one axis is its content's (`hug`) or its own (`fixed`). */
export const AUTO_LAYOUT_SIZINGS = ['hug', 'fixed'] as const;

/** A length inside a container: finite, not negative, at most the board bound. */
const lengthSchema = z.number().min(0).max(BOARD_BOUND);

/**
 * The gap between neighbouring children: within the board bound either way, negative to
 * overlap them (an avatar stack), the later child drawn on top, as Figma lays one out.
 */
const gapSchema = z.number().min(-BOARD_BOUND).max(BOARD_BOUND);

/**
 * A frame's or main's live auto-layout: its children, in stacking order bottom first,
 * are stacked in a row or a column with a gap between them and padding inside, aligned on the
 * cross axis and justified on the main one, and the container hugs its content or keeps its own
 * size on each axis. Children's `constraints` are ignored inside it. Every field is stored.
 */
export const autoLayoutSchema = z
  .strictObject({
    /** The axis children are stacked along. */
    direction: z.enum(AUTO_LAYOUT_DIRECTIONS).describe('The axis children are stacked along.'),
    /** Space between neighbouring children on the main axis, world units; negative overlaps them. */
    gap: gapSchema.describe(
      'Space between neighbouring children on the main axis; negative overlaps them (the later on top). space-between ignores it.',
    ),
    /** Space inside the container's edges, world units. */
    padding: z
      .strictObject({
        /** Above the children. */
        top: lengthSchema,
        /** Right of the children. */
        right: lengthSchema,
        /** Below the children. */
        bottom: lengthSchema,
        /** Left of the children. */
        left: lengthSchema,
      })
      .describe("Space inside the container's edges, per side."),
    /** Where children sit on the cross axis. */
    align: z.enum(AUTO_LAYOUT_ALIGNS).describe('Where children sit on the cross axis.'),
    /** How free main-axis space is shared out. */
    justify: z
      .enum(AUTO_LAYOUT_JUSTIFIES)
      .describe(
        'How free main-axis space is shared out when the container keeps its size and no child fills.',
      ),
    /** Whether the width is the content's or the container's own. */
    width: z.enum(AUTO_LAYOUT_SIZINGS).describe("Whether the width is the content's or its own."),
    /** Whether the height is the content's or the container's own. */
    height: z.enum(AUTO_LAYOUT_SIZINGS).describe("Whether the height is the content's or its own."),
  })
  .describe('A live row or column stack of the children.');

/** A frame's or main's live auto-layout. */
export type AutoLayout = z.output<typeof autoLayoutSchema>;

/**
 * The auto-layout a container takes when one is added to it: a row hugging its
 * children on both axes, no gap or padding, the children at the start.
 */
export const DEFAULT_AUTO_LAYOUT: AutoLayout = Object.freeze({
  direction: 'row',
  gap: 0,
  padding: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
});

/**
 * How a child sits in its auto-layout container: whether it takes the main-axis space
 * its container has left, shared with other fillers. Ignored outside an auto-layout container.
 */
export const layoutChildSchema = z
  .strictObject({
    /** Whether it fills the main-axis space left. */
    fill: z.boolean().describe('Whether it takes the main-axis space its container has left.'),
  })
  .describe('How the object sits in its auto-layout container.');

/** How a child sits in its auto-layout container. */
export type LayoutChild = z.output<typeof layoutChildSchema>;
