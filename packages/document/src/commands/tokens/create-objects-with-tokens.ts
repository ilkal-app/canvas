import { z } from 'zod';

import {
  isBuiltinToken,
  type ObjectId,
  tokenIdSchema,
  type TokenEntry,
  type TokenId,
  type TokenTable,
} from '@canvas/schema';

import { MAX_BATCH_ITEMS } from '../batch-command.js';
import { commandError, type CommandError } from '../command-error.js';
import {
  accept,
  reject,
  type Command,
  type CommandContext,
  type CommandParts,
} from '../command.js';
import { orderByReferences } from '../create-objects-parts.js';
import {
  createObjectsCommand,
  createObjectsInputSchema,
  type CreateObjectsPlan,
  type CreateObjectsResult,
} from '../create-objects.js';
import { ENTRY_WRITES, OBJECT_WRITES, packByWrites } from '../write-budget.js';

import {
  setColorTokenCommand,
  setColorTokenInputSchema,
  type SetColorTokenPlan,
} from './set-color-token.js';
import { tokensOf } from './token-support.js';

// `createObjectsWithTokens`: colour tokens and the objects that use them in one
// command, so one transaction and one undo step, as `duplicatePage` composes a page and
// `createObjects`. Each token item is `setColorToken`'s input, planned in order against the
// board plus the items before it, so a later item sees an earlier one's name and the count
// toward the 64-token limit includes the call's own.

/** The most token items one call takes, as every batched write. */
export const MAX_TOKEN_ITEMS = MAX_BATCH_ITEMS;

/** Validates the input of {@link createObjectsWithTokensCommand}. */
export const createObjectsWithTokensInputSchema = createObjectsInputSchema.extend({
  /** The colour tokens to set first, each `setColorToken`'s input, in order. */
  tokens: z
    .array(setColorTokenInputSchema)
    .min(1)
    .max(MAX_TOKEN_ITEMS)
    .describe(
      'Colour tokens to create (no id) or update (an id) before the objects, each { id?, name, light, dark }, in order; 1 to 100.',
    ),
  /**
   * The ids the new tokens take, in the order of the token items that have no `id` (the caller
   * chose them, so objects in the same input can already name them); fresh ids when absent.
   */
  newTokenIds: z
    .array(tokenIdSchema)
    .max(MAX_TOKEN_ITEMS)
    .optional()
    .describe('The ids the created tokens take, in order; chosen by the command when omitted.'),
});

/** The parsed input of {@link createObjectsWithTokensCommand}. */
export type CreateObjectsWithTokensInput = z.output<typeof createObjectsWithTokensInputSchema>;

/** One token item's outcome. */
export interface TokenItemResult {
  /** The token's id: the new one for a created token. */
  readonly id: TokenId;
  /** Whether it was created. */
  readonly isCreated: boolean;
  /** Whether anything changed. */
  readonly isChanged: boolean;
}

/** What {@link createObjectsWithTokensCommand} returns. */
export interface CreateObjectsWithTokensResult extends CreateObjectsResult {
  /** Each token item's outcome, in input order. */
  readonly tokens: readonly TokenItemResult[];
}

/** What {@link createObjectsWithTokensCommand} will write. */
export interface CreateObjectsWithTokensPlan extends CreateObjectsPlan {
  /** Each token item's plan, in input order; empty in a split's later parts. */
  readonly tokenPlans: readonly SetColorTokenPlan[];
}

/** One write of a budgeted token creation: a token entry, or an object written whole. */
type TokenCreationWrite =
  | { readonly kind: 'token'; readonly plan: SetColorTokenPlan }
  | { readonly kind: 'object'; readonly object: CreateObjectsPlan['objects'][number] };

/**
 * Splits a creation with tokens into parts of at most `maxWrites` planned writes: the
 * tokens it writes first, an entry each, then the objects referents first, two writes each; so a
 * token is on the board no later than the first object that refers to it.
 *
 * @param plan - The validated plan.
 * @param maxWrites - The budget per part.
 * @returns The parts and the command's result, or `undefined` when the plan fits one part.
 */
