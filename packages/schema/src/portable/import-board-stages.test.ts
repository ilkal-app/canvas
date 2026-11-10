import { expect, it } from 'vitest';

import { createFixtureBoard } from './__fixtures__/fixture-board.js';
import { BoardImportError } from './board-import-error.js';
import { exportBoard } from './export-board.js';
import { importBoard, importBoardInStages } from './import-board.js';

const stage = () => Promise.resolve();

async function codesOf(json: unknown): Promise<string[]> {
  try {
    await importBoardInStages(json, { stage, objectsPerStage: 1 });
  } catch (error) {
    if (error instanceof BoardImportError) return error.issues.map(({ code }) => code);
    throw error;
  }
  return [];
}

it('refuses a number that is not finite before parsing anything', async () => {
  const source = exportBoard(createFixtureBoard());
  const json = { ...source, objects: [{ ...source.objects[0], x: Number.POSITIVE_INFINITY }] };
  expect(await codesOf(json)).toEqual(['out-of-bound']);
});

it('reports objects that are not a list as importBoard does', async () => {
  const source = exportBoard(createFixtureBoard());
  const json = { ...source, objects: 'none' };
  const expected = (() => {
    try {
      importBoard(json);
    } catch (error) {
      return error instanceof BoardImportError ? error.issues.map(({ code }) => code) : [];
    }
    return [];
  })();
  expect(await codesOf(json)).toEqual(expected);
  expect(expected.length).toBeGreaterThan(0);
});

it('parses one object per stage when asked', async () => {
  const source = exportBoard(createFixtureBoard());
  let stages = 0;
  const board = await importBoardInStages(source, {
    stage: () => {
      stages += 1;
      return Promise.resolve();
    },
    objectsPerStage: 1,
  });
  expect(board).toEqual(importBoard(source));
  expect(stages).toBe(source.objects.length + 1);
});
