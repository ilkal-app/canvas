// Independent acceptance for stored token refs and portable JSON.
import { describe, expect, it } from 'vitest';

import {
  exportBoard,
  importBoard,
  isSameColor,
  PORTABLE_BOARD_FORMAT,
  type BoardObject,
} from '@canvas/schema';

import { ADA, fixtureObject, RELAY } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

const ref = { token: 'accent' };

describe('token codec', () => {
  it('round trips token refs in style groups and text run attributes', () => {
    const source = new YjsDocumentStore();
    const shape = fixtureObject('shape-box', 'shape');
    const text = fixtureObject('text-title', 'text');
    source.transact(ADA, (transaction) => {
      transaction.setObject({
        ...shape,
        fill: ref,
        stroke: { ...shape.stroke, color: ref },
      } as unknown as BoardObject);
      transaction.setObject({
        ...text,
        runs: text.runs.map((run) => ({ ...run, style: { ...run.style, color: ref } })),
      });
    });
    const copy = new YjsDocumentStore();
    copy.applyUpdate(source.encodeState(), RELAY);
    expect(copy.get(shape.id)).toMatchObject({ fill: ref, stroke: { color: ref } });
    expect(copy.get(text.id)).toMatchObject({
      runs: text.runs.map(() => ({ style: { color: ref } })),
    });
    expect(isSameColor(ref as never, { token: 'accent' })).toBe(true);
    expect(isSameColor(ref as never, { token: 'ink' })).toBe(false);
  });

  it('exports and imports a token table with its identities and mode values', () => {
    const board = importBoard({
      format: PORTABLE_BOARD_FORMAT,
      schemaVersion: 8,
      objects: [],
      tokens: [
        {
          id: 'custom-one',
          name: 'Custom',
          identity: { builtin: false, createdBy: 'user:ada', createdAt: 1 },
          light: [1, 0, 0, 1],
          dark: [0, 0, 1, 1],
        },
      ],
    });
    const output = exportBoard(board) as unknown as { tokens?: unknown };
    expect(output.tokens).toEqual([
      {
        id: 'custom-one',
        name: 'Custom',
        identity: { builtin: false, createdBy: 'user:ada', createdAt: 1 },
        light: [1, 0, 0, 1],
        dark: [0, 0, 1, 1],
      },
    ]);
  });
});
