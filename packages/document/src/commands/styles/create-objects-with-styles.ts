import { z } from 'zod';

import { styleIdSchema, type ObjectId, type StyleId } from '@canvas/schema';

import type { StyleKind, StyleTable } from '../../styles/style-map.js';
import { MAX_BATCH_ITEMS } from '../batch-command.js';
import { commandError, type CommandError } from '../command-error.js';
import { accept, reject, type Command, type CommandContext } from '../command.js';
import {
  createObjectsCommand,
  type CreateObjectsPlan,
  type CreateObjectsResult,
} from '../create-objects.js';
import {
  createObjectsWithTokensCommand,
  createObjectsWithTokensInputSchema,
  type TokenItemResult,
} from '../tokens/create-objects-with-tokens.js';

import {
  setEffectStyleCommand,
  setEffectStyleInputSchema,
  setTextStyleCommand,
  setTextStyleInputSchema,
  type SetNamedStylePlan,
} from './set-named-style.js';
import { splitStyledByWrites } from './split-styled-by-writes.js';
import { stylesOf } from './style-support.js';

// `createObjectsWithStyles`: named text and effect styles, colour tokens and the
// objects that use them in one command, so one transaction and one undo step, as
// `createObjectsWithTokens` composes tokens and `createObjects`. Each style item is
// `setTextStyle`'s or `setEffectStyle`'s input, planned in order against the board plus the items
// before it, so a later item sees an earlier one's name and the count toward the 64-style limit
// includes the call's own; the objects are then checked against the board with the call's styles.

/**
 * A list of a kind's style items, 1 to 100, as every batched write.
 *
 * @param item - The item's schema.
 * @param kind - The kind, for the description.
 * @returns The optional list's schema.
 */
const styleItems = <Item extends z.ZodType>(item: Item, kind: StyleKind) =>
  z
    .array(item)
    .min(1)
    .max(MAX_BATCH_ITEMS)
    .optional()
    .describe(
      `Named ${kind} styles to create (no id) or update (an id) before the objects, in order; 1 to 100.`,
    );

/**
 * The ids a kind's new styles take, chosen by the caller.
 *
 * @param kind - The kind, for the description.
 * @returns The optional list's schema.
 */
const newStyleIds = (kind: StyleKind) =>
  z
    .array(styleIdSchema)
    .max(MAX_BATCH_ITEMS)
    .optional()
    .describe(
      `The ids the created ${kind} styles take, in order; chosen by the command when omitted.`,
    );

/** Validates the input of {@link createObjectsWithStylesCommand}. */
export const createObjectsWithStylesInputSchema = createObjectsWithTokensInputSchema.extend({
  /** The colour tokens to set first, as `createObjectsWithTokens` takes them; none when absent. */
  tokens: createObjectsWithTokensInputSchema.shape.tokens.optional(),
  /** The text styles to set, each `setTextStyle`'s input, in order. */
  textStyles: styleItems(setTextStyleInputSchema, 'text'),
  /** The effect styles to set, each `setEffectStyle`'s input, in order. */
  effectStyles: styleItems(setEffectStyleInputSchema, 'effect'),
  /** The ids the new text styles take, in the order of the items that have no `id`. */
  newTextStyleIds: newStyleIds('text'),
  /** The ids the new effect styles take, in the order of the items that have no `id`. */
  newEffectStyleIds: newStyleIds('effect'),
});

/** The parsed input of {@link createObjectsWithStylesCommand}. */
export type CreateObjectsWithStylesInput = z.output<typeof createObjectsWithStylesInputSchema>;

/** One style item's outcome. */
export interface StyleItemResult {
  /** The style's id: the new one for a created style. */
  readonly id: StyleId;
  /** Whether it was created. */
  readonly isCreated: boolean;
  /** Whether anything changed. */
  readonly isChanged: boolean;
}

/** What {@link createObjectsWithStylesCommand} returns. */
export interface CreateObjectsWithStylesResult extends CreateObjectsResult {
  /** Each token item's outcome, in input order; empty without tokens. */
  readonly tokens: readonly TokenItemResult[];
  /** Each text style item's outcome, in input order; empty without text styles. */
  readonly textStyles: readonly StyleItemResult[];
  /** Each effect style item's outcome, in input order; empty without effect styles. */
  readonly effectStyles: readonly StyleItemResult[];
}

/** What {@link createObjectsWithStylesCommand} will write. */
export interface CreateObjectsWithStylesPlan {
  /** The objects' (and tokens') plan, as the composed command made it. */
  readonly objects: CreateObjectsPlan;
  /** Each text style item's plan, in input order; empty in a split's later parts. */
  readonly textStylePlans: readonly SetNamedStylePlan[];
  /** Each effect style item's plan, in input order; empty in a split's later parts. */
  readonly effectStylePlans: readonly SetNamedStylePlan[];
}

