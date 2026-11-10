import { z } from 'zod';

import { MAX_PAGE_NAME_LENGTH, pageIdSchema, type Page } from '@canvas/schema';

import type { CommandError } from '../command-error.js';
import { accept, reject, type Command } from '../command.js';

import { livePage } from './page-support.js';

/** Validates the input of {@link renamePageCommand}. */
export const renamePageInputSchema = z
  .strictObject({
    /** The page. */
    pageId: pageIdSchema.describe('The page to rename.'),
    /** Its new name, up to 200 characters. */
    name: z.string().max(MAX_PAGE_NAME_LENGTH).describe('The new name, up to 200 characters.'),
  })
  .describe("Sets a page's name.");

/** What {@link renamePageCommand} returns. */
export interface RenamePageResult {
  /** Whether the name changed; false when the page already had it. */
  readonly isChanged: boolean;
}

/** What {@link renamePageCommand} will write: the page as renamed, or nothing. */
export interface RenamePagePlan {
  /** The page with its new name, or `null` when the name does not change. */
  readonly page: Page | null;
}

/**
 * `renamePage`: sets a page's name, its `.name` key alone, so it
 * merges with a concurrent reorder. Renaming the virtual Page 1 materialises it with the identity
 * every client writes alike, so a concurrent add elsewhere keeps the rename. Refused for a page
 * that is not live (`missing-page`) and a name over 200 characters (`invalid-input`). One undo
 * step.
 */
export const renamePageCommand: Command<
  typeof renamePageInputSchema,
  RenamePagePlan,
  RenamePageResult
> = {
  name: 'renamePage',
  description: "Sets a page's name; up to 200 characters.",
  input: renamePageInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const page = livePage(context.board, input.pageId, ['pageId'], errors);
    if (page === undefined) return reject(errors);
    return accept({ page: page.name === input.name ? null : { ...page, name: input.name } });
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
