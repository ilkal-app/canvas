import { z } from 'zod';

import {
  compareSiblings,
  pageIdSchema,
  type BoardObject,
  type ObjectId,
  type Page,
  type PageId,
} from '@canvas/schema';

import { pagesOf } from '../command-checks.js';
import { commandError, type CommandError } from '../command-error.js';
import { accept, reject, type BoardReader, type Command } from '../command.js';
import { splitCreatedObjects } from '../create-objects-parts.js';
import { createObjectsCommand, createObjectsInputSchema } from '../create-objects.js';
import { ENTRY_WRITES } from '../write-budget.js';

import {
  copyName,
  livePage,
  nextOrderAbove,
  objectsOnPage,
  orderBetween,
  pageLimitError,
  pageList,
} from './page-support.js';

/** Validates the input of {@link duplicatePageCommand}. */
export const duplicatePageInputSchema = z
  .strictObject({
    /** The page to copy. */
    pageId: pageIdSchema.describe('The page to copy, with every object on it.'),
  })
  .describe('Copies a page and every object on it, right after it.');

/** What {@link duplicatePageCommand} returns. */
export interface DuplicatePageResult {
  /** The new page's id. */
  readonly pageId: PageId;
  /** Each copy's id to the object it copies; empty for an empty page. */
  readonly copiedFrom: Readonly<Record<ObjectId, ObjectId>>;
}

/** What {@link duplicatePageCommand} will write. */
export interface DuplicatePagePlan {
  /** The new page, or `null` in a part that only creates objects. */
  readonly page: Page | null;
  /** The new page's id, in every part. */
  readonly pageId: PageId;
  /** The command's time, recorded in the page's identity. */
  readonly createdAt: number;
  /** The copies, whole and validated, referents first. */
  readonly objects: readonly BoardObject[];
  /** Each copy's id to the object it copies, every copy in every part. */
  readonly copiedFrom: Readonly<Record<ObjectId, ObjectId>>;
}

/** The fields `createObjects` generates, which a copy leaves out. */
const GENERATED_FIELDS = ['z', 'createdBy', 'createdAt', 'updatedAt', 'pageId'] as const;

/**
 * The objects of a page as `createObjects` entries: each parent's children bottom first, so the
 * copies stack as the originals do; ids, parents, connector ends and anchors as on the board
 * (`createObjects` gives fresh ids and follows the references between listed objects).
 *
 * @param board - The board.
 * @param roots - The page's root objects.
 * @returns The entries.
 */
function entriesOf(board: BoardReader, roots: readonly ObjectId[]): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  const pending: ObjectId[][] = [[...roots]];
  for (let level = pending.pop(); level !== undefined; level = pending.pop()) {
    const objects = level.flatMap((id) => board.get(id) ?? []).sort(compareSiblings);
    for (const object of objects) {
      const entry: Record<string, unknown> = { ...object };
      for (const field of GENERATED_FIELDS) Reflect.deleteProperty(entry, field);
      entries.push(entry);
      const children = [...board.references.childrenOf(object.id)];
      if (children.length > 0) pending.push(children);
    }
  }
  return entries;
}

/**
 * The refusal of a copy whose source holds a field a peer left invalid: each issue as an
 * `invalid-object` error naming the source object and the field (a copy is a new object, judged
 * whole, so it never carries the invalid value on).
 *
 * @param entries - The copied entries, by the input's index.
 * @param issues - The issues of the copy's input.
 * @returns The errors.
 */
function copyErrors(
  entries: readonly Record<string, unknown>[],
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): CommandError[] {
  return issues.map(({ path, message }) => {
    const [, index, ...rest] = path;
    const source = typeof index === 'number' ? entries[index]?.id : undefined;
    const field = rest.map((key) => (typeof key === 'number' ? key : String(key)));
    return commandError(
      'invalid-object',
      typeof source === 'string' ? source : null,
      field,
      message,
    );
  });
}