/** The style tables a call's objects are checked against. */
interface Tables {
  readonly text: StyleTable<'text'>;
  readonly effect: StyleTable<'effect'>;
}

/**
 * The board as the call's objects or a later style item see it: the board, with the tables given
 * in place of its own.
 *
 * @param context - The command's context.
 * @param tables - The style tables so far.
 * @returns The context.
 */
function contextOver(context: CommandContext, tables: Tables): CommandContext {
  // The reader is often a class instance (the store), so it is wrapped, not spread.
  const reader = new Proxy(context.board, {
    get(target, key) {
      if (key === 'readTextStyles') return () => tables.text;
      if (key === 'readEffectStyles') return () => tables.effect;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function'
        ? (value as (...args: never[]) => unknown).bind(target)
        : value;
    },
  });
  return { ...context, board: reader };
}

/** One kind's items as the planner takes them. */
interface KindItems {
  readonly kind: StyleKind;
  readonly key: 'textStyles' | 'effectStyles';
  readonly idsKey: 'newTextStyleIds' | 'newEffectStyleIds';
  readonly items: readonly { readonly id?: StyleId | undefined }[];
  readonly chosen: readonly StyleId[];
}

/**
 * Plans one kind's style items in order, each against the board and the items before it.
 *
 * @param context - The command's context.
 * @param tables - The tables so far; the kind's is replaced as items are planned.
 * @param asked - The kind's items.
 * @param errors - Where each item's refusals go, under `[key, index]`.
 * @returns The plans and the tables after them.
 */
function planKind(
  context: CommandContext,
  tables: Tables,
  asked: KindItems,
  errors: CommandError[],
): { readonly plans: readonly SetNamedStylePlan[]; readonly tables: Tables } {
  const command = asked.kind === 'text' ? setTextStyleCommand : setEffectStyleCommand;
  const chosenIds = [...asked.chosen];
  const plans: SetNamedStylePlan[] = [];
  let current = tables;
  asked.items.forEach((item, index) => {
    const chosen = item.id === undefined ? chosenIds.shift() : undefined;
    const itemContext = contextOver(context, current);
    const validation = command.validate(
      chosen === undefined ? itemContext : { ...itemContext, createId: () => chosen as ObjectId },
      item as never,
    );
    if (!validation.isValid) {
      const located = validation.errors.map((error) => ({
        ...error,
        path: [asked.key, index, ...error.path],
      }));
      errors.push(...located);
      return;
    }
    const { plan } = validation;
    if (chosen !== undefined && plan.id !== chosen) {
      const message = `the ${asked.kind} style id "${chosen}" is taken`;
      errors.push(commandError('duplicate-id', null, [asked.key, index, 'id'], message));
      return;
    }
    plans.push(plan);
    current = withPlan(current, asked.kind, plan, context);
  });
  if (chosenIds.length > 0) {
    const message = `${asked.idsKey} has ${String(chosenIds.length)} more ids than ${asked.key} items that create a style`;
    errors.push(commandError('invalid-input', null, [asked.idsKey], message));
  }
  return { plans, tables: current };
}

/**
 * The tables with a planned write over the kind's.
 *
 * @param tables - The tables so far.
 * @param kind - The planned style's kind.
 * @param plan - The plan.
 * @param context - The command's context, for a new entry's creator.
 * @returns The tables after the item.
 */
function withPlan(
  tables: Tables,
  kind: StyleKind,
  plan: SetNamedStylePlan,
  context: CommandContext,
): Tables {
  if (plan.style === null) return tables;
  const table = tables[kind] as ReadonlyMap<StyleId, { createdBy: unknown; createdAt: number }>;
  const previous = table.get(plan.id);
  const entry = {
    ...plan.style,
    createdBy: previous?.createdBy ?? context.origin.principalId,
    createdAt: previous?.createdAt ?? plan.createdAt,
  };
  return { ...tables, [kind]: new Map([...table, [plan.id, entry]]) };
}

/**
 * The composed command's part of the input: everything but the style items.
 *
 * @param input - The input.
 * @returns `createObjectsWithTokens`' input with tokens, else `createObjects`'.
 */
function innerInputOf(input: CreateObjectsWithStylesInput): Record<string, unknown> {
  const inner: Partial<CreateObjectsWithStylesInput> = { ...input };
  delete inner.textStyles;
  delete inner.effectStyles;
  delete inner.newTextStyleIds;
  delete inner.newEffectStyleIds;
  if (inner.tokens === undefined) delete inner.newTokenIds;
  return inner;
}

