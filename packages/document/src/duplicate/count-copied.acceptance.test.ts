import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { clipboardBoard } from './__fixtures__/clipboard-board.js';
import * as copying from './copy-selection.js';

const { copySelection } = copying;
const { countCopied } = copying as unknown as {
  countCopied: (board: ReturnType<typeof clipboardBoard>, ids: readonly ObjectId[]) => number;
};

it('counts exactly what copySelection would materialize, including descendants once', () => {
  const board = clipboardBoard();
  for (const ids of [
    ['group'],
    ['group', 'left', 'group'],
    ['pin', 'title'],
    ['outside', 'link', 'group'],
    ['missing'],
  ]) {
    const selected = ids as ObjectId[];
    expect(countCopied(board, selected)).toBe(copySelection(board, selected)?.objects.size ?? 0);
  }
});