/**
 * The refusals of the copies' creation, named as the copy's source: an error at a listed entry
 * (`['objects', index, ...field]`) names the source object and the field, as {@link copyErrors}
 * does, so the refusal names an object of the board, not a copy that was never written.
 *
 * @param entries - The copied entries, by the input's index.
 * @param errors - The creation's errors.
 * @returns The errors, named as their sources.
 */
function sourceErrors(
  entries: readonly Record<string, unknown>[],
  errors: readonly CommandError[],
): CommandError[] {
  return errors.map((error) => {
    const [list, index, ...rest] = error.path;
    const source = list === 'objects' && typeof index === 'number' ? entries[index]?.id : undefined;
    return typeof source === 'string' ? { ...error, objectId: source, path: rest } : error;
  });
}

/**
 * `duplicatePage`: a new page right after the source, named
 * `<name> copy` (cut to 200 characters), and a copy of every object on it with new ids, the
 * references inside the page remapped (parents, connector ends, comment anchors; a comment's
 * thread is relational and is not copied), stacked as the originals. Refused for a page that is
 * not live (`missing-page`) and at `MAX_PAGES` or more pages (`too-many-pages`). One undo step;
 * past one transaction's worth of objects it is written in parts, the page first.
 */
export const duplicatePageCommand: Command<
  typeof duplicatePageInputSchema,
  DuplicatePagePlan,
  DuplicatePageResult
> = {
  name: 'duplicatePage',
  description: 'Copies a page and every object on it into a new page right after it.',
  input: duplicatePageInputSchema,
  validate(context, input) {
    const errors: CommandError[] = [];
    const limit = pageLimitError(context.board);
    if (limit !== undefined) errors.push(limit);
    const source = livePage(context.board, input.pageId, ['pageId'], errors);
    if (source === undefined || errors.length > 0) return reject(errors);
    const pages = pageList(context.board);
    const order = orderBetween(
      pages,
      source.order,
      nextOrderAbove(pages, source.order),
      ['pageId'],
      errors,
    );
    if (order === undefined) return reject(errors);
    const page: Page = {
      id: context.createId() as string as PageId,
      name: copyName(source.name),
      order,
    };
    const { roots } = objectsOnPage(context.board, source.id);
    const planned = { page, pageId: page.id, createdAt: context.now };
    if (roots.length === 0) return accept({ ...planned, objects: [], copiedFrom: {} });
    const board: BoardReader = {
      get: (id) => context.board.get(id),
      references: context.board.references,
      readPages: () => new Map([...pagesOf(context.board), [page.id, page]]),
    };
    // A copy is a new object, judged whole: a field a peer left invalid refuses the copy
    // (`invalid-object`), never throws.
    const entries = entriesOf(context.board, roots);
    const copyInput = createObjectsInputSchema.safeParse({ objects: entries, pageId: page.id });
    if (!copyInput.success) return reject(copyErrors(entries, copyInput.error.issues));
    const copies = createObjectsCommand.validate({ ...context, board }, copyInput.data);
    if (!copies.isValid) return reject(sourceErrors(entries, copies.errors));
    // `createObjects` plans its objects in input order, one per entry.
    const copiedFrom = Object.fromEntries(
      copies.plan.objects.map((copy, index) => [copy.id, entries[index]?.id as ObjectId]),
    );
    return accept({ ...planned, objects: copies.plan.objects, copiedFrom });
  },
  apply(transaction, input, plan) {
    if (plan.page !== null) {
      transaction.setPage(plan.page, {
        createdBy: transaction.origin.principalId,
        createdAt: plan.createdAt,
      });
    }
    createObjectsCommand.apply(transaction, { objects: [], parentId: null }, plan);
    return { pageId: plan.page?.id ?? plan.pageId, copiedFrom: plan.copiedFrom };
  },
  split(plan, options) {
    // The page is one more planned write of the first part.
    const split = splitCreatedObjects(plan, options, plan.page === null ? 0 : ENTRY_WRITES);
    if (split === undefined || plan.page === null) return undefined;
    return {
      parts: split.parts.map(({ objects }, index) => ({
        ...plan,
        page: index === 0 ? plan.page : null,
        objects,
      })),
      result: { pageId: plan.page.id, copiedFrom: plan.copiedFrom },
    };
  },
};