/** The objects' command as this one runs it: its token results absent without tokens. */
type InnerCommand = Command<
  z.ZodType,
  CreateObjectsPlan,
  CreateObjectsResult & { readonly tokens?: readonly TokenItemResult[] }
>;

/**
 * The command the objects (and tokens) are created with.
 *
 * @param hasTokens - Whether the input has token items.
 * @returns `createObjectsWithTokens` with token items, else `createObjects`.
 */
function innerCommandFor(hasTokens: boolean): InnerCommand {
  return hasTokens ? createObjectsWithTokensCommand : createObjectsCommand;
}

/**
 * A style item's outcome, from its plan.
 *
 * @param plan - The item's plan.
 * @returns The outcome.
 */
function itemResultOf(plan: SetNamedStylePlan): StyleItemResult {
  return { id: plan.id, isCreated: plan.isCreated, isChanged: plan.style !== null };
}

/**
 * `createObjectsWithStyles`: `setTextStyle` for each text style item, then
 * `setEffectStyle` for each effect style item, in order, then `createObjectsWithTokens` (or
 * `createObjects` without token items), in one transaction and one undo step; refused as a whole
 * (a style item's errors under `['textStyles' | 'effectStyles', index]`), nothing written. Objects
 * may name the styles the input creates, by the ids in `newTextStyleIds` and `newEffectStyleIds`.
 * A creation large enough to split writes the styles in its first part.
 */
export const createObjectsWithStylesCommand: Command<
  typeof createObjectsWithStylesInputSchema,
  CreateObjectsWithStylesPlan,
  CreateObjectsWithStylesResult
> = {
  name: 'createObjectsWithStyles',
  description:
    'Creates or updates named text and effect styles and colour tokens, then creates several objects that may use them, in one step.',
  input: createObjectsWithStylesInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const board = {
      text: stylesOf(context.board, 'text'),
      effect: stylesOf(context.board, 'effect'),
    };
    const text = planKind(
      context,
      board,
      {
        kind: 'text',
        key: 'textStyles',
        idsKey: 'newTextStyleIds',
        items: input.textStyles ?? [],
        chosen: input.newTextStyleIds ?? [],
      },
      errors,
    );
    const effect = planKind(
      context,
      text.tables,
      {
        kind: 'effect',
        key: 'effectStyles',
        idsKey: 'newEffectStyleIds',
        items: input.effectStyles ?? [],
        chosen: input.newEffectStyleIds ?? [],
      },
      errors,
    );
    const inner = innerCommandFor(input.tokens !== undefined);
    const objects = inner.validate(contextOver(context, effect.tables), innerInputOf(input));
    if (!objects.isValid) errors.push(...objects.errors);
    if (errors.length > 0 || !objects.isValid) return reject(errors);
    return accept({
      objects: objects.plan,
      textStylePlans: text.plans,
      effectStylePlans: effect.plans,
    });
  },
  apply(transaction, input, plan) {
    (input.textStyles ?? []).forEach((item, index) => {
      const itemPlan = plan.textStylePlans[index];
      if (itemPlan !== undefined) setTextStyleCommand.apply(transaction, item, itemPlan);
    });
    (input.effectStyles ?? []).forEach((item, index) => {
      const itemPlan = plan.effectStylePlans[index];
      if (itemPlan !== undefined) setEffectStyleCommand.apply(transaction, item, itemPlan);
    });
    const result = innerCommandFor(input.tokens !== undefined).apply(
      transaction,
      innerInputOf(input),
      plan.objects,
    );
    return {
      ids: result.ids,
      tokens: result.tokens ?? [],
      textStyles: plan.textStylePlans.map(itemResultOf),
      effectStyles: plan.effectStylePlans.map(itemResultOf),
    };
  },
  split(plan, options) {
    const inner = innerCommandFor('tokenPlans' in plan.objects);
    if (options?.maxWrites !== undefined) {
      const split = splitStyledByWrites(plan, options.maxWrites);
      return split === undefined
        ? undefined
        : {
            parts: split.parts,
            result: {
              ids: split.ids,
              tokens: split.tokens,
              textStyles: plan.textStylePlans.map(itemResultOf),
              effectStyles: plan.effectStylePlans.map(itemResultOf),
            },
          };
    }
    const parts = inner.split?.(plan.objects);
    if (parts === undefined) return undefined;
    const [first, ...rest] = parts.parts;
    if (first === undefined) return undefined;
    return {
      parts: [
        { ...plan, objects: first },
        ...rest.map((objects) => ({ objects, textStylePlans: [], effectStylePlans: [] })),
      ],
      result: {
        ids: parts.result.ids,
        tokens: parts.result.tokens ?? [],
        textStyles: plan.textStylePlans.map(itemResultOf),
        effectStyles: plan.effectStylePlans.map(itemResultOf),
      },
    };
  },
};
