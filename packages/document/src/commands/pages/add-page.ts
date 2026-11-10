import { z } from 'zod';

import { MAX_PAGE_NAME_LENGTH, pageIdSchema, type Page, type PageId } from '@canvas/schema';

import type { CommandError } from '../command-error.js';
import { accept, reject, type Command } from '../command.js';

import {
  defaultPageName,
  livePage,
  nextOrderAbove,
  orderBetween,
  pageLimitError,
  pageList,
} from './page-support.js';

/** Validates the input of {@link addPageCommand}. */
export const addPageInputSchema = z
  .strictObject({
    /** The page's name; default `Page N`, the smallest N not in use. */
    name: z
      .string()
      .max(MAX_PAGE_NAME_LENGTH)
      .optional()
      .describe('The page name, up to 200 characters; default "Page N".'),
    /** The page it follows; default: after the last page. */
    after: pageIdSchema.optional().describe('The page the new page follows; default: the last.'),
  })
  .describe('Adds a page to the board.');

/** What {@link addPageCommand} returns. */
export interface AddPageResult {
  /** The new page's id. */
  readonly pageId: PageId;
}

/** What {@link addPageCommand} will write. */
export interface AddPagePlan {
  /** The new page, whole. */
  readonly page: Page;
  /** The command's time, recorded in the page's identity. */
  readonly createdAt: number;
}

/**
 * `addPage`: adds a page, named `Page N` (the smallest N not in use)
 * unless named, after `after` or else last. Writes the page's three keys (and materialises the
 * virtual Page 1 first, as every page command does). Refused at `MAX_PAGES` or more live pages
 * (`too-many-pages`: a creation limit), for a name over 200 characters (`invalid-input`) and for
 * an `after` that is not a page (`missing-page`). One undo step.
 */
export const addPageCommand: Command<typeof addPageInputSchema, AddPagePlan, AddPageResult> = {
  name: 'addPage',
  description: 'Adds a page, after the given page or last; named "Page N" unless named.',
  input: addPageInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const limit = pageLimitError(context.board);
    if (limit !== undefined) errors.push(limit);
    const pages = pageList(context.board);
    const after =
      input.after === undefined
        ? pages.at(-1)
        : livePage(context.board, input.after, ['after'], errors);
    if (errors.length > 0 || after === undefined) return reject(errors);
    const order = orderBetween(
      pages,
      after.order,
      nextOrderAbove(pages, after.order),
      ['after'],
      errors,
    );
    if (order === undefined) return reject(errors);
    const id = context.createId() as string as PageId;
    const page = { id, name: input.name ?? defaultPageName(pages), order };
    return accept({ page, createdAt: context.now });
  },
  apply(transaction, input, plan) {
    transaction.setPage(plan.page, {
      createdBy: transaction.origin.principalId,
      createdAt: plan.createdAt,
    });
    return { pageId: plan.page.id };
  },
};