function splitByWrites(
  plan: CreateObjectsWithTokensPlan,
  maxWrites: number,
): CommandParts<CreateObjectsWithTokensPlan, CreateObjectsWithTokensResult> | undefined {
  const written = plan.tokenPlans.filter((tokenPlan) => tokenPlan.token !== null);
  if (written.length * ENTRY_WRITES + plan.objects.length * OBJECT_WRITES <= maxWrites) {
    return undefined;
  }
  const writes: TokenCreationWrite[] = [
    ...written.map((tokenPlan) => ({ kind: 'token' as const, plan: tokenPlan })),
    ...orderByReferences(plan.objects).map((object) => ({ kind: 'object' as const, object })),
  ];
  const parts = packByWrites(
    writes,
    (write) => (write.kind === 'token' ? ENTRY_WRITES : OBJECT_WRITES),
    maxWrites,
  );
  return {
    parts: parts.map((part) => ({
      objects: part.flatMap((write) => (write.kind === 'object' ? [write.object] : [])),
      tokenPlans: part.flatMap((write) => (write.kind === 'token' ? [write.plan] : [])),
    })),
    result: {
      ids: plan.objects.map((object) => object.id),
      tokens: plan.tokenPlans.map(itemResultOf),
    },
  };
}

/**
 * The board as a token item sees it: the board's tokens, with the earlier items' writes over
 * them.
 *
 * @param context - The command's context.
 * @param table - The token table so far.
 * @returns The context for the next item.
 */
function contextOver(context: CommandContext, table: TokenTable): CommandContext {
  // The reader is often a class instance (the store), so it is wrapped, not spread: every
  // other read goes to it, its methods bound to it.
  const { board } = context;
  const reader = new Proxy(board, {
    get(target, key) {
      if (key === 'readTokens') return () => table;
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function'
        ? (value as (...args: never[]) => unknown).bind(target)
        : value;
    },
  });
  return { ...context, board: reader };
}

/**
 * The table with a planned write over it.
 *
 * @param table - The table so far.
 * @param plan - The item's plan.
 * @param createdBy - Who creates a new entry.
 * @returns The table after the item.
 */
function withPlan(
  table: TokenTable,
  plan: SetColorTokenPlan,
  createdBy: TokenEntry['createdBy'],
): TokenTable {
  if (plan.token === null) return table;
  const previous = table.get(plan.id);
  const entry: TokenEntry = {
    ...plan.token,
    builtin: isBuiltinToken(plan.id),
    createdBy: previous?.createdBy ?? createdBy,
    createdAt: previous?.createdAt ?? plan.createdAt,
  };
  return new Map([...table, [plan.id, entry]]);
}

/**
 * Plans the token items in order, each against the board and the items before it.
 *
 * @param context - The command's context.
 * @param input - The input.
 * @param errors - Where each item's refusals go, their paths under `['tokens', index]`.
 * @returns The plans, one per item (incomplete when there are errors), and the token table
 *   after them, which the objects are checked against.
 */
