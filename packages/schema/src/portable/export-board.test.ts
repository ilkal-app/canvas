import { describe, expect, it } from 'vitest';

import { OBJECT_TYPES } from '../objects/object-type.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';
import { SCHEMA_VERSION } from '../version/schema-version.js';

import { createFixtureBoard } from './__fixtures__/fixture-board.js';
import { exportBoard } from './export-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

describe('the fixture board', () => {
  it('holds at least one object of every type', () => {
    const types = new Set([...createFixtureBoard().objects.values()].map((object) => object.type));
    expect([...types].sort()).toEqual([...OBJECT_TYPES].sort());
  });
});

describe('exportBoard', () => {
  it('writes the format, the current schema version and every object sorted by id', () => {
    const board = createFixtureBoard();
    const json = exportBoard(board);
    expect(json.format).toBe(PORTABLE_BOARD_FORMAT);
    expect(json.schemaVersion).toBe(SCHEMA_VERSION);
    const ids = json.objects.map((object) => object.id);
    expect(ids).toEqual([...board.objects.keys()].sort());
  });

  it('never mutates the board', () => {
    const board = deepFreeze(createFixtureBoard());
    const before = new Map(board.objects);
    exportBoard(board);
    expect(board.objects).toEqual(before);
  });

  it('writes the same JSON text for the same board built in a different order', () => {
    const board = createFixtureBoard();
    const reversed = { objects: new Map([...board.objects].reverse()) };
    expect(JSON.stringify(exportBoard(reversed))).toBe(JSON.stringify(exportBoard(board)));
  });
});
