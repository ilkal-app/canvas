import { expect, it } from 'vitest';

import { createFixtureBoard } from './__fixtures__/fixture-board.js';
import { BoardImportError } from './board-import-error.js';
import { exportBoard } from './export-board.js';
import * as imports from './import-board.js';

const { importBoard } = imports;
const { importBoardInStages } = imports as unknown as {
  importBoardInStages: (
    json: unknown,
    options: { stage: () => Promise<void> },
  ) => Promise<ReturnType<typeof importBoard>>;
};

const fixture = () => exportBoard(createFixtureBoard());

async function issuesOf(json: unknown): Promise<unknown> {
  try {
    await importBoardInStages(json, { stage: () => Promise.resolve() });
  } catch (error) {
    if (error instanceof BoardImportError) return error.issues;
    throw error;
  }
  throw new Error('expected import refusal');
}

function synchronousIssues(json: unknown): unknown {
  try {
    importBoard(json);
  } catch (error) {
    if (error instanceof BoardImportError) return error.issues;
    throw error;
  }
  throw new Error('expected import refusal');
}

it('imports the same board while yielding between object chunks', async () => {
  const source = fixture();
  const many = {
    ...source,
    objects: Array.from({ length: 1_001 }, (unused, index) => ({
      ...source.objects[0],
      id: `staged-${String(index)}`,
      x: index * 2,
    })),
  };
  let yields = 0;
  const staged = await importBoardInStages(many, {
    stage: () => {
      yields += 1;
      return Promise.resolve();
    },
  });
  expect(staged).toEqual(importBoard(many));
  expect(yields).toBeGreaterThanOrEqual(2);
});

it('keeps the synchronous importer’s first-stage errors and object paths', async () => {
  const source = fixture();
  const badObject = {
    ...source,
    objects: source.objects.map((object, index) =>
      index === 0 ? { ...object, opacity: 2 } : object,
    ),
  };
  for (const json of [
    'not a board',
    { ...source, schemaVersion: 999 },
    { ...source, pages: 'bad', objects: [{ id: 'bad', type: 'shape' }] },
    badObject,
    { ...source, objects: [...source.objects, source.objects[0]] },
    { ...source, objects: source.objects.map((object) => ({ ...object, x: 1e308 })) },
  ]) {
    expect(await issuesOf(json)).toEqual(synchronousIssues(json));
  }
});