function planTokens(
  context: CommandContext,
  input: CreateObjectsWithTokensInput,
  errors: CommandError[],
): { readonly plans: readonly SetColorTokenPlan[]; readonly table: TokenTable } {
  const plans: SetColorTokenPlan[] = [];
  const chosenIds = [...(input.newTokenIds ?? [])];
  let table = tokensOf(context.board);
  input.tokens.forEach((item, index) => {
    const chosen = item.id === undefined ? chosenIds.shift() : undefined;
    const itemContext = contextOver(context, table);
    const validation = setColorTokenCommand.validate(
      chosen === undefined ? itemContext : { ...itemContext, createId: () => chosen as ObjectId },
      item,
    );
    if (!validation.isValid) {
      errors.push(
        ...validation.errors.map((error) => ({ ...error, path: ['tokens', index, ...error.path] })),
      );
      return;
    }
    const { plan } = validation;
    if (chosen !== undefined && plan.id !== chosen) {
      const message = `the colour token id "${chosen}" is taken`;
      errors.push(commandError('duplicate-id', null, ['tokens', index, 'id'], message));
      return;
    }
    plans.push(plan);
    table = withPlan(table, plan, context.origin.principalId);
  });
  if (chosenIds.length > 0) {
    const message = `newTokenIds has ${String(chosenIds.length)} more ids than token items that create a token`;
    errors.push(commandError('invalid-input', null, ['newTokenIds'], message));
  }
  return { plans, table };
}

/**
 * The `createObjects` part of the input: everything but the token items.
 *
 * @param input - The input.
 * @returns The objects' input.
 */
function objectsInputOf(
  input: CreateObjectsWithTokensInput,
): z.output<typeof createObjectsInputSchema> {
  const objectsInput: Partial<CreateObjectsWithTokensInput> = { ...input };
  delete objectsInput.tokens;
  delete objectsInput.newTokenIds;
  return objectsInput as z.output<typeof createObjectsInputSchema>;
}

/**
 * A token item's outcome, from its plan; what `createObjectsWithTokens` reports per item, and
 * what a composing command's split reports for it.
 *
 * @param plan - The item's plan.
 * @returns The outcome.
 */
export function itemResultOf(plan: SetColorTokenPlan): TokenItemResult {
  return { id: plan.id, isCreated: plan.isCreated, isChanged: plan.token !== null };
}

/**
 * `createObjectsWithTokens`: `setColorToken` for each token item, in order, then
 * `createObjects`, in one transaction and one undo step; refused as a whole (a token item's
 * errors under `['tokens', index]`), nothing written. Objects may name the tokens the input
 * creates, by the ids in `newTokenIds`. A creation large enough to split writes the tokens in
 * its first part.
 */
export const createObjectsWithTokensCommand: Command<
  typeof createObjectsWithTokensInputSchema,
  CreateObjectsWithTokensPlan,
  CreateObjectsWithTokensResult
> = {
  name: 'createObjectsWithTokens',
  description:
    'Creates or updates colour tokens, then creates several objects that may use them, in one step.',
  input: createObjectsWithTokensInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const { plans: tokenPlans, table } = planTokens(context, input, errors);
    // The objects see the tokens the items write, so they may use the new ones.
    const objects = createObjectsCommand.validate(
      contextOver(context, table),
      objectsInputOf(input),
    );
    if (!objects.isValid) errors.push(...objects.errors);
    if (errors.length > 0 || !objects.isValid) return reject(errors);
    return accept({ ...objects.plan, tokenPlans });
  },
  apply(transaction, input, plan) {
    // As `setColorToken` writes: only the keys that change, the creator recorded for a new entry.
    for (const { token, createdAt } of plan.tokenPlans) {
      if (token !== null) {
        transaction.setToken(token, { createdBy: transaction.origin.principalId, createdAt });
      }
    }
    const { ids } = createObjectsCommand.apply(transaction, objectsInputOf(input), plan);
    return { ids, tokens: plan.tokenPlans.map(itemResultOf) };
  },
  split(plan, options) {
    if (options?.maxWrites !== undefined) return splitByWrites(plan, options.maxWrites);
    const parts = createObjectsCommand.split?.(plan);
    if (parts === undefined) return undefined;
    const [first, ...rest] = parts.parts;
    if (first === undefined) return undefined;
    return {
      parts: [
        { ...first, tokenPlans: plan.tokenPlans },
        ...rest.map((part) => ({ ...part, tokenPlans: [] })),
      ],
      result: { ...parts.result, tokens: plan.tokenPlans.map(itemResultOf) },
    };
  },
};
