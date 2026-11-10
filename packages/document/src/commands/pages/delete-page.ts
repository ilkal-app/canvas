import { z } from 'zod';

import { pageIdSchema, type PageId } from '@canvas/schema';

import { commandError, type CommandError } from '../command-error.js';
import { accept, reject, type Command } from '../command.js';
import { splitComponentDeletion } from '../component-command-parts.js';
import { deleteObjectsCommand, type DeleteObjectsPlan } from '../delete-objects.js';
import { ENTRY_WRITES } from '../write-budget.js';

import { livePage, objectsOnPage, pageList } from './page-support.js';

/** Validates the input of {@link deletePageCommand}. */
export const deletePageInputSchema = z
  .strictObject({
    /** The page to delete, with every object on it. */
    pageId: pageIdSchema.describe('The page to delete, with every object on it.'),
  })
  .describe('Deletes a page and every object on it.');

/** What {@link deletePageCommand} returns. */
export interface DeletePageResult {
  /** Every object deleted, sorted. */
  readonly deletedIds: readonly string[];
}

/** What {@link deletePageCommand} will write. */
export interface DeletePagePlan {
  /** The page whose keys go, or `null` in a part that deletes only objects. */
  readonly pageId: PageId | null;
  /** The objects deleted, and the references elsewhere detached, as `deleteObjects` plans. */
  readonly objects: DeleteObjectsPlan;
}

/**
 * `deletePage`: deletes a page's keys and every object on it (the
 * root objects naming it, and their descendants), with `deleteObjects`' rules for anything that
 * refers to them. Refused for a page that is not live (`missing-page`) and for the only page left
 * (`last-page`). One undo step restores the page and every object. Past one transaction's worth
 * of objects it is written in parts, the page's keys last, so a peer never sees the page gone
 * while objects still name it.
 */
export const deletePageCommand: Command<
  typeof deletePageInputSchema,
  DeletePagePlan,
  DeletePageResult
> = {
  name: 'deletePage',
  isPlacePreserving: true,
  description: 'Deletes a page and every object on it; the last page cannot be deleted.',
  input: deletePageInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const page = livePage(context.board, input.pageId, ['pageId'], errors);
    if (page !== undefined && pageList(context.board).length <= 1) {
      const message = `"${page.id}" is the only page; a board keeps at least one`;
      errors.push(commandError('last-page', null, ['pageId'], message));
    }
    if (page === undefined || errors.length > 0) return reject(errors);
    const { roots } = objectsOnPage(context.board, page.id);
    const objects = deleteObjectsCommand.validate(context, {
      ids: roots,
      connectorPolicy: 'detach',
    });
    if (!objects.isValid) return reject(objects.errors);
    const survivingPage = pageList(context.board).find(({ id }) => id !== page.id);
    if (survivingPage === undefined) return reject(errors);
    const updated = objects.plan.updated.map((object) =>
      object.parentId === null && object.pageId === page.id
        ? { ...object, pageId: survivingPage.id }
        : object,
    );
    return accept({ pageId: page.id, objects: { ...objects.plan, updated } });
  },
  apply(transaction, input, plan) {
    const result = deleteObjectsCommand.apply(
      transaction,
      { ids: [], connectorPolicy: 'detach' },
      plan.objects,
    );
    if (plan.pageId !== null) transaction.deletePage(plan.pageId);
    return { deletedIds: result.deletedIds };
  },
  split(plan, options) {
    // The page's deletion is one more planned write of the last part.
    const split = splitComponentDeletion(
      plan.objects,
      options,
      plan.pageId === null ? 0 : ENTRY_WRITES,
    );
    if (split === undefined) return undefined;
    const last = split.parts.length - 1;
    return {
      parts: split.parts.map((objects, index) => ({
        pageId: index === last ? plan.pageId : null,
        objects,
      })),
      result: { deletedIds: plan.objects.deletedIds },
    };
  },
};
