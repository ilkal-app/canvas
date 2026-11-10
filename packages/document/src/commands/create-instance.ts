import { z } from 'zod';

import {
  angleSchema,
  INSTANCE_SCALE_MAX,
  INSTANCE_SCALE_MIN,
  objectIdSchema,
  pageIdSchema,
  pointSchema,
  componentObjectSchema,
  overrideFieldsSchema,
  overridePathSchema,
  variantSelectionSchema,
  variantSizedAxes,
  type ComponentObject,
  type InstanceObject,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';

import { checkObject, referenceErrors } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { instanceOverrideError } from './instance-override-target.js';
import {
  overridePathError,
  overridePathInputSchema,
  resolveOverridePath,
} from './override-path-names.js';
import { selectionErrors } from './set-instance-variant.js';
import { SubBoard } from './sub-board.js';
import { boardToParentFrame } from './world-frame.js';
import { nextZAbove } from './z-placement.js';

/** Main identity and world placement of a new instance. */
export const createInstanceInputSchema = z.strictObject({
  /** The live main to instantiate. */
  componentId: objectIdSchema.describe('The live board-local main to place.'),
  ...pointSchema.shape,
  /** Optional stored identity. */
  instanceId: objectIdSchema
    .optional()
    .describe('Optional stored identity; generated when omitted.'),
  /** Destination container, or the root. */
  parentId: objectIdSchema
    .nullable()
    .default(null)
    .describe('Destination container; null places at the board root.'),
  /** Page when placed at the root. */
  pageId: pageIdSchema
    .optional()
    .describe('Page for a root placement; defaults to the first live page.'),
  /** Width, defaulting to the main's. */
  width: componentObjectSchema.shape.width
    .optional()
    .describe('Width in world units; defaults to the main width.'),
  /** Height, defaulting to the main's. */
  height: componentObjectSchema.shape.height
    .optional()
    .describe('Height in world units; defaults to the main height.'),
  /** Content scale; the default box is the main's laid size times it. */
  scale: z
    .number()
    .min(INSTANCE_SCALE_MIN)
    .max(INSTANCE_SCALE_MAX)
    .optional()
    .describe(
      "Content scale, 0.05 to 20 (1, the default, is the main's size); width and height default to the main's size times it.",
    ),
  /** Rotation in the destination parent's coordinates. */
  rotation: angleSchema.default(0).describe('Rotation in radians in the destination parent frame.'),
  /** The value chosen per variant axis, checked as `setInstanceVariant` checks it. */
  variant: variantSelectionSchema
    .optional()
    .describe("The value chosen on each of the main's variant axes; omit for the defaults."),
  /** Overrides stored with the placement, each checked as `setInstanceOverride` checks it. */
  overrides: z
    .record(overridePathInputSchema, overrideFieldsSchema)
    .optional()
    .describe(
      'Per-child overrides keyed by source path (nested instance ids, then the child id, ' +
        "separated by slash, or the layers' names down to the child): content, colour, image " +
        'or visibility fields the child supports.',
    ),
});

/**
 * The drawn box of a new instance: the given width and height, else its main's times its content
 * scale. A main that hugs its content is laid out to its size by the relayout every
 * command runs, which multiplies its laid size by the scale (`laidInstanceSize`); a given side on
 * such an axis is kept (`givenAxesFixed`).
 *
 * @param main - The main.
 * @param input - The command's width, height and scale, each optional.
 * @param input.width - The given width.
 * @param input.height - The given height.
 * @param input.scale - The given content scale.
 * @returns The width and height, and the fixed-axis flags of the sides given.
 */
function scaledBox(
  main: ComponentObject,
  input: {
    readonly width?: number | undefined;
    readonly height?: number | undefined;
    readonly scale?: number | undefined;
  },
): { readonly width: number; readonly height: number; isWidthFixed?: true; isHeightFixed?: true } {
  const scale = input.scale ?? 1;
  return {
    width: input.width ?? main.width * scale,
    height: input.height ?? main.height * scale,
    ...givenAxesFixed(main, input),
  };
}

/**
 * Which given sides a new instance keeps: a width or height given on an axis its main
 * hugs, or its variants size, is fixed (`isWidthFixed`, `isHeightFixed`), as a resize on that
 * axis fixes it, so the relayout every command runs keeps the given box rather than the laid one.
 *
 * @param main - The main.
 * @param input - The command's width and height, each optional.
 * @param input.width - The given width.
 * @param input.height - The given height.
 * @returns The flags to store; empty when none.
 */
function givenAxesFixed(
  main: ComponentObject,
  input: { readonly width?: number | undefined; readonly height?: number | undefined },
): { isWidthFixed?: true; isHeightFixed?: true } {
  const sized = variantSizedAxes(main);
  const isWidthKept = main.autoLayout?.width === 'hug' || sized.isWidthSized;
  const isHeightKept = main.autoLayout?.height === 'hug' || sized.isHeightSized;
  return {
    ...(input.width !== undefined && isWidthKept ? { isWidthFixed: true as const } : {}),
    ...(input.height !== undefined && isHeightKept ? { isHeightFixed: true as const } : {}),
  };
}

/** The single stored instance created by the command. */
export interface CreateInstancePlan {
  /** Fully validated placement. */
  readonly instance: InstanceObject;
}

/** Identity returned after placement. */
export interface CreateInstanceResult {
  /** Stored instance id. */
  readonly instanceId: ObjectId;
}

/**
 * Places a reference to a live board-local main without copying its children, with any
 * overrides in the same transaction, so placing and overriding is one undo step.
 */
export const createInstanceCommand: Command<
  typeof createInstanceInputSchema,
  CreateInstancePlan,
  CreateInstanceResult
> = {
  name: 'createInstance',
  description: 'Places an instance of a reusable component at a board point.',
  input: createInstanceInputSchema,
  validate(context, input) {
    const { board, now, origin } = context;
    const main = board.get(input.componentId);
    if (main?.type !== 'component' || main.retired) {
      const code = main?.type === 'component' ? 'retired-main' : 'missing-main';
      return reject([
        commandError(
          code,
          input.componentId,
          ['componentId'],
          'A live component main is required.',
        ),
      ]);
    }
    const id = input.instanceId ?? context.createId();
    const errors: CommandError[] = [];
    if (board.get(id) !== undefined)
      errors.push(
        commandError('duplicate-id', id, ['instanceId'], 'The instance id is already in use.'),
      );
    const z = nextZAbove(board, input.parentId, id, ['parentId'], errors);
    if (z === undefined) return reject(errors);
    const placed: InstanceObject = {
      id,
      type: 'instance',
      parentId: input.parentId,
      pageId: input.parentId === null ? (input.pageId ?? null) : null,
      x: input.x,
      y: input.y,
      ...scaledBox(main, input),
      rotation: input.rotation,
      z,
      locked: false,
      createdBy: origin.principalId,
      createdAt: now,
      updatedAt: now,
      mainId: main.id,
      overrides: {},
      ...(input.variant === undefined ? {} : { variant: input.variant }),
      ...(input.scale === undefined || input.scale === 1 ? {} : { scale: input.scale }),
    };
    if (input.variant !== undefined)
      errors.push(...selectionErrors(main, input.variant, ['variant']));
    // Keys given as names are read through the placement before its records.
    // Keys already ids are read first, so a swap given in the same input leads its deeper paths.
    const entries = Object.entries(input.overrides ?? {});
    const asIds = Object.fromEntries(
      entries.filter(([path]) => overridePathSchema.safeParse(path).success),
    ) as Record<string, OverrideRecord>;
    const reading: InstanceObject = { ...placed, overrides: asIds };
    const overrides: Record<string, OverrideRecord> = {};
    for (const [given, override] of entries) {
      const resolution = resolveOverridePath(board, reading, given);
      if ('error' in resolution) {
        errors.push(overridePathError(resolution, id, ['overrides', given]));
      } else {
        overrides[resolution.path] = { ...overrides[resolution.path], ...override };
      }
    }
    const candidate: InstanceObject = { ...placed, overrides };
    for (const [path, override] of Object.entries(candidate.overrides)) {
      const refused = instanceOverrideError(board, candidate, path, override, {
        path: ['overrides', path],
        override: ['overrides', path],
      });
      if (refused !== undefined) errors.push(refused);
    }
    const subBoard = new SubBoard(board, [candidate]);
    subBoard.addWithAncestors(id);
    const position = boardToParentFrame(subBoard.toBoard(), candidate, input);
    if (position === null)
      return reject([
        commandError('parent-cycle', id, ['parentId'], 'The destination has a parent cycle.'),
      ]);
    const instance = checkObject(board, { ...candidate, ...position }, errors);
    if (instance !== undefined) errors.push(...referenceErrors(board, [instance]));
    return errors.length > 0 || instance?.type !== 'instance'
      ? reject(errors)
      : accept({ instance });
  },
  apply(transaction, input, plan) {
    transaction.setObject(plan.instance);
    return { instanceId: plan.instance.id };
  },
};
