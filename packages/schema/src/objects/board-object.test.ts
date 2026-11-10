import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { splitEmojiContent, wholeEmojiContent } from '../fields/__fixtures__/split-emoji.js';
import type { TextStyle } from '../fields/text-style.js';
import type { ObjectId } from '../ids/object-id.js';

import { sampleObject } from './__fixtures__/object-samples.js';
import { boardObjectSchema } from './board-object.js';
import { OBJECT_TYPES } from './object-type.js';

const id = (value: string): ObjectId => value as ObjectId;

describe('boardObjectSchema', () => {
  it('accepts a valid sample of every object type', () => {
    for (const type of OBJECT_TYPES) {
      const result = boardObjectSchema.safeParse(sampleObject(type, `sample-${type}`));
      expect(result.error?.issues ?? [], type).toEqual([]);
    }
  });

  it('rejects an unknown key on every object type', () => {
    for (const type of OBJECT_TYPES) {
      expect(
        boardObjectSchema.safeParse({ ...sampleObject(type, 'extra'), extra: 1 }).success,
        type,
      ).toBe(false);
    }
  });

  it('rejects a group with stored bounds, since a group derives them', () => {
    expect(
      boardObjectSchema.safeParse({ ...sampleObject('group', 'g'), width: 10, height: 10 }).success,
    ).toBe(false);
  });

  it('rejects a type-specific field on the wrong type', () => {
    expect(
      boardObjectSchema.safeParse({ ...sampleObject('frame', 'f'), kind: 'rectangle' }).success,
    ).toBe(false);
  });

  it('returns a copy, never the input object', () => {
    const input = sampleObject('shape', 's');
    expect(boardObjectSchema.parse(input)).not.toBe(input);
    expect(boardObjectSchema.parse(input)).toEqual(input);
  });

  it('converts to JSON Schema with field descriptions, for the agent surface', () => {
    const jsonSchema = JSON.stringify(z.toJSONSchema(boardObjectSchema));
    expect(jsonSchema).toContain('Fractional-index key ordering siblings bottom to top');
    for (const type of OBJECT_TYPES) {
      expect(jsonSchema).toContain(`"const":"${type}"`);
    }
  });
});

describe('text and sticky objects', () => {
  it('reject runs that do not cover the text', () => {
    for (const type of ['text', 'sticky'] as const) {
      const result = boardObjectSchema.safeParse({ ...sampleObject(type, 't'), text: 'Hello!' });
      expect(result.success, type).toBe(false);
      expect(result.error?.issues[0]?.path, type).toEqual(['runs']);
    }
  });

  it('reject runs whose boundary splits an emoji, naming the run', () => {
    for (const type of ['text', 'sticky'] as const) {
      const split = boardObjectSchema.safeParse({
        ...sampleObject(type, 't'),
        ...splitEmojiContent(),
      });
      expect(
        split.error?.issues.map((issue) => issue.path),
        type,
      ).toEqual([['runs', 1]]);
      const whole = boardObjectSchema.safeParse({
        ...sampleObject(type, 't'),
        ...wholeEmojiContent(),
      });
      expect(whole.success, type).toBe(true);
    }
  });

  it('reject a sticky with auto width, since a sticky has a fixed width', () => {
    expect(
      boardObjectSchema.safeParse({ ...sampleObject('sticky', 's'), autoWidth: true }).success,
    ).toBe(false);
  });

  it('reject an unknown alignment', () => {
    expect(
      boardObjectSchema.safeParse({ ...sampleObject('text', 't'), align: 'justify' }).success,
    ).toBe(false);
  });
});

describe('image objects', () => {
  it('accept a crop that reaches the far edges despite floating-point sums', () => {
    const crop = { x: 0.1, y: 0.7, width: 0.9, height: 0.3 };
    expect(boardObjectSchema.safeParse(sampleObject('image', 'i', { crop })).success).toBe(true);
  });

  it('reject a crop that extends past the image or is empty', () => {
    for (const crop of [
      { x: 0.5, y: 0, width: 0.6, height: 1 },
      { x: 0, y: 0.5, width: 1, height: 0.6 },
      { x: 0, y: 0, width: 0, height: 1 },
    ]) {
      expect(boardObjectSchema.safeParse(sampleObject('image', 'i', { crop })).success).toBe(false);
    }
  });

  it('reject a fractional natural size and an opacity above 1', () => {
    expect(
      boardObjectSchema.safeParse(
        sampleObject('image', 'i', { naturalSize: { width: 1.5, height: 2 } }),
      ).success,
    ).toBe(false);
    expect(boardObjectSchema.safeParse(sampleObject('image', 'i', { opacity: 1.1 })).success).toBe(
      false,
    );
  });
});

