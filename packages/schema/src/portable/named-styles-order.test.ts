import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION } from '../version/schema-version.js';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

// A board's named styles export sorted by id, so one board always serialises alike.

const VALUE = { fontFamily: 'Inter', fontSize: 16, weight: 400, italic: false };
const SHADOW = { x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] };

/**
 * A style entry.
 *
 * @param id - Its id.
 * @param value - Its value.
 * @returns The entry.
 */
function entry(id: string, value: unknown): Record<string, unknown> {
  return { id, name: `Style ${id}`, value, createdBy: null, createdAt: 0 };
}

describe('exported named styles', () => {
  it('sorts each kind by id', () => {
    const board = importBoard({
      format: PORTABLE_BOARD_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      objects: [],
      textStyles: [entry('zed', VALUE), entry('alpha', VALUE), entry('mid', VALUE)],
      effectStyles: [entry('b', { shadows: [SHADOW] }), entry('a', { shadows: [SHADOW] })],
    });
    const json = exportBoard(board);
    expect(json.textStyles?.map(({ id }) => id)).toEqual(['alpha', 'mid', 'zed']);
    expect(json.effectStyles?.map(({ id }) => id)).toEqual(['a', 'b']);
  });
});
