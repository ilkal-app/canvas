import type { ObjectId } from '@canvas/schema';

import type { CreateObjectsPlan } from '../create-objects.js';
import { createObjectsCommand } from '../create-objects.js';
import {
  createObjectsWithTokensCommand,
  type CreateObjectsWithTokensPlan,
  itemResultOf as tokenItemResultOf,
  type TokenItemResult,
} from '../tokens/create-objects-with-tokens.js';
import { ENTRY_WRITES, OBJECT_WRITES } from '../write-budget.js';

/** A creation with named styles, as `createObjectsWithStyles` plans it. */
interface StyledPlan<Style> {
  /** The objects' (and tokens') plan. */
  readonly objects: CreateObjectsPlan;
  /** Each text style item's plan, in input order. */
  readonly textStylePlans: readonly Style[];
  /** Each effect style item's plan, in input order. */
  readonly effectStylePlans: readonly Style[];
}

/**
 * Splits a creation with named styles into parts of at most `maxWrites` planned writes:
 * the styles first, in a part of their own (an entry each; `apply` reads them by input index, so
 * they stay together), then the objects' and tokens' parts as their command splits them. A style
 * is on the board before the first object that names it.
 *
 * @param plan - The validated plan.
 * @param maxWrites - The budget per part.
 * @returns The parts, and the ids and token results of the whole; or `undefined` when the plan
 *   fits one part.
 */
export function splitStyledByWrites<Style>(
  plan: StyledPlan<Style>,
  maxWrites: number,
):
  | {
      readonly parts: StyledPlan<Style>[];
      readonly ids: ObjectId[];
      readonly tokens: TokenItemResult[];
    }
  | undefined {
  const tokenPlans =
    'tokenPlans' in plan.objects ? (plan.objects as CreateObjectsWithTokensPlan).tokenPlans : [];
  const styles = (plan.textStylePlans.length + plan.effectStylePlans.length) * ENTRY_WRITES;
  const tokens = tokenPlans.filter((tokenPlan) => tokenPlan.token !== null).length * ENTRY_WRITES;
  if (styles + tokens + plan.objects.objects.length * OBJECT_WRITES <= maxWrites) return undefined;
  const inner =
    'tokenPlans' in plan.objects ? createObjectsWithTokensCommand : createObjectsCommand;
  const split = inner.split?.(plan.objects, { maxWrites });
  const innerParts = split?.parts ?? [plan.objects];
  const unstyled = (objects: CreateObjectsPlan): StyledPlan<Style> => ({
    objects,
    textStylePlans: [],
    effectStylePlans: [],
  });
  const empty = 'tokenPlans' in plan.objects ? { objects: [], tokenPlans: [] } : { objects: [] };
  return {
    parts:
      styles === 0
        ? innerParts.map(unstyled)
        : [{ ...plan, objects: empty }, ...innerParts.map(unstyled)],
    ids: plan.objects.objects.map((object) => object.id),
    tokens: tokenPlans.map(tokenItemResultOf),
  };
}
