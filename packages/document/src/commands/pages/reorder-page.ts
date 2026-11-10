import { z } from 'zod';

import { pageIdSchema, type Page } from '@canvas/schema';

import type { CommandError } from '../command-error.js';
import { accept, reject, type Command } from '../command.js';

import {
  livePage,
  nextOrderAbove,
  nextOrderBelow,
  orderBetween,
  pageList,
} from './page-support.js';

/** Validates the input of {@link reorderPageCommand}. */
export const reorderPageInputSchema = z
  .strictObject({
    /** The page to move. */
    pageId: pageIdSchema.describe('The page to move.'),
    /** The page it then follows; give this or `before`. */
    after: pageIdSchema.optional().describe('The page it then follows; give this or before.'),
    /** The page it then precedes; give this or `after`. */
    before: pageIdSchema.optional().describe('The page it then precedes; give this or after.'),
  })
  .refine((input) => (input.after === undefined) !== (input.before === undefined), {
    message: 'give exactly one of after and before',
  })
  .describe('Moves a page in the page order, after or before another page.');

/** What {@link reorderPageCommand} returns. */
export interface ReorderPageResult {
  /** Whether the page's order key changed. */
  readonly isChanged: boolean;
}

/** What {@link reorderPageCommand} will write. */
export interface ReorderPagePlan {
  /** The page with its new order key, or `null` when it stays where it is. */
  readonly page: Page | null;
}

/**
 * `reorderPage`: moves a page after or before another, writing its
 * `.order` key alone (a key between the neighbours, z-order's generator), so it merges with a
 * concurrent rename. Equal keys from concurrent reorders are ordered by id on every client (R5).
 * Refused for a page that is not live (`missing-page`) and when no key fits between the
 * neighbours (`unorderable-neighbours`). One undo step.
 */
export const reorderPageCommand: Command<
  typeof reorderPageInputSchema,
  ReorderPagePlan,
  ReorderPageResult
> = {
  name: 'reorderPage',
  description: 'Moves a page after or before another page.',
  input: reorderPageInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const page = livePage(context.board, input.pageId, ['pageId'], errors);
    const isAfter = input.after !== undefined;
    const neighbourId = input.after ?? input.before;
    const neighbour =
      neighbourId === undefined
        ? undefined
        : livePage(context.board, neighbourId, [isAfter ? 'after' : 'before'], errors);
    if (page === undefined || neighbour === undefined) return reject(errors);
    if (page.id === neighbour.id) return accept({ page: null });
    const others = pageList(context.board).filter(({ id }) => id !== page.id);
    const [lower, upper] = isAfter
      ? [neighbour.order, nextOrderAbove(others, neighbour.order)]
      : [nextOrderBelow(others, neighbour.order), neighbour.order];
    const order = orderBetween(others, lower, upper, [isAfter ? 'after' : 'before'], errors);
    if (order === undefined) return reject(errors);
    return accept({ page: order === page.order ? null : { ...page, order } });
  },
  apply(transaction, input, plan) {
    if (plan.page !== null) {
      transaction.setPage(plan.page, {
        createdBy: transaction.origin.principalId,
        createdAt: 0,
      });
    }
    return { isChanged: plan.page !== null };
  },
};
