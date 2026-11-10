import { describe, expect, it } from 'vitest';

import * as schema from '@canvas/schema';
import type { ParagraphStyle } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import {
  ADA,
  BOB,
  BODY,
  createSyncedPair,
  exchange,
  id,
} from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { runCommand } from './run-command.js';
import { setTextRunsCommand } from './set-text-runs.js';

const TITLE = id('text-title');
const { paragraphCount, textContentSchema } = schema;

function write(
  store: YjsDocumentStore,
  origin: typeof ADA,
  text: string,
  paragraphs: ParagraphStyle[] | undefined,
  runs: { length: number; style: object }[] = [{ length: text.length, style: BODY }],
): void {
  const input = { id: TITLE, text, runs, ...(paragraphs === undefined ? {} : { paragraphs }) };
  expect(
    runCommand(store, origin, setTextRunsCommand, input as never, testEnvironment()).status,
  ).toBe('applied');
}

function read(store: YjsDocumentStore): {
  text: string;
  runs: readonly { length: number; style: Record<string, unknown> }[];
  paragraphs?: ParagraphStyle[] | undefined;
} {
  const object = store.get(TITLE);
  if (object?.type !== 'text') throw new Error('Expected text fixture');
  return object;
}

function converged(ada: YjsDocumentStore, bob: YjsDocumentStore): ReturnType<typeof read> {
  exchange(ada, bob);
  const first = read(ada);
  expect(read(bob)).toEqual(first);
  for (const value of [first, read(bob)]) {
    expect(
      textContentSchema.safeParse({
        text: value.text,
        runs: value.runs,
        ...('paragraphs' in value ? { paragraphs: value.paragraphs } : {}),
      }).success,
    ).toBe(true);
    if (value.paragraphs !== undefined)
      expect(value.paragraphs).toHaveLength(paragraphCount(value.text));
  }
  return first;
}

describe('text lists sync', () => {
  it('merges a paragraph style change with typing inside that paragraph', () => {
    const [ada, bob] = createSyncedPair();
    try {
      write(ada, ADA, 'one\ntwo\nthree', [{}, {}, {}]);
      exchange(ada, bob);
      write(ada, ADA, 'one\ntwo\nthree', [{}, { list: 'bullet', level: 0 }, {}]);
      write(bob, BOB, 'one\ntwoX\nthree', [{}, {}, {}]);
      const result = converged(ada, bob);
      expect(result.text).toBe('one\ntwoX\nthree');
      expect(result.paragraphs?.[1]).toEqual({ list: 'bullet', level: 0 });
    } finally {
      ada.destroy();
      bob.destroy();
    }
  });

  it('preserves the last paragraph list style during a concurrent bullet split', () => {
    const [ada, bob] = createSyncedPair();
    try {
      write(ada, ADA, 'bullet\nlast', [{ list: 'bullet' }, {}]);
      exchange(ada, bob);
      write(ada, ADA, 'bul\nlet\nlast', [{ list: 'bullet' }, { list: 'bullet' }, {}]);
      write(bob, BOB, 'bullet\nlast', [{ list: 'bullet' }, { list: 'numbered', level: 1 }]);
      const result = converged(ada, bob);
      expect(result.text).toBe('bul\nlet\nlast');
      expect(result.paragraphs?.at(-1)).toEqual({ list: 'numbered', level: 1 });
    } finally {
      ada.destroy();
      bob.destroy();
    }
  });

  it('combines concurrent underline and bold over their shared range', () => {
    const [ada, bob] = createSyncedPair();
    try {
      const text = 'abcdefghijklmnopqrst';
      write(ada, ADA, text, undefined);
      exchange(ada, bob);
      write(ada, ADA, text, undefined, [
        { length: 10, style: { ...BODY, underline: true } },
        { length: 10, style: BODY },
      ]);
      write(bob, BOB, text, undefined, [
        { length: 5, style: BODY },
        { length: 10, style: { ...BODY, weight: 700 as const } },
        { length: 5, style: BODY },
      ]);
      const result = converged(ada, bob);
      const styles = result.runs.flatMap((run) =>
        Array.from({ length: run.length }, () => run.style),
      );
      for (let index = 5; index < 10; index += 1)
        expect(styles[index]).toMatchObject({ underline: true, weight: 700 });
    } finally {
      ada.destroy();
      bob.destroy();
    }
  });

  it('converges valid paragraphs when a newline deletion races typing in a later paragraph', () => {
    const [ada, bob] = createSyncedPair();
    try {
      write(ada, ADA, 'one\ntwo\nthree', [{}, { list: 'bullet' }, {}]);
      exchange(ada, bob);
      write(ada, ADA, 'onetwo\nthree', [{}, {}]);
      write(bob, BOB, 'one\ntwo\nthreeX', [{}, { list: 'bullet' }, {}]);
      const result = converged(ada, bob);
      expect(result.text).toBe('onetwo\nthreeX');
    } finally {
      ada.destroy();
      bob.destroy();
    }
  });

  it('undoes a paragraph-only edit in one step', () => {
    const [ada, bob] = createSyncedPair();
    const history = createHistory(ada, ADA.principalId, { captureTimeout: 30_000 });
    try {
      write(ada, ADA, 'one\ntwo', [{ list: 'bullet' }, { list: 'numbered', level: 1 }]);
      exchange(ada, bob);
      history.stopCapturing();
      write(ada, ADA, 'one\ntwo', [{ list: 'bullet' }, { list: 'bullet', level: 2 }]);
      expect(read(ada).paragraphs?.[1]).toEqual({ list: 'bullet', level: 2 });
      expect(history.undo()).toBe(true);
      expect(read(ada).paragraphs).toEqual([{ list: 'bullet' }, { list: 'numbered', level: 1 }]);
      converged(ada, bob);
    } finally {
      history.destroy();
      ada.destroy();
      bob.destroy();
    }
  });
});
