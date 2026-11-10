import {
  boardObjectSchema,
  findRunsSplittingCharacters,
  type BoardObject,
  type TextContent,
} from '@canvas/schema';

import { describeId } from '../codec/describe-value.js';

import { DocumentWriteError, type ValidationIssue } from './document-write-error.js';
import { findDoorIssues } from './door-values.js';
import { checkWrittenFields } from './written-fields.js';

/** The outcome of validating an object the way a transaction write does. */
export type ObjectValidation =
  | {
      /** The object may be written. */
      readonly isValid: true;
      /** The parsed object, a fresh copy that shares nothing with the input. */
      readonly object: BoardObject;
    }
  | {
      /** The object would be refused. */
      readonly isValid: false;
      /** The object's id, or `'?'` when the input has none. */
      readonly objectId: string;
      /** Every problem found; never empty. */
      readonly issues: readonly ValidationIssue[];
    };

/**
 * Lists the runs of an object's texts (a text or sticky body, a shape or connector label) that
 * start inside a surrogate pair, which Yjs cannot store faithfully. The schema's run invariant
 * already rejects them (`findRunIssues`), so for a parsed object this finds nothing; it is kept
 * as defence in depth, because such a run written to a `Y.Text` would diverge the peers for good.
 *
 * @param object - An object whose texts are valid (every text a write changes is).
 * @param isWritten - Whether a field is one the write changes; only those texts are read, since
 *   a text the write leaves as stored may be one a peer left malformed.
 * @returns One issue per offending run, located by field path.
 */
export function findSplitCharacterIssues(
  object: BoardObject,
  isWritten: (field: string) => boolean = () => true,
): ValidationIssue[] {
  const texts: [readonly PropertyKey[], TextContent][] = [];
  if ((object.type === 'text' || object.type === 'sticky') && isWritten('runs')) {
    texts.push([['runs'], object]);
  }
  if (
    (object.type === 'shape' || object.type === 'connector') &&
    object.label !== null &&
    isWritten('label')
  ) {
    texts.push([['label', 'runs'], object.label]);
  }
  return texts.flatMap(([path, content]) =>
    findRunsSplittingCharacters(content.text, content.runs).map((index) => ({
      path: [...path, index],
      message: `run ${String(index)} starts inside a surrogate pair; runs must split text between characters`,
    })),
  );
}

/**
 * Describes an input's id for an error.
 *
 * @param object - The candidate.
 * @returns Its id, or `'?'` when it has none.
 */
function objectIdOf(object: unknown): string {
  return typeof object === 'object' && object !== null && 'id' in object
    ? describeId(object.id)
    : '?';
}

/** What the schema part of a validation leaves: the object to write and what it changes. */
type SchemaCheck =
  | {
      /** The schema refused it. */
      readonly isValid: false;
      /** The refusal. */
      readonly validation: ObjectValidation;
    }
  | {
      /** The schema took it. */
      readonly isValid: true;
      /** The object to write. */
      readonly object: BoardObject;
      /** Whether the write changes a field (every field, for a new object). */
      readonly isWritten: (field: string) => boolean;
    };

/**
 * Validates a new object whole against its type's schema.
 *
 * @param object - The candidate.
 * @returns The parsed object, or the refusal.
 */
function checkWhole(object: unknown): SchemaCheck {
  const parsed = boardObjectSchema.safeParse(object);
  if (parsed.success) return { isValid: true, object: parsed.data, isWritten: () => true };
  const validation: ObjectValidation = {
    isValid: false,
    objectId: objectIdOf(object),
    issues: parsed.error.issues,
  };
  return { isValid: false, validation };
}

/**
 * Validates a write to an existing object field by field (`checkWrittenFields`).
 *
 * @param object - The candidate.
 * @param stored - The object as stored.
 * @returns The object to write, or the refusal.
 */
function checkWritten(object: unknown, stored: StoredFields): SchemaCheck {
  const checked = checkWrittenFields(object, stored);
  if (checked === undefined) return checkWhole(object);
  if (checked.issues.length > 0) {
    const validation: ObjectValidation = {
      isValid: false,
      objectId: objectIdOf(object),
      issues: checked.issues,
    };
    return { isValid: false, validation };
  }
  const { written } = checked;
  return {
    isValid: true,
    object: checked.object as unknown as BoardObject,
    isWritten: (field) => written.has(field),
  };
}

/** What is known of an object as stored: the decoded object, or some of its fields. */
export type StoredFields = Readonly<Record<string, unknown>>;

/**
 * Validates an object as every transaction write does, the one rule of the store's write path
 * and the command layer's `validate` (item 1). A new object (`stored` absent) is
 * validated whole: its type's schema (whose run invariant includes the character boundaries Yjs
 * needs), then those boundaries again as defence in depth ({@link findSplitCharacterIssues}). A
 * write to an existing object is validated field by field (`checkWrittenFields`): each field it
 * changes, and each cross-field rule such a field takes part in (a text's runs with its
 * characters, a path's changed members with their ends); a field it leaves as stored is not
 * judged, so one a peer left invalid (remote updates are not validated) blocks no honest write,
 * and a write never makes an invalid field valid by accident or fails on it. Last, nothing the
 * write stores may be refused by the relay's door (`findDoorIssues`, part 1): a new value
 * out of the range a renderer draws within is refused here, naming the field; a write that
 * changes the object's type stores every value anew, so every one is judged.
 *
 * The command layer calls it before a transaction starts, so a write it accepts cannot fail
 * halfway through a command.
 *
 * @param object - The candidate object.
 * @param stored - The object as stored now (for an entry that cannot be read, what is known of
 *   it, such as its `z`), or `undefined` for a new object.
 * @returns The object to write (a fresh copy of every changed field, each other field as
 *   stored), or the problems that would make a write throw.
 */
export function validateObject(object: unknown, stored?: StoredFields): ObjectValidation {
  const checked = stored === undefined ? checkWhole(object) : checkWritten(object, stored);
  if (!checked.isValid) return checked.validation;
  // A write that changes the type (a detach makes an instance a frame) is stored as a new map,
  // every key at once, so the door judges every value it stores, none as already held.
  const held = stored?.type === checked.object.type ? stored : undefined;
  const issues = [
    ...findSplitCharacterIssues(checked.object, checked.isWritten),
    ...findDoorIssues(checked.object, held),
  ];
  return issues.length === 0
    ? { isValid: true, object: checked.object }
    : { isValid: false, objectId: checked.object.id, issues };
}

/**
 * Validates an object with {@link validateObject}, throwing when it is invalid.
 *
 * @param object - The candidate object.
 * @param stored - The object as stored now, or `undefined` for a new object.
 * @returns The object to write: every changed field a fresh copy, each other field as stored.
 * @throws {DocumentWriteError} When the object is invalid.
 */
export function parseObject(object: unknown, stored?: StoredFields): BoardObject {
  const validation = validateObject(object, stored);
  if (!validation.isValid) throw new DocumentWriteError(validation.objectId, validation.issues);
  return validation.object;
}
