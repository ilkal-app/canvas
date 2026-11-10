import { z } from 'zod';

import {
  buildChildIndex,
  localBounds,
  objectIdSchema,
  presetKey,
  variantAxesSchema,
  type ComponentObject,
  type InstanceOverrides,
  type VariantAxis,
  type ObjectId,
} from '@canvas/schema';

import { checkObject, movabilityErrors } from './command-checks.js';
import { commandError } from './command-error.js';
import { accept, reject, type Command } from './command.js';
import { givenPresetsSchema, withGivenPresets } from './given-presets.js';
import { groupCommand } from './group.js';
import { applyPatches, type PlannedPatch } from './object-patches.js';
import { SubBoard } from './sub-board.js';

/** Selection and name for a board-local main definition. */
export const createComponentInputSchema = z.strictObject({
  /** Members sharing one parent and page. */
  ids: z.array(objectIdSchema).min(1).describe('Selected members sharing one parent and page.'),
  /** Display name of at most 200 characters. */
  name: z.string().max(200).describe('The main name, at most 200 characters.'),
  /** Optional caller-provided identity. */
  componentId: objectIdSchema.optional().describe('Optional identity; generated when omitted.'),
  /** Optional variant axes, each value starting with an empty preset. */
  variantAxes: variantAxesSchema
    .optional()
    .describe(
      'Optional variant axes ({ name, values }, the first value the default); each value starts with an empty preset.',
    ),
  /** Optional presets for those values, set in the same command. */
  variantPresets: givenPresetsSchema.optional(),
});

/** The definition and member placements written atomically. */
export interface CreateComponentPlan {
  /** The new main definition. */
  readonly component: ComponentObject;
  /** Existing children re-expressed in the main's coordinates. */
  readonly members: readonly PlannedPatch[];
}

/** Identity of the created main. */
export interface CreateComponentResult {
  /** The stored definition id. */
  readonly componentId: ObjectId;
}

/**
 * A new main's variant fields: the axes, and an empty preset for every value, so concurrent
 * first edits to one preset land in the same map and merge.
 *
 * @param axes - The axes.
 * @returns The fields to store.
 */
function variantsOf(axes: VariantAxis[]): Pick<ComponentObject, 'variantAxes' | 'variantPresets'> {
  const variantPresets: Record<string, InstanceOverrides> = {};
  for (const { name, values } of axes) {
    for (const value of values) variantPresets[presetKey(name, value)] = {};
  }
  return { variantAxes: axes, variantPresets };
}

/** Creates a named main at its selection's bounds without changing world placements. */
export const createComponentCommand: Command<
  typeof createComponentInputSchema,
  CreateComponentPlan,
  CreateComponentResult
> = {
  name: 'createComponent',
  description: 'Creates a reusable main definition from objects sharing one parent.',
  input: createComponentInputSchema,
  isPlacePreserving: true,
  validate(context, input) {
    const grouped = groupCommand.validate(context, { ids: input.ids, groupId: input.componentId });
    if (!grouped.isValid) return grouped;
    const { group, members } = grouped.plan;
    const errors = members.flatMap(({ id }) => {
      const object = context.board.get(id);
      return object === undefined
        ? []
        : movabilityErrors(context.board, object, ['ids'], new Set(input.ids));
    });
    const children = members.flatMap(({ id, patch }) => {
      const object = context.board.get(id);
      return object === undefined
        ? []
        : (checkObject(context.board, { ...object, ...patch }, errors) ?? []);
    });
    const subBoard = new SubBoard(context.board, [group, ...children]);
    subBoard.add(group.id);
    for (const child of children) subBoard.addSubtree(child.id);
    const view = subBoard.toBoard();
    const bounds = localBounds(view, group, buildChildIndex(view));
    const component = checkObject(
      context.board,
      {
        ...group,
        type: 'component',
        width: bounds.width,
        height: bounds.height,
        name: input.name,
        retired: false,
        ...(input.variantAxes === undefined ? {} : variantsOf(input.variantAxes)),
      },
      errors,
    );
    if (errors.length > 0 || component?.type !== 'component') return reject(errors);
    if (input.variantPresets === undefined) return accept({ component, members });
    if (input.variantAxes === undefined) {
      return reject([
        commandError(
          'invalid-input',
          component.id,
          ['variantPresets'],
          'Presets need variantAxes.',
        ),
      ]);
    }
    // The presets' paths read the main's content as the command places it.
    const content = [...view.objects.values()].filter(({ id }) => id !== group.id);
    const given = withGivenPresets(context.board, component, input.variantPresets, content);
    return 'errors' in given ? reject(given.errors) : accept({ component: given.main, members });
  },
  apply(transaction, input, plan) {
    transaction.setObject(plan.component);
    applyPatches(transaction, plan.members);
    return { componentId: plan.component.id };
  },
};
