import type { z } from 'zod';

import { createBoard, type Board } from '../board/board.js';
import { isBuiltinToken, type TokenEntry } from '../fields/color-tokens.js';
import { styleNameKey } from '../fields/named-styles.js';
import type { VersionedDocumentJson } from '../migrations/migration-step.js';
import { migrateToLatest } from '../migrations/run-migrations.js';
import { boardObjectSchema, type BoardObject } from '../objects/board-object.js';
import { BOARD_ISSUE_CODES, type BoardIssue, type BoardIssueCode } from '../rules/board-issue.js';
import { validateBoard } from '../rules/validate-board.js';

import { BoardImportError } from './board-import-error.js';
import { boundIssuesOf, nonFiniteIssues } from './import-bound-issues.js';
import {
  PORTABLE_BOARD_FORMAT,
  portableBoardSchema,
  type PortableBoardJson,
} from './portable-board.js';

/**
 * Checks the format tag, then migrates the document to the current schema version.
 *
 * @param json - The parsed document.
 * @returns The migrated document.
 * @throws {BoardImportError} When the value is not a portable board document, or its version is
 *   unknown to this build.
 */
function checkFormatAndMigrate(json: unknown): VersionedDocumentJson {
  const base = { objectId: null, relatedId: null } as const;
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    const message = 'a portable board document is a JSON object';
    throw new BoardImportError([{ ...base, code: 'invalid-format', path: [], message }]);
  }
  if (!('format' in json) || json.format !== PORTABLE_BOARD_FORMAT) {
    const message = `the format tag is not "${PORTABLE_BOARD_FORMAT}"`;
    throw new BoardImportError([{ ...base, code: 'invalid-format', path: ['format'], message }]);
  }
  try {
    return migrateToLatest(json);
  } catch (error) {
    const code = error instanceof RangeError ? 'unsupported-schema-version' : 'invalid-format';
    const message = error instanceof Error ? error.message : String(error);
    throw new BoardImportError([{ ...base, code, path: ['schemaVersion'], message }]);
  }
}

/**
 * Reads the board issue code a schema refinement attached to an object-level Zod issue (such as
 * `run-splits-character` from the run invariant), else `invalid-object`.
 *
 * @param issue - The Zod issue.
 * @returns The code to report the issue under.
 */
function objectIssueCode(issue: z.core.$ZodIssue): BoardIssueCode {
  const code: unknown = issue.code === 'custom' ? issue.params?.boardIssueCode : undefined;
  return BOARD_ISSUE_CODES.find((known) => known === code) ?? 'invalid-object';
}

/**
 * Turns a Zod issue into a board issue: an object issue (`invalid-object`, or the code a
 * refinement attached) located by object id and field path when it is inside an object that has
 * a string id, else located by its full path.
 *
 * @param issue - The Zod issue.
 * @param document - The document that was parsed, to read object ids from.
 * @returns The board issue.
 */
function toBoardIssue(issue: z.core.$ZodIssue, document: VersionedDocumentJson): BoardIssue {
  const path = issue.path.map((key) => (typeof key === 'number' ? key : String(key)));
  const [field, index, ...rest] = path;
  if (field !== 'objects' || typeof index !== 'number') {
    return {
      code: 'invalid-format',
      objectId: null,
      relatedId: null,
      path,
      message: issue.message,
    };
  }
  const objects = document.objects as readonly unknown[];
  const object: unknown = objects[index];
  const objectId =
    typeof object === 'object' && object !== null && 'id' in object && typeof object.id === 'string'
      ? object.id
      : null;
  return {
    code: objectIssueCode(issue),
    objectId,
    relatedId: null,
    path: objectId === null ? path : rest,
    message: issue.message,
  };
}

/**
 * Lists every id used by more than one object, once each, in document order.
 *
 * @param document - A validated portable document.
 * @returns A `duplicate-id` issue per repeated id.
 */
