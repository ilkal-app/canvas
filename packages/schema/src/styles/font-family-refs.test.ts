import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import {
  BODY,
  component,
  connector,
  instance,
  shape,
  sticky,
  text,
} from '../instances/__fixtures__/component-board.js';

import { boardFontFamilies, fontFamilyUsesOf } from './font-family-refs.js';

const LORA = { ...BODY, fontFamily: 'Lora' };
const GONE = { ...BODY, fontFamily: 'Brand Grotesk' };

describe('font family uses', () => {
  it('finds every run family of text, sticky, shape and connector labels', () => {
    expect(
      fontFamilyUsesOf(
        text('t', null, {
          text: 'abcd',
          runs: [
            { length: 2, style: BODY },
            { length: 2, style: GONE },
          ],
        }),
      ),
    ).toEqual([
      { family: 'Inter', path: ['runs', 0, 'style', 'fontFamily'] },
      { family: 'Brand Grotesk', path: ['runs', 1, 'style', 'fontFamily'] },
    ]);
    expect(
      fontFamilyUsesOf(sticky('n', null, { text: 'a', runs: [{ length: 1, style: LORA }] })),
    ).toEqual([{ family: 'Lora', path: ['runs', 0, 'style', 'fontFamily'] }]);
    expect(
      fontFamilyUsesOf(
        shape('s', null, { label: { text: 'a', runs: [{ length: 1, style: GONE }] } }),
      ),
    ).toEqual([{ family: 'Brand Grotesk', path: ['label', 'runs', 0, 'style', 'fontFamily'] }]);
    expect(
      fontFamilyUsesOf(
        connector('c', null, 'a', 'b', {
          label: { text: 'a', runs: [{ length: 1, style: LORA }] },
        }),
      ),
    ).toEqual([{ family: 'Lora', path: ['label', 'runs', 0, 'style', 'fontFamily'] }]);
    expect(fontFamilyUsesOf(shape('plain', null, { label: null }))).toEqual([]);
  });

  it('finds an instance’s override families and a main’s preset families', () => {
    const overridden = instance('i', 'm', {
      overrides: {
        a: { textStyle: { fontFamily: 'Brand Grotesk' } },
        b: { textStyle: { fontSize: 30 } },
        c: { text: 'x', runs: [{ length: 1, style: LORA }] },
      },
    });
    // A record that is not an object (a peer's malformed write) names nothing.
    expect(fontFamilyUsesOf(instance('j', 'm', { overrides: { a: null } }))).toEqual([]);
    expect(fontFamilyUsesOf(overridden)).toEqual([
      { family: 'Brand Grotesk', path: ['overrides', 'a', 'textStyle', 'fontFamily'] },
      { family: 'Lora', path: ['overrides', 'c', 'runs', 0, 'style', 'fontFamily'] },
    ]);
    const main = component('m', {
      variantAxes: [{ name: 'size', values: ['small', 'large'] }],
      variantPresets: { 'size=large': { a: { textStyle: { fontFamily: 'Brand Grotesk' } } } },
    });
    expect(fontFamilyUsesOf(main)).toEqual([
      {
        family: 'Brand Grotesk',
        path: ['variantPresets', 'size=large', 'a', 'textStyle', 'fontFamily'],
      },
    ]);
  });

  it('lists a board’s families with the objects and text styles naming each', () => {
    const board = createBoard(
      [
        text('b', null, { text: 'a', runs: [{ length: 1, style: GONE }] }),
        text('a', null, { text: 'ab', runs: [{ length: 2, style: GONE }] }),
        sticky('n', null, { text: 'a', runs: [{ length: 1, style: BODY }] }),
        instance('i', 'm', { overrides: { a: { textStyle: { fontFamily: 'Brand Grotesk' } } } }),
      ],
      undefined,
      undefined,
      {
        textStyles: [
          {
            id: 'heading',
            name: 'Heading',
            value: { fontFamily: 'Display Only', fontSize: 40, weight: 700, italic: false },
            createdBy: null,
            createdAt: 0,
          },
        ],
      },
    );
    expect(boardFontFamilies(board)).toEqual([
      { family: 'Brand Grotesk', objectIds: ['a', 'b', 'i'], textStyleIds: [] },
      { family: 'Display Only', objectIds: [], textStyleIds: ['heading'] },
      { family: 'Inter', objectIds: ['n'], textStyleIds: [] },
    ]);
    expect(boardFontFamilies(createBoard([]))).toEqual([]);
  });
});
