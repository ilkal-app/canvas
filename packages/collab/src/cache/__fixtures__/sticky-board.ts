import type { TransactionOrigin, DocumentStore } from '@canvas/document';
import {
  createSeededIdGenerator,
  type BoardObject,
  type ObjectId,
  type PrincipalId,
} from '@canvas/schema';

/** Ada, editing the board in these tests. */
export const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

/** Bob, editing the board from another client. */
export const BOB: TransactionOrigin = { kind: 'user', principalId: 'user:bob' as PrincipalId };

/**
 * Builds a valid sticky note: the smallest object with text, enough for sync and cache tests.
 *
 * @param id - The object id.
 * @param index - Places the sticky and picks its text.
 * @returns The sticky.
 */
export function sticky(id: string, index = 0): BoardObject {
  const text = `note ${String(index)}`;
  return {
    id,
    type: 'sticky',
    parentId: null,
    x: (index % 100) * 220,
    y: Math.floor(index / 100) * 220,
    rotation: 0,
    // A fractional-index key: integer a0, then the padded index; the final V keeps the fraction
    // from ending in 0.
    z: `a0${String(index).padStart(6, '0')}V`,
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
    width: 200,
    height: 200,
    text,
    runs: [
      {
        length: text.length,
        style: {
          fontFamily: 'Inter',
          fontSize: 16,
          color: [0.1, 0.1, 0.12, 1],
          weight: 400,
          italic: false,
        },
      },
    ],
    align: 'left',
    verticalAlign: 'top',
    autoWidth: false,
    color: [1, 0.92, 0.55, 1],
  } as BoardObject;
}

/** How {@link addStickies} writes its stickies. */
export interface AddStickiesOptions {
  /** The id generator's seed; default 1. */
  readonly seed?: number;
  /** The origin of the transactions; default {@link ADA}. */
  readonly origin?: TransactionOrigin;
  /** How many stickies per transaction; default all in one. */
  readonly batchSize?: number;
}

/**
 * Creates stickies in one transaction per `batchSize` objects, with seeded ids.
 *
 * @param store - The store to write to.
 * @param count - How many stickies.
 * @param options - The seed of the ids, the origin and how many objects per transaction.
 * @returns The ids, in creation order.
 */
export function addStickies(
  store: DocumentStore,
  count: number,
  options: AddStickiesOptions = {},
): ObjectId[] {
  const nextId = createSeededIdGenerator(options.seed ?? 1);
  const ids = Array.from({ length: count }, () => nextId());
  const batchSize = options.batchSize ?? count;
  for (let start = 0; start < count; start += batchSize) {
    store.transact(options.origin ?? ADA, (transaction) => {
      for (let index = start; index < Math.min(count, start + batchSize); index += 1) {
        transaction.setObject(sticky(ids[index] as string, index));
      }
    });
  }
  return ids;
}