function duplicateIdIssues(document: PortableBoardJson): BoardIssue[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const issues: BoardIssue[] = [];
  for (const { id } of document.objects) {
    if (seen.has(id) && !reported.has(id)) {
      reported.add(id);
      const message = `more than one object has the id "${id}"`;
      issues.push({ code: 'duplicate-id', objectId: id, relatedId: null, path: ['id'], message });
    }
    seen.add(id);
  }
  return issues;
}

/**
 * Lists every page id used by more than one page, once each, in document order.
 *
 * @param document - A validated portable document.
 * @returns A `duplicate-id` issue per repeated page id.
 */
function duplicatePageIssues(document: PortableBoardJson): BoardIssue[] {
  const seen = new Set<string>();
  const issues: BoardIssue[] = [];
  for (const [index, { id }] of (document.pages ?? []).entries()) {
    if (seen.has(id)) {
      const message = `more than one page has the id "${id}"`;
      issues.push({
        code: 'duplicate-id',
        objectId: null,
        relatedId: id,
        path: ['pages', index, 'id'],
        message,
      });
    }
    seen.add(id);
  }
  return issues;
}

/**
 * Lists every token id used by more than one token, once each, in document order.
 *
 * @param document - A validated portable document.
 * @returns A `duplicate-id` issue per repeated token id.
 */
function duplicateTokenIssues(document: PortableBoardJson): BoardIssue[] {
  const seen = new Set<string>();
  const issues: BoardIssue[] = [];
  for (const [index, { id }] of (document.tokens ?? []).entries()) {
    if (seen.has(id)) {
      const message = `more than one colour token has the id "${id}"`;
      const path = ['tokens', index, 'id'];
      issues.push({ code: 'duplicate-id', objectId: null, relatedId: id, path, message });
    }
    seen.add(id);
  }
  return issues;
}

/**
 * Lists every repeated style id, and every style name repeated case-blind, of one kind.
 *
 * @param entries - The kind's entries, or undefined.
 * @param field - The document field holding them.
 * @returns A `duplicate-id` or `duplicate-style-name` issue per repeat.
 */
function duplicateStyleIssues(
  entries: readonly { readonly id: string; readonly name: string }[] | undefined,
  field: 'textStyles' | 'effectStyles',
): BoardIssue[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  const issues: BoardIssue[] = [];
  for (const [index, { id, name }] of (entries ?? []).entries()) {
    if (ids.has(id)) {
      const message = `more than one ${field} entry has the id "${id}"`;
      const path = [field, index, 'id'];
      issues.push({ code: 'duplicate-id', objectId: null, relatedId: id, path, message });
    } else if (names.has(styleNameKey(name))) {
      const message = `more than one ${field} entry is named "${name}"`;
      const path = [field, index, 'name'];
      issues.push({ code: 'duplicate-style-name', objectId: null, relatedId: id, path, message });
    }
    ids.add(id);
    names.add(styleNameKey(name));
  }
  return issues;
}

/**
 * The token table of a portable document: each token as an entry, a built-in's told by its id,
 * its creator from its identity (none when the document carries no identity).
 *
 * @param document - A validated portable document.
 * @returns The entries, or undefined when it carries none.
 */
function tokenEntriesOf(document: PortableBoardJson): TokenEntry[] | undefined {
  return document.tokens?.map(({ id, name, identity, light, dark }) => ({
    id,
    name,
    light,
    dark,
    builtin: isBuiltinToken(id),
    createdBy: identity?.createdBy ?? null,
    createdAt: identity?.createdAt ?? 0,
  }));
}

/**
 * Imports a portable board document: checks the format tag, migrates
 * an older schema version to the current one, refuses a number that is not finite (`out-of-bound`,
 * so a paste can say why it took nothing), validates every object against its schema, and
 * checks the references between objects (`validateBoard`), and the board's bound
 * (`out-of-bound`): every object's box on the board, resolved through its parents, within
 * ±`BOARD_BOUND` (a member's coordinate relative to its parent may exceed it), and every value that
 * is not a position within its limit (`findValueLimitIssues`), as `createObject` holds them. The
 * result is a board with fresh objects that share nothing with the input.
 *
 * @param json - The parsed JSON of a portable board document; it is not modified.
 * @returns The board.
 * @throws {BoardImportError} When the document cannot become a valid board; its `issues` list
 *   every problem found at the first stage that failed (format, numbers, objects, ids,
 *   references, bound).
 */
