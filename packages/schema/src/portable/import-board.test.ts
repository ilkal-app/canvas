import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import { splitEmojiContent, wholeEmojiContent } from '../fields/__fixtures__/split-emoji.js';
import { BOARD_BOUND } from '../fields/board-bound.js';
import type { ObjectId } from '../ids/object-id.js';
import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';
import { INVALID_Z_KEYS } from '../z-order/__fixtures__/invalid-z-keys.js';

import { createFixtureBoard } from './__fixtures__/fixture-board.js';
import { BoardImportError } from './board-import-error.js';
import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import type { PortableBoardJson } from './portable-board.js';

/**
 * Imports `json` and returns the issues it was rejected with.
 *
 * @param json - The document to import.
 * @returns The issues, as `[code, objectId, path]` triples.
 * @throws {Error} When the import succeeds, or fails with an error other than a
 *   `BoardImportError`.
 */
function importIssues(json: unknown): [string, string | null, string][] {
  try {
    importBoard(json);
  } catch (error) {
    if (error instanceof BoardImportError) {
      return error.issues.map((issue) => [issue.code, issue.objectId, issue.path.join('.')]);
    }
    throw error;
  }
  throw new Error('the import was expected to fail');
}

/**
 * The fixture board's portable JSON as parsed from text, so no object is shared with the board.
 *
 * @returns A fresh portable document.
 */
function fixtureJson(): PortableBoardJson {
  return JSON.parse(JSON.stringify(exportBoard(createFixtureBoard()))) as PortableBoardJson;
}

