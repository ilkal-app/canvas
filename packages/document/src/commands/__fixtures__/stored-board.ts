// A store's board as stored, parent cycles included. A store shows a stored parent cycle broken,
// as the repair will write it, so commands run on a store never meet one; their
// refusals of a board that loops (`parent-cycle`) are tested by validating on this board.
import { expect } from 'vitest';
import type { z } from 'zod';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { fromYjs } from '../../codec/object-codec.js';
import type { TransactionOrigin } from '../../origin/transaction-origin.js';
import { ADA } from '../../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../../store/document-store.js';
import { internalsOf } from '../../store/internal.js';
import { ReferenceIndex } from '../../store/reference-index.js';
import type { CommandError } from '../command-error.js';
import type { BoardReader, Command } from '../command.js';

import { NOW, testEnvironment } from './command-fixtures.js';

/**
 * Reads every entry of a store's document as stored, with reverse indexes over it.
 *
 * @param store - A `YjsDocumentStore`.
 * @returns The board as stored.
 */
export function storedBoardOf(store: DocumentStore): BoardReader {
  const objects = new Map<ObjectId, BoardObject>();
  internalsOf(store).objects.forEach((value, key) => {
    const decoded = fromYjs(key, value);
    if ('object' in decoded) objects.set(decoded.object.id, decoded.object);
  });
  const references = new ReferenceIndex();
  references.apply([...objects.values()].map((next) => ({ previous: undefined, next })));
  return { get: (id) => objects.get(id), references };
}

/**
 * Validates a command against a board, which must refuse it.
 *
 * @param board - The board.
 * @param command - The command.
 * @param input - Its input, before parsing.
 * @param origin - Who runs it; Ada by default.
 * @returns The errors.
 */
export function refusalsOn<InputSchema extends z.ZodType, Plan, Result>(
  board: BoardReader,
  command: Command<InputSchema, Plan, Result>,
  input: z.input<InputSchema>,
  origin: TransactionOrigin = ADA,
): readonly CommandError[] {
  const context = { board, origin, now: NOW, createId: testEnvironment().createId };
  const validation = command.validate(context, command.input.parse(input));
  expect(validation.isValid).toBe(false);
  return validation.isValid ? [] : validation.errors;
}