export function importBoard(json: unknown): Board {
  const migrated = checkFormatAndMigrate(json);
  const nonFinite = nonFiniteIssues(migrated);
  if (nonFinite.length > 0) throw new BoardImportError(nonFinite);
  const parsed = portableBoardSchema.safeParse(migrated);
  if (!parsed.success) {
    throw new BoardImportError(parsed.error.issues.map((issue) => toBoardIssue(issue, migrated)));
  }
  return checkedBoardOf(parsed.data);
}

/**
 * Builds the board of a parsed document and checks it: its ids, its references and its bound.
 *
 * @param document - A document that passed `portableBoardSchema`.
 * @returns The board.
 * @throws {BoardImportError} At the first check that fails.
 */
function checkedBoardOf(document: PortableBoardJson): Board {
  const duplicates = [
    ...duplicateIdIssues(document),
    ...duplicatePageIssues(document),
    ...duplicateTokenIssues(document),
    ...duplicateStyleIssues(document.textStyles, 'textStyles'),
    ...duplicateStyleIssues(document.effectStyles, 'effectStyles'),
  ];
  if (duplicates.length > 0) throw new BoardImportError(duplicates);
  const { textStyles, effectStyles } = document;
  const board = createBoard(document.objects, document.pages, tokenEntriesOf(document), {
    ...(textStyles === undefined ? {} : { textStyles }),
    ...(effectStyles === undefined ? {} : { effectStyles }),
  });
  // A notice (more pages than the creation limit, an unknown colour token) is kept, as the live
  // board keeps it.
  const referenceIssues = validateBoard(board).filter(({ severity }) => severity !== 'notice');
  if (referenceIssues.length > 0) throw new BoardImportError(referenceIssues);
  const boundIssues = boundIssuesOf(board);
  if (boundIssues.length > 0) throw new BoardImportError(boundIssues);
  return board;
}

/** How {@link importBoardInStages} pauses between its stages. */
export interface ImportStagesOptions {
  /** Called between two stages; the import goes on once it resolves. */
  readonly stage: () => Promise<void>;
  /** How many objects one stage parses; 500 when absent. */
  readonly objectsPerStage?: number;
}

/**
 * Imports a portable board document as {@link importBoard} does, in stages: the objects
 * are parsed some at a time and the board's checks run after, with `stage` awaited between, so a
 * page can keep drawing while a large paste is read. The result, and every refusal, equal
 * `importBoard`'s: a document that fails a stage is imported again by `importBoard` to report it.
 *
 * @param json - The parsed JSON of a portable board document; it is not modified.
 * @param options - How to pause between stages.
 * @returns The board.
 * @throws {BoardImportError} As `importBoard` throws.
 */
export async function importBoardInStages(
  json: unknown,
  options: ImportStagesOptions,
): Promise<Board> {
  const perStage = options.objectsPerStage ?? 500;
  const migrated = checkFormatAndMigrate(json);
  const nonFinite = nonFiniteIssues(migrated);
  if (nonFinite.length > 0) throw new BoardImportError(nonFinite);
  const source: unknown = migrated.objects;
  if (!Array.isArray(source)) return importBoard(json);
  // The fields other than the objects, parsed in one stage; the objects follow a stage at a time.
  const frame = portableBoardSchema.safeParse({ ...migrated, objects: [] });
  if (!frame.success) return importBoard(json);
  const objects: BoardObject[] = [];
  for (let start = 0; start < source.length; start += perStage) {
    await options.stage();
    for (const candidate of source.slice(start, start + perStage)) {
      const parsed = boardObjectSchema.safeParse(candidate);
      if (!parsed.success) return importBoard(json);
      objects.push(parsed.data);
    }
  }
  await options.stage();
  return checkedBoardOf({ ...frame.data, objects });
}
