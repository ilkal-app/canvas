import { describe, expect, it } from 'vitest';

import { exportBoard } from './export-board.js';
import { importBoard } from './import-board.js';
import { PORTABLE_BOARD_FORMAT } from './portable-board.js';

const document = (tokens: unknown) => ({
  format: PORTABLE_BOARD_FORMAT,
  schemaVersion: 11,
  objects: [],
  tokens,
});

const identity = { builtin: false, createdBy: 'user:ada', createdAt: 5 };

describe('portable colour tokens', () => {
  it('round trips each token with its identity', () => {
    const token = { id: 'brand', name: 'Brand', identity, light: [1, 0, 0, 1], dark: [0, 0, 1, 1] };
    const board = importBoard(document([token]));
    expect(board.tokens?.get('brand')).toMatchObject({ createdBy: 'user:ada', createdAt: 5 });
    expect(exportBoard(board).tokens).toEqual([token]);
  });

  it('takes a token without an identity as having no known creator', () => {
    const board = importBoard(
      document([{ id: 'accent', name: 'accent', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] }]),
    );
    expect(exportBoard(board).tokens).toEqual([
      {
        id: 'accent',
        name: 'accent',
        identity: { builtin: true, createdBy: null, createdAt: 0 },
        light: [1, 0, 0, 1],
        dark: [0, 0, 1, 1],
      },
    ]);
  });

  it('tells a built-in by its id, whatever the identity claims', () => {
    const board = importBoard(
      document([
        { id: 'ink', name: 'ink', identity, light: [1, 0, 0, 1], dark: [0, 0, 1, 1] },
        {
          id: 'own',
          name: 'Own',
          identity: { ...identity, builtin: true },
          light: [1, 0, 0, 1],
          dark: [0, 0, 1, 1],
        },
      ]),
    );
    expect(board.tokens?.get('ink')?.builtin).toBe(true);
    expect(board.tokens?.get('own')?.builtin).toBe(false);
  });
});