describe('importBoard', () => {
  it('round-trips the fixture board: import(export(board)) deep-equals the board', () => {
    const board = createFixtureBoard();
    expect(importBoard(exportBoard(board))).toEqual(board);
  });

  it('round-trips through JSON text', () => {
    expect(importBoard(fixtureJson())).toEqual(createFixtureBoard());
    expect(exportBoard(importBoard(fixtureJson()))).toEqual(fixtureJson());
  });

  it('never mutates the JSON it is given', () => {
    const json = deepFreeze(fixtureJson());
    importBoard(json);
    expect(json).toEqual(fixtureJson());
  });

  it('rejects a value that is not a portable board document', () => {
    expect(importIssues('board')).toEqual([['invalid-format', null, '']]);
    expect(importIssues({ ...fixtureJson(), format: 'other.app' })).toEqual([
      ['invalid-format', null, 'format'],
    ]);
    expect(importIssues({ ...fixtureJson(), schemaVersion: '1' })).toEqual([
      ['invalid-format', null, 'schemaVersion'],
    ]);
    expect(importIssues({ ...fixtureJson(), objects: {} })).toEqual([
      ['invalid-format', null, 'objects'],
    ]);
  });

  it('rejects a document from a newer build', () => {
    expect(importIssues({ ...fixtureJson(), schemaVersion: SCHEMA_VERSION + 1 })).toEqual([
      ['unsupported-schema-version', null, 'schemaVersion'],
    ]);
  });

  it('reports malformed objects by id and field path', () => {
    const json = fixtureJson();
    const objects = json.objects.map((object) =>
      object.type === 'sticky'
        ? { ...object, text: 'Changed' }
        : object.type === 'image'
          ? { ...object, opacity: 2 }
          : object,
    );
    expect(importIssues({ ...json, objects })).toEqual([
      ['invalid-object', 'image-photo', 'opacity'],
      ['invalid-object', 'sticky-idea', 'runs'],
    ]);
  });

  it('rejects an object placed past the board bound, by id and field path', () => {
    const json = fixtureJson();
    const objects = json.objects.map((object) =>
      object.type === 'image'
        ? { ...object, x: 1e308 }
        : object.type === 'sticky'
          ? { ...object, width: 2 ** 31 }
          : object,
    );
    const issues = importIssues({ ...json, objects });
    expect(issues).toContainEqual(['out-of-bound', 'image-photo', 'x']);
    expect(issues).toContainEqual(['out-of-bound', 'sticky-idea', 'x']);
  });

  it('imports members whose coordinate relative to their parent exceeds the bound while their place does not', () => {
    const group = sampleObject('group', 'g', { x: -BOARD_BOUND, y: 0 });
    const right = sampleObject('frame', 'right', {
      parentId: 'g' as ObjectId,
      x: 2 * BOARD_BOUND,
      y: 0,
      width: 0,
      height: 0,
    });
    const board = importBoard(exportBoard(createBoard([group, right])));
    expect(board.objects.get('right' as ObjectId)).toMatchObject({ x: 2 * BOARD_BOUND });
  });

  it('refuses the same member when its parent puts it past the bound, and a hostile 1e300 always', () => {
    const group = sampleObject('group', 'g', { x: -BOARD_BOUND + 10, y: 0 });
    const right = sampleObject('frame', 'right', {
      parentId: 'g' as ObjectId,
      x: 2 * BOARD_BOUND,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(importIssues(exportBoard(createBoard([group, right])))).toContainEqual([
      'out-of-bound',
      'right',
      'x',
    ]);
    const hostile = sampleObject('frame', 'far', { x: 1e300, width: 1, height: 1 });
    expect(importIssues(exportBoard(createBoard([hostile])))).toContainEqual([
      'out-of-bound',
      'far',
      'x',
    ]);
  });

  it('rejects runs whose boundary splits an emoji, in a sticky and in a label, under their own code', () => {
    const json = fixtureJson();
    const objects = json.objects.map((object) =>
      object.type === 'sticky'
        ? { ...object, ...splitEmojiContent() }
        : object.id === 'shape-box'
          ? { ...object, label: splitEmojiContent() }
          : object,
    );
    expect(importIssues({ ...json, objects })).toEqual([
      ['run-splits-character', 'shape-box', 'label.runs.1'],
      ['run-splits-character', 'sticky-idea', 'runs.1'],
    ]);
  });

  it('imports runs that restyle an emoji whole', () => {
    const json = fixtureJson();
    const objects = json.objects.map((object) =>
      object.type === 'sticky' ? { ...object, ...wholeEmojiContent() } : object,
    );
    const board = importBoard({ ...json, objects });
    expect(board.objects.get('sticky-idea' as ObjectId)).toMatchObject(wholeEmojiContent());
  });

  it('reports an object with no usable id by its index', () => {
    const json = fixtureJson();
    expect(importIssues({ ...json, objects: [...json.objects, { type: 'group' }] })[0]).toEqual([
      'invalid-object',
      null,
      `objects.${String(json.objects.length)}.id`,
    ]);
  });

  it('reports duplicate ids', () => {
    const json = fixtureJson();
    const [first] = json.objects;
    expect(importIssues({ ...json, objects: [...json.objects, first] })).toEqual([
      ['duplicate-id', first?.id, 'id'],
    ]);
  });

  it('rejects z keys that break the fractional-index key rule, one invalid-z-key issue each', () => {
    const json = fixtureJson();
    const invalid = new Map(
      INVALID_Z_KEYS.map(([, key], index) => [json.objects[index]?.id ?? '', key]),
    );
    const objects = json.objects.map((object) => {
      const key = invalid.get(object.id);
      return key === undefined ? object : { ...object, z: key };
    });
    expect(importIssues({ ...json, objects })).toEqual(
      json.objects
        .filter((object) => invalid.has(object.id))
        .map((object) => ['invalid-z-key', object.id, 'z']),
    );
  });

  it('reports references that do not resolve, such as a dangling parent or connector target', () => {
    const json = fixtureJson();
    const objects = json.objects.filter((object) => object.id !== 'group-diagram');
    expect(importIssues({ ...json, objects })).toEqual([
      ['missing-parent', 'shape-box', 'parentId'],
      ['missing-parent', 'shape-star', 'parentId'],
    ]);
    const withoutBox = json.objects.filter((object) => object.id !== 'shape-box');
    expect(importIssues({ ...json, objects: withoutBox })).toEqual([
      ['missing-connector-target', 'connector-flow', 'to.objectId'],
    ]);
  });
});
