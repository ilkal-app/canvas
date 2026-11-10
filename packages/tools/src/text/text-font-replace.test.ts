import { describe, expect, it } from 'vitest';

import type { CommandError } from '@canvas/document';
import type { ObjectId, TextObject } from '@canvas/schema';

import {
  createTextModeContext,
  TEN,
  tenPointNote,
  tenPointText,
} from './__fixtures__/text-mode-context.js';
import { replacementLeftNotice, replaceFontFamilyOnBoard } from './text-font-replace.js';

const BRAND = { ...TEN, fontFamily: 'Brand Grotesk' };

/**
 * The families of an object's runs.
 *
 * @param store - The store.
 * @param store.get - Reads an object.
 * @param id - The id.
 * @returns The families, in run order.
 */
function familiesOf(store: { get: (id: ObjectId) => unknown }, id: string): string[] {
  const object = store.get(id as ObjectId) as TextObject;
  return object.runs.map((run) => run.style.fontFamily);
}

describe('replaceFontFamilyOnBoard', () => {
  it('replaces the family on every text box in one command, writing measured sizes', () => {
    const { store, context, record } = createTextModeContext([
      tenPointText('a', 'abcd', { runs: [{ length: 4, style: BRAND }], width: 1, height: 1 }),
      tenPointNote('n', 'ab', { runs: [{ length: 2, style: BRAND }] }),
      tenPointText('other', 'xy'),
    ]);
    replaceFontFamilyOnBoard(context, 'Brand Grotesk', 'Lora');
    expect(record.capture).toEqual(['command']);
    expect(familiesOf(store, 'a')).toEqual(['Lora']);
    expect(familiesOf(store, 'n')).toEqual(['Lora']);
    expect(familiesOf(store, 'other')).toEqual([TEN.fontFamily]);
    // Laid out again, the stale 1 × 1 box is measured.
    const text = store.get('a' as ObjectId) as TextObject;
    expect(text.width).toBeGreaterThan(1);
  });

  it('tells the person what it left, and reports texts it could not lay out', () => {
    const notices: string[] = [];
    const unmeasured: string[] = [];
    const { store, context } = createTextModeContext([
      tenPointText('held', 'ab', { runs: [{ length: 2, style: BRAND }], locked: true }),
      tenPointText('a', 'ab', { runs: [{ length: 2, style: BRAND }] }),
    ]);
    replaceFontFamilyOnBoard(
      {
        ...context,
        layout: { layout: () => undefined },
        onNotice: (notice) => notices.push(notice),
        onWrittenUnmeasured: (id) => unmeasured.push(id),
      },
      'Brand Grotesk',
      'Lora',
    );
    expect(familiesOf(store, 'held')).toEqual(['Brand Grotesk']);
    expect(familiesOf(store, 'a')).toEqual(['Lora']);
    expect(notices).toEqual([replacementLeftNotice([{ id: 'held', reason: 'locked' }])]);
    expect(unmeasured).toEqual(['a']);
  });

  it('reports a refused replacement', () => {
    const refused: (readonly CommandError[])[] = [];
    const { context } = createTextModeContext([tenPointText('a', 'ab')]);
    replaceFontFamilyOnBoard(
      { ...context, onCommandRefused: (errors) => refused.push(errors) },
      TEN.fontFamily,
      TEN.fontFamily,
    );
    expect(refused.map((errors) => errors.map(({ code }) => code))).toEqual([['invalid-input']]);
  });

  it('counts what it left in its notice', () => {
    expect(replacementLeftNotice([{ id: 'a', reason: 'locked' }])).toBe(
      '1 locked object or style was left in its font.',
    );
    expect(
      replacementLeftNotice([
        { id: 'a', reason: 'locked' },
        { id: 's', reason: 'bound-by-left-object' },
      ]),
    ).toBe('2 locked objects or styles were left in their font.');
  });
});
