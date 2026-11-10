import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import { colorReason } from '../drawable/drawable-ranges.js';
import { drawableValuesReason } from '../drawable/drawable-values.js';
import { paintReason, strokeValueReason } from '../drawable/paint-values.js';
import {
  BODY,
  frame,
  instance,
  shape,
  sticky,
  text,
} from '../instances/__fixtures__/component-board.js';
import { BoardImportError } from '../portable/board-import-error.js';
import { exportBoard } from '../portable/export-board.js';
import { importBoard } from '../portable/import-board.js';
import { validateBoard } from '../rules/validate-board.js';

import { colorTokenUsesOf, hasColorToken } from './color-token-refs.js';

const BRAND = {
  id: 'brand',
  name: 'Brand',
  light: [1, 0, 0, 1] as [number, number, number, number],
  dark: [0, 0, 1, 1] as [number, number, number, number],
  builtin: false,
  createdBy: null,
  createdAt: 0,
};

describe('colour token uses', () => {
  it('finds every coloured field naming a token', () => {
    const ref = { token: 'brand' };
    const styled = { ...BODY, color: ref };
    expect(
      colorTokenUsesOf(shape('s', null, { fill: ref, stroke: { color: ref, width: 1 } })),
    ).toEqual([
      { token: 'brand', path: ['stroke', 'color'] },
      { token: 'brand', path: ['fill'] },
    ]);
    expect(colorTokenUsesOf(sticky('n', null, { color: ref }))).toEqual([
      { token: 'brand', path: ['color'] },
    ]);
    expect(colorTokenUsesOf(frame('f', null, { background: ref }))).toEqual([
      { token: 'brand', path: ['background'] },
    ]);
    expect(colorTokenUsesOf(text('t', null, { runs: [{ length: 2, style: styled }] }))).toEqual([
      { token: 'brand', path: ['runs', 0, 'style', 'color'] },
    ]);
    const overridden = instance('i', 'm', {
      overrides: { s: { fill: ref, textStyle: { color: { token: 'muted' } } } },
    });
    expect(colorTokenUsesOf(overridden)).toEqual([
      { token: 'brand', path: ['overrides', 's', 'fill'] },
      { token: 'muted', path: ['overrides', 's', 'textStyle', 'color'] },
    ]);
  });

  it('reports a token the board lacks as a notice, built-ins and table entries never', () => {
    const objects = [
      shape('a', null, { fill: { token: 'brand' } }),
      shape('b', null, { fill: { token: 'accent' } }),
      shape('c', null, { fill: { token: 'gone' } }),
    ];
    const issues = validateBoard(createBoard(objects, undefined, [BRAND]));
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'unknown-color-token',
        objectId: 'c',
        relatedId: 'gone',
        path: ['fill'],
        severity: 'notice',
      }),
    ]);
    expect(validateBoard(createBoard(objects)).map(({ objectId }) => objectId)).toEqual(['a', 'c']);
    expect(hasColorToken({}, 'ink')).toBe(true);
  });
});

describe('the door on token references', () => {
  it('accepts a valid reference in a fill and a stroke, refuses a malformed one', () => {
    expect(paintReason({ token: 'ink' })).toBeUndefined();
    expect(paintReason({ token: 'bad id' })).toEqual({ field: 'token', reason: 'out-of-range' });
    expect(paintReason({ token: 'a', type: 'linear' })).toEqual({
      field: '',
      reason: 'not-a-record',
    });
    expect(paintReason('ink')).toEqual({ field: '', reason: 'not-a-record' });
    expect(strokeValueReason({ color: { token: 'text' }, width: 2 })).toBeUndefined();
    expect(strokeValueReason({ color: { token: 7 }, width: 2 })).toEqual({
      field: 'color.token',
      reason: 'out-of-range',
    });
    expect(colorReason({ token: 'text' })).toBeUndefined();
  });

  it('judges a container colour mode', () => {
    expect(drawableValuesReason('style', { colorMode: 'dark' })).toBeUndefined();
    expect(drawableValuesReason('style', { colorMode: 'dim' })).toEqual({
      field: 'colorMode',
      reason: 'out-of-range',
    });
  });
});

describe('portable token tables', () => {
  it('round-trips the table and leaves it out when there is none', () => {
    const objects = [shape('a', null, { fill: { token: 'brand' }, pageId: 'page-1' })];
    const exported = exportBoard(createBoard(objects, undefined, [BRAND]));
    expect(exported.tokens).toEqual([
      {
        id: 'brand',
        name: 'Brand',
        identity: { builtin: false, createdBy: null, createdAt: 0 },
        light: BRAND.light,
        dark: BRAND.dark,
      },
    ]);
    const imported = importBoard(JSON.parse(JSON.stringify(exported)));
    expect(imported.tokens?.get('brand')).toEqual(BRAND);
    expect('tokens' in exportBoard(createBoard(objects))).toBe(false);
  });

  it('marks an edited built-in and refuses a repeated token id', () => {
    const base = exportBoard(createBoard([]));
    const accent = { id: 'accent', name: 'accent', light: BRAND.light, dark: BRAND.dark };
    expect(importBoard({ ...base, tokens: [accent] }).tokens?.get('accent')?.builtin).toBe(true);
    expect(() => importBoard({ ...base, tokens: [accent, accent] })).toThrow(BoardImportError);
  });

  it('imports content naming an unknown token, keeping the notice', () => {
    const objects = [shape('a', null, { fill: { token: 'gone' }, pageId: 'page-1' })];
    const board = importBoard(JSON.parse(JSON.stringify(exportBoard(createBoard(objects)))));
    expect(board.objects.size).toBe(1);
  });
});
