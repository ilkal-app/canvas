import { equalityDeep } from 'lib0/function';
import { digest } from 'lib0/hash/sha256';
import { z } from 'zod';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { restoreMarkerSchema, type RestoreMarker } from '../meta/restore-marker.js';
import type { BoardSnapshot } from '../store/document-store.js';

import { checkObject } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command, type SplitOptions } from './command.js';
import { MAX_OBJECTS_PER_TRANSACTION, orderByReferences } from './create-objects-parts.js';
import { referrersFirst } from './delete-objects-parts.js';
import { openHistoricalStore } from './historical-store.js';
import { restoreDefinitions } from './restore-definitions.js';
import { DELETE_WRITES, ENTRY_WRITES, OBJECT_WRITES, packByWrites } from './write-budget.js';

/** A complete historical Yjs state, obtained from the authenticated history service. */
export const restoreBoardInputSchema = z.strictObject({
  /** Complete historical Yjs update used for planning, never replayed into the live store. */
  state: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
});

/** Fully validated object differences; historical CRDT clocks are never applied to the live store. */
export interface RestoreBoardPlan {
  /** Restored objects, ordered referents before referrers. */
  readonly objects: readonly BoardObject[];
  /** Objects absent from the chosen state, ordered referrers before referents. */
  readonly deletedIds: readonly ObjectId[];
  /** Intent written only when the plan contains object differences. */
  readonly marker?: RestoreMarker;
}

/**
 * Decodes a historical state without allowing reference repairs to alter its history.
 *
 * @param state - A full Yjs update, never applied directly to the live board.
 * @returns Its immutable projected board; invalid or incomplete states refuse restoration.
 * @throws {Error} If the bytes, layout or object projection cannot be read completely.
 */
function readChosenState(state: Uint8Array): BoardSnapshot {
  const chosen = openHistoricalStore(state);
  try {
    return chosen.read();
  } finally {
    chosen.destroy();
  }
}

/**
 * Compares meaningful object content; command time is assigned only to actual restored writes.
 *
 * @param object - One projected board object.
 * @returns Its content without the update timestamp.
 */
function contentOf(object: BoardObject): object {
  return Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'updatedAt'));
}

/**
 * Formats the injected fresh operation identity as a deterministic UUID without global entropy.
 *
 * @param id - Fresh id from the command environment's generator.
 * @returns The first 128 digest bits, with UUID version and variant bits.
 */
