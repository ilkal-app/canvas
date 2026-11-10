import { expect, it } from 'vitest';

import { copySelection } from '@canvas/document';
import { exportBoard, SCHEMA_VERSION, type ObjectId } from '@canvas/schema';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import * as decoding from './clipboard-flavours.js';

const { decodeObjectsFlavour } = decoding;
const { decodeObjectsFlavourInStages } = decoding as unknown as {
  decodeObjectsFlavourInStages: (
    json: string,
    stage: () => Promise<void>,
  ) => Promise<ReturnType<typeof decodeObjectsFlavour>>;
};

const copied = () => {
  const board = copySelection(clipboardBoard(), ['title', 'photo'] as ObjectId[]);
  if (board === undefined) throw new Error('fixture copy failed');
  return JSON.stringify(exportBoard(board));
};

it('staged decode yields and keeps the same board, including external main handling', async () => {
  let yields = 0;
  const json = copied();
  const staged = await decodeObjectsFlavourInStages(json, () => {
    yields += 1;
    return Promise.resolve();
  });
  expect(staged).toEqual(decodeObjectsFlavour(json));
  expect(yields).toBeGreaterThan(0);
});

it('reports a newer objects flavour rather than letting HTML or plain text replace it', async () => {
  const newer = JSON.stringify({ ...JSON.parse(copied()), schemaVersion: SCHEMA_VERSION + 1 });
  expect(decodeObjectsFlavour(newer)).toEqual({ kind: 'newer' });
  expect(await decodeObjectsFlavourInStages(newer, () => Promise.resolve())).toEqual({
    kind: 'newer',
  });
});
