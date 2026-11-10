// Independent acceptance for styled instance overrides.
import { describe, expect, it } from 'vitest';

import {
  BODY,
  boardOf,
  component,
  connector,
  id,
  instance,
  shape,
  sticky,
  text,
} from './__fixtures__/component-board.js';
import { byId, fullBoard, RED, resolve } from './__fixtures__/resolved-board.js';
import { overrideRecordSchema } from './instance-overrides.js';
import { instanceOverrideFields } from './override-content.js';
import { resolveInstanceChild } from './resolve-instance-child.js';

const bold = { ...BODY, weight: 700 as const };
const runs = [
  { length: 2, style: BODY },
  { length: 2, style: bold },
];
const style = { color: RED };

describe('override records', () => {
  it('accepts every partial textStyle field and text with valid runs', () => {
    for (const field of [
      { color: RED },
      { color: 'ink' },
      { fontSize: 4 },
      { fontSize: 400 },
      { weight: 400 },
      { weight: 700 },
      { italic: true },
      { fontFamily: 'Inter' },
    ]) {
      expect(overrideRecordSchema.safeParse({ textStyle: field }).success).toBe(true);
    }
    expect(overrideRecordSchema.safeParse({ text: 'Note', runs }).success).toBe(true);
    expect(
      overrideRecordSchema.safeParse({ text: '', runs: [{ length: 0, style: BODY }] }).success,
    ).toBe(true);
  });

  it('refuses malformed styles and run coverage', () => {
    for (const record of [
      { textStyle: {} },
      { textStyle: { unknown: true } },
      { textStyle: { color: 'red' } },
      { textStyle: { fontSize: 3 } },
      { textStyle: { fontSize: 401 } },
      { textStyle: { weight: 450 } },
      { textStyle: { fontFamily: '' } },
      { textStyle: { fontFamily: 'a'.repeat(201) } },
      { runs },
      { text: 'No', runs },
      { text: 'No', runs: [] },
      {
        text: 'Note',
        runs: [
          { length: 2, style: BODY },
          { length: 2, style: BODY },
        ],
      },
      {
        text: '😀',
        runs: [
          { length: 1, style: BODY },
          { length: 1, style: bold },
        ],
      },
      {
        text: 'N',
        runs: [
          { length: 0, style: BODY },
          { length: 1, style: bold },
        ],
      },
    ])
      expect(overrideRecordSchema.safeParse(record).success, JSON.stringify(record)).toBe(false);
  });

  it('lists textStyle and runs precisely on the types that already list text', () => {
    const objects = [
      text('t', null),
      sticky('s', null),
      shape('s1', null),
      connector('c', null, 's1', 's2'),
      shape('s2', null),
    ];
    for (const object of objects) {
      const fields = instanceOverrideFields(object);
      expect(fields.includes('textStyle')).toBe(fields.includes('text'));
      expect(fields.includes('runs')).toBe(fields.includes('text'));
    }
  });
});

describe('resolution', () => {
  it('restyles every source run, then follows a later main text edit', () => {
    const overrides = { sticky: { textStyle: style } };
    const source = sticky('sticky', 'main', { runs });
    expect(byId(resolve(fullBoard({ overrides }, [source])).objects, 'inst/sticky').runs).toEqual([
      { length: 2, style: { ...BODY, ...style } },
      { length: 2, style: { ...bold, ...style } },
    ]);
    const edited = sticky('sticky', 'main', { text: 'Later', runs: [{ length: 5, style: bold }] });
    expect(byId(resolve(fullBoard({ overrides }, [edited])).objects, 'inst/sticky')).toMatchObject({
      text: 'Later',
      runs: [{ length: 5, style: { ...bold, ...style } }],
    });
  });

  it('sets size and weight, or exact replacement text and runs', () => {
    expect(
      byId(
        resolve(fullBoard({ overrides: { sticky: { textStyle: { fontSize: 40, weight: 700 } } } }))
          .objects,
        'inst/sticky',
      ).runs,
    ).toEqual([{ length: 4, style: { ...BODY, fontSize: 40, weight: 700 } }]);
    expect(
      byId(
        resolve(fullBoard({ overrides: { sticky: { text: 'Note', runs } } })).objects,
        'inst/sticky',
      ).runs,
    ).toEqual(runs);
  });

  it('merges equal neighbours after applying textStyle over replacement runs', () => {
    const result = byId(
      resolve(
        fullBoard({
          overrides: { sticky: { text: 'Note', runs, textStyle: { weight: 400, color: RED } } },
        }),
      ).objects,
      'inst/sticky',
    );
    expect(result.runs).toEqual([{ length: 4, style: { ...BODY, color: RED } }]);
  });

  it('restyles shape and connector labels while leaving an unlabelled shape alone', () => {
    const label = { text: 'A', runs: [{ length: 1, style: BODY }] };
    const board = fullBoard(
      {
        overrides: {
          'child-a': { textStyle: style },
          'child-b': { textStyle: style },
          conn: { text: 'BC', runs: [{ length: 2, style: bold }], textStyle: style },
        },
      },
      [connector('conn', 'main', 'child-a', 'child-b', { label })],
    );
    const objects = resolve(board).objects;
    expect(byId(objects, 'inst/child-a').label).toEqual({
      text: 'A',
      runs: [{ length: 1, style: { ...BODY, ...style } }],
    });
    expect(byId(objects, 'inst/child-b').label).toBeNull();
    expect(byId(objects, 'inst/conn').label).toEqual({
      text: 'BC',
      runs: [{ length: 2, style: { ...bold, ...style } }],
    });
  });

  it('merges nested styles key by key and drops inner runs when outer text replaces them', () => {
    const nested = instance('nested', 'inner', {
      parentId: id('main'),
      overrides: { leaf: { text: 'ABCD', runs, textStyle: { color: RED, fontSize: 30 } } },
    });
    const board = boardOf([
      component('main'),
      component('inner'),
      text('leaf', 'inner', { text: 'Note', runs: [{ length: 4, style: BODY }] }),
      nested,
      instance('inst', 'main', {
        overrides: { 'nested/leaf': { text: 'New', textStyle: { fontSize: 40 } } },
      }),
    ]);
    expect(byId(resolve(board).objects, 'inst/nested/leaf')).toMatchObject({
      text: 'New',
      runs: [{ length: 3, style: { ...BODY, color: RED, fontSize: 40 } }],
    });
  });

  it('resolves a leaf identically through resolveInstanceChild and ignores one unparsable record whole', () => {
    const board = fullBoard({
      overrides: { sticky: { text: 'Other', textStyle: { bogus: true } } },
    });
    expect(byId(resolve(board).objects, 'inst/sticky')).toMatchObject({
      text: 'Note',
      runs: [{ length: 4, style: BODY }],
    });
    for (const [path, override] of [
      ['sticky', { textStyle: style }],
      ['sticky', { textStyle: { fontSize: 40, weight: 700 } }],
      ['sticky', { text: 'Note', runs }],
      ['sticky', { text: 'Note', runs, textStyle: style }],
      ['text', { textStyle: style }],
      ['child-a', { textStyle: style }],
    ] as const) {
      const valid = fullBoard({ overrides: { [path]: override } });
      const found = resolveInstanceChild(valid, valid.objects.get(id('inst')) as never, id(path));
      expect(found).toEqual({
        kind: 'shown',
        object: byId(resolve(valid).objects, `inst/${path}`),
      });
    }
  });
});