function restoreId(id: ObjectId): string {
  const bytes = digest(new TextEncoder().encode(id)).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Restores only differences as new writes under the caller's origin, preserving untouched work.
 * A board-wide snapshot is required because restoration also removes objects absent in history.
 * Binary history input is separate from the JSON-only agent command registry.
 */
export const restoreBoardCommand: Command<typeof restoreBoardInputSchema, RestoreBoardPlan, void> =
  {
    name: 'restoreBoard',
    description: 'Restores the chosen board state as new writes, in one undo step.',
    input: restoreBoardInputSchema,
    validate(context, input) {
      if (context.board.read === undefined)
        return reject([
          commandError('invalid-input', null, ['state'], 'A board snapshot is required'),
        ]);
      let chosen: BoardSnapshot;
      try {
        chosen = readChosenState(input.state);
      } catch {
        return reject([
          commandError('invalid-input', null, ['state'], 'The historical state cannot be read'),
        ]);
      }
      const current = context.board.read();
      const errors: CommandError[] = [];
      const objects: BoardObject[] = [];
      for (const object of chosen.objects.values()) {
        const previous = context.board.get(object.id);
        if (previous !== undefined && equalityDeep(contentOf(previous), contentOf(object)))
          continue;
        const valid = checkObject(context.board, object, errors);
        if (valid !== undefined) objects.push(valid);
      }
      const removed = new Set([...current.objects.keys()].filter((id) => !chosen.objects.has(id)));
      for (const issue of current.issues)
        if (!chosen.objects.has(issue.key as ObjectId)) removed.add(issue.key as ObjectId);
      objects.push(...restoreDefinitions(context.board, current, removed));
      return errors.length > 0
        ? reject(errors)
        : accept({
            objects: orderByReferences(objects),
            deletedIds: referrersFirst(current, [...removed]),
            ...(objects.length + removed.size > 0
              ? {
                  marker: restoreMarkerSchema.parse({
                    version: 1,
                    id: restoreId(context.createId()),
                    part: 0,
                    parts: 1,
                  }),
                }
              : {}),
          });
    },
    apply(transaction, input, plan) {
      for (const object of plan.objects) transaction.setObject(object);
      for (const id of plan.deletedIds) transaction.deleteObject(id);
      if (plan.marker !== undefined) transaction.markRestore(plan.marker);
    },
    split: splitRestore,
  };

/** One write of a budgeted restore: an object written whole, or an id deleted. */
type RestoreWrite =
  | { readonly kind: 'object'; readonly object: RestoreBoardPlan['objects'][number] }
  | { readonly kind: 'delete'; readonly id: RestoreBoardPlan['deletedIds'][number] };

/**
 * Orders replacement parts before removals, keeping additions referent-first and undo grouped.
 * Every part carries the restore marker, numbered over the final count of parts; with a write
 * budget the marker is one of each part's planned writes.
 *
 * @param plan - Completely validated board differences.
 * @param options - The write budget per part, if any.
 * @returns Bounded transactions, or undefined for an ordinary single transaction.
 */
function splitRestore(
  plan: RestoreBoardPlan,
  options: SplitOptions = {},
): { parts: RestoreBoardPlan[]; result: undefined } | undefined {
  const { maxWrites } = options;
  if (maxWrites !== undefined) {
    const marker = plan.marker === undefined ? 0 : ENTRY_WRITES;
    const total = plan.objects.length * OBJECT_WRITES + plan.deletedIds.length + marker;
    if (total <= maxWrites) return undefined;
    const writes: RestoreWrite[] = [
      ...plan.objects.map((object) => ({ kind: 'object' as const, object })),
      ...plan.deletedIds.map((id) => ({ kind: 'delete' as const, id })),
    ];
    const packed = packByWrites(
      writes,
      (write) => (write.kind === 'object' ? OBJECT_WRITES : DELETE_WRITES),
      maxWrites,
      { each: marker },
    );
    return numbered(
      plan,
      packed.map((part) => ({
        objects: part.flatMap((write) => (write.kind === 'object' ? [write.object] : [])),
        deletedIds: part.flatMap((write) => (write.kind === 'delete' ? [write.id] : [])),
      })),
    );
  }
  if (plan.objects.length + plan.deletedIds.length <= MAX_OBJECTS_PER_TRANSACTION) return undefined;
  const parts: RestoreBoardPlan[] = [];
  for (let start = 0; start < plan.objects.length; start += MAX_OBJECTS_PER_TRANSACTION)
    parts.push({
      objects: plan.objects.slice(start, start + MAX_OBJECTS_PER_TRANSACTION),
      deletedIds: [],
    });
  for (let start = 0; start < plan.deletedIds.length; start += MAX_OBJECTS_PER_TRANSACTION)
    parts.push({
      objects: [],
      deletedIds: plan.deletedIds.slice(start, start + MAX_OBJECTS_PER_TRANSACTION),
    });
  return numbered(plan, parts);
}

/**
 * Gives every part the plan's restore marker, numbered over the final count of parts.
 *
 * @param plan - The whole plan, with its marker if any.
 * @param parts - The parts, without markers.
 * @returns The split.
 */
function numbered(
  plan: RestoreBoardPlan,
  parts: readonly RestoreBoardPlan[],
): { parts: RestoreBoardPlan[]; result: undefined } {
  return {
    parts: parts.map((part, index) => ({
      ...part,
      ...(plan.marker === undefined
        ? {}
        : { marker: { ...plan.marker, part: index, parts: parts.length } }),
    })),
    result: undefined,
  };
}