describe('video objects', () => {
  it('accept a trim that ends after it starts', () => {
    expect(
      boardObjectSchema.safeParse(
        sampleObject('video', 'v', { trim: { startMs: 500, endMs: 2500 } }),
      ).success,
    ).toBe(true);
  });

  it('reject a trim that ends at or before its start', () => {
    for (const trim of [
      { startMs: 1000, endMs: 1000 },
      { startMs: 2000, endMs: 1000 },
    ]) {
      expect(boardObjectSchema.safeParse(sampleObject('video', 'v', { trim })).success).toBe(false);
    }
  });
});

describe('shape objects', () => {
  it('reject fewer than three sides, a negative corner radius and an unknown kind', () => {
    expect(boardObjectSchema.safeParse(sampleObject('shape', 's', { sides: 2 })).success).toBe(
      false,
    );
    expect(
      boardObjectSchema.safeParse(sampleObject('shape', 's', { cornerRadius: -1 })).success,
    ).toBe(false);
    expect(
      boardObjectSchema.safeParse({ ...sampleObject('shape', 's'), kind: 'heart' }).success,
    ).toBe(false);
  });

  it('validate the label runs like any other text', () => {
    const style: TextStyle = {
      fontFamily: 'Inter',
      fontSize: 16,
      color: [0, 0, 0, 1],
      weight: 400,
      italic: false,
    };
    const goodLabel = { text: 'Go', runs: [{ length: 2, style }] };
    expect(
      boardObjectSchema.safeParse(sampleObject('shape', 's', { label: goodLabel })).success,
    ).toBe(true);
    expect(
      boardObjectSchema.safeParse(
        sampleObject('shape', 's', { label: { ...goodLabel, text: 'Gone' } }),
      ).success,
    ).toBe(false);
  });

  it('reject shape and connector labels whose run boundary splits an emoji', () => {
    for (const type of ['shape', 'connector'] as const) {
      const split = boardObjectSchema.safeParse(
        sampleObject(type, 'o', { label: splitEmojiContent() }),
      );
      expect(
        split.error?.issues.map((issue) => issue.path),
        type,
      ).toEqual([['label', 'runs', 1]]);
      const whole = boardObjectSchema.safeParse(
        sampleObject(type, 'o', { label: wholeEmojiContent() }),
      );
      expect(whole.success, type).toBe(true);
    }
  });
});

describe('line and connector objects', () => {
  it('reject a line with three points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(boardObjectSchema.safeParse({ ...sampleObject('line', 'l'), points }).success).toBe(
      false,
    );
  });

  it('accept a connector attached to an object with an anchor and with an automatic anchor', () => {
    const from = { kind: 'object', objectId: id('box-1'), anchor: { x: 0.5, y: 0 } } as const;
    const to = { kind: 'object', objectId: id('box-2'), anchor: null } as const;
    expect(boardObjectSchema.safeParse(sampleObject('connector', 'c', { from, to })).success).toBe(
      true,
    );
  });

  it('reject an anchor outside the unit square and an unknown end kind', () => {
    const from = { kind: 'object', objectId: id('box-1'), anchor: { x: 1.5, y: 0 } } as const;
    expect(boardObjectSchema.safeParse(sampleObject('connector', 'c', { from })).success).toBe(
      false,
    );
    expect(
      boardObjectSchema.safeParse({ ...sampleObject('connector', 'c'), to: { kind: 'port' } })
        .success,
    ).toBe(false);
  });
});

describe('comment objects', () => {
  it('accept a pin anchored to an object at an offset', () => {
    const anchor = { kind: 'object', objectId: id('box-1'), offset: { x: 4, y: 4 } } as const;
    expect(boardObjectSchema.safeParse(sampleObject('comment', 'm', { anchor })).success).toBe(
      true,
    );
  });

  it('reject an empty thread id', () => {
    expect(
      boardObjectSchema.safeParse(sampleObject('comment', 'm', { threadId: '' })).success,
    ).toBe(false);
  });
});
