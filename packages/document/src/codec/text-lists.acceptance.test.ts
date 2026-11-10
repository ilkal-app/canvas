import { describe, expect, it } from 'vitest';

import * as document from '@canvas/document';
import { textContentSchema } from '@canvas/schema';
import type { ParagraphStyle } from '@canvas/schema';

import { applyCommand, expectRejected } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { setTextRunsCommand } from '../commands/set-text-runs.js';
import { BODY, createFixtureStore, id } from '../store/__fixtures__/store-fixtures.js';

const versions = document as unknown as Record<string, number>;
const paragraphs: ParagraphStyle[] = [
  {},
  { list: 'bullet', level: 0 },
  { list: 'bullet', level: 2 },
  { list: 'numbered', level: 1 },
];
const richText = 'one\ntwo\nthree\nfour';
const runs = [
  { length: 4, style: { ...BODY, underline: true } },
  { length: richText.length - 4, style: { ...BODY, strikethrough: true } },
];

describe('text lists document codec', () => {
  it('publishes the layout version that stores lists and decoration', () => {
    expect(versions.TEXT_LISTS_LAYOUT_VERSION).toBe(35);
    expect(versions.DOCUMENT_LAYOUT_VERSION).toBeGreaterThanOrEqual(35);
  });

  it.each(['text', 'sticky'] as const)(
    'creates %s with decorated runs and paragraph styles',
    (type) => {
      const store = createFixtureStore();
      const objectId = id(`${type}-lists`);
      try {
        const common = {
          id: objectId,
          type,
          x: 20,
          y: 20,
          width: 240,
          height: 180,
          text: richText,
          runs,
          paragraphs,
          align: 'left' as const,
          autoWidth: false as const,
          verticalAlign: 'top' as const,
        };
        const object =
          type === 'text'
            ? common
            : { ...common, color: [1, 0.92, 0.55, 1] as [number, number, number, number] };
        applyCommand(store, createObjectCommand, { object } as never);
        const read = store.get(objectId);
        expect(read).toMatchObject({ text: richText, runs, paragraphs });
        if (read?.type !== 'text' && read?.type !== 'sticky')
          throw new Error('Expected text or sticky object');
        expect(
          textContentSchema.safeParse({
            text: read.text,
            runs: read.runs,
            ...('paragraphs' in read ? { paragraphs: read.paragraphs } : {}),
          }).success,
        ).toBe(true);
      } finally {
        store.destroy();
      }
    },
  );

  it('setTextRuns replaces paragraphs as part of its full value and refuses wrong counts', () => {
    const store = createFixtureStore();
    const objectId = id('text-title');
    try {
      applyCommand(store, setTextRunsCommand, {
        id: objectId,
        text: richText,
        runs,
        paragraphs,
      });
      expect(store.get(objectId)).toMatchObject({ text: richText, runs, paragraphs });
      expectRejected(store, setTextRunsCommand, {
        id: objectId,
        text: 'a\nb',
        runs: [{ length: 3, style: BODY }],
        paragraphs: [{}],
      });
      applyCommand(store, setTextRunsCommand, { id: objectId, text: richText, runs });
      const read = store.get(objectId) as unknown as { paragraphs?: unknown[] };
      expect(
        read.paragraphs === undefined ||
          read.paragraphs.every((entry) => JSON.stringify(entry) === '{}'),
      ).toBe(true);
    } finally {
      store.destroy();
    }
  });

  it('reads legacy plain text without new fields', () => {
    const store = createFixtureStore();
    try {
      const read = store.get(id('text-title'));
      expect(read).not.toHaveProperty('paragraphs');
      if (read?.type !== 'text') throw new Error('Expected text fixture');
      for (const run of read.runs) {
        expect(run.style).not.toHaveProperty('underline');
        expect(run.style).not.toHaveProperty('strikethrough');
      }
    } finally {
      store.destroy();
    }
  });
});
