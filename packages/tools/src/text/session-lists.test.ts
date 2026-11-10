import { describe, expect, it } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { replaceText, typeText } from './session-edits.js';
import { replaceFontFamilyOnBoard } from './text-font-replace.js';
import { previewTextObjects, restyleTextObjects } from './text-restyle.js';
import { TextEditingSession } from './text-session.js';

/**
 * A session over one text object, its caret at a position.
 *
 * @param text - The object's text.
 * @param caret - Where the caret is.
 * @param paragraphs - Its paragraph styles, if any.
 * @returns The session and the store's copy of the object.
 */
function setUp(text: string, caret: number, paragraphs?: TextObject['paragraphs']) {
  const object = {
    ...tenPointText('t', text, { autoWidth: false, width: 200 }),
    ...(paragraphs === undefined ? {} : { paragraphs }),
  };
  const { store, context } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, caret);
  const stored = (): TextObject => store.get('t' as ObjectId) as TextObject;
  return { session, stored };
}

describe('typing in lists', () => {
  it('turns "- " at a plain paragraph’s start into a bulleted item', () => {
    const { session, stored } = setUp('', 0);
    typeText(session, '-');
    typeText(session, ' ');
    expect(stored()).toMatchObject({ text: '', paragraphs: [{ list: 'bullet' }] });
    typeText(session, 'milk');
    expect(stored()).toMatchObject({ text: 'milk', paragraphs: [{ list: 'bullet' }] });
  });

  it('turns "1. " typed through the input’s own edit into a numbered item', () => {
    const { session, stored } = setUp('', 0);
    replaceText(session, 0, 0, '1.');
    replaceText(session, 2, 2, ' ');
    expect(stored()).toMatchObject({ text: '', paragraphs: [{ list: 'numbered' }] });
  });

  it('carries the list onto a new item, and Enter on an empty item leaves the list', () => {
    const { session, stored } = setUp('milk', 4, [{ list: 'bullet' }]);
    typeText(session, '\n');
    expect(stored()).toMatchObject({
      text: 'milk\n',
      paragraphs: [{ list: 'bullet' }, { list: 'bullet' }],
    });
    typeText(session, '\n');
    expect(stored().text).toBe('milk\n');
    expect(stored().paragraphs).toEqual([{ list: 'bullet' }, {}]);
  });

  it('leaves plain text as it was: no paragraphs written', () => {
    const { session, stored } = setUp('a', 1);
    typeText(session, '\n');
    typeText(session, 'b');
    expect(stored().text).toBe('a\nb');
    expect(stored().paragraphs).toBeUndefined();
  });

  it('lays its text out with the lists, so the caret and selection sit on the indented lines', () => {
    const plain = setUp('milk', 0);
    const listed = setUp('milk', 0, [{ list: 'bullet' }]);
    const plainX = plain.session.layout()?.lines[0]?.x ?? 0;
    // One level's indent: 1.5 em of 10 px text, on the left of this left-aligned text.
    expect(listed.session.layout()?.lines[0]?.x).toBeCloseTo(plainX + 15, 9);
    expect(listed.session.layout()?.markers).toHaveLength(1);
  });

  it('steps out of an empty item on Enter through the input’s own edit too', () => {
    const { session, stored } = setUp('milk\n', 5, [{ list: 'bullet' }, { list: 'bullet' }]);
    replaceText(session, 5, 5, '\n');
    expect(stored().text).toBe('milk\n');
    expect(stored().paragraphs).toEqual([{ list: 'bullet' }, {}]);
  });

  it('measures a restyled or refonted list with its indent', () => {
    const plain = tenPointText('p', 'milk');
    const listed = { ...tenPointText('l', 'milk'), paragraphs: [{ list: 'bullet' as const }] };
    const { context } = createTextModeContext([plain, listed]);
    const [plainPreview, listedPreview] = previewTextObjects(
      context,
      ['p' as ObjectId, 'l' as ObjectId],
      { italic: true },
    );
    // One level's indent: 1.5 em of 10 px text.
    const widthOf = (object: typeof listedPreview): number =>
      object?.type === 'text' ? object.width : Number.NaN;
    expect(widthOf(listedPreview)).toBeCloseTo(widthOf(plainPreview) + 15, 9);
  });

  it('writes a restyled or refonted list’s bounds with its indent', () => {
    const plain = tenPointText('p', 'milk');
    const listed = { ...tenPointText('l', 'milk'), paragraphs: [{ list: 'bullet' as const }] };
    const { context, store } = createTextModeContext([plain, listed]);
    const widthOf = (id: string): number => {
      const object = store.get(id as ObjectId);
      return object?.type === 'text' ? object.width : Number.NaN;
    };
    restyleTextObjects(context, ['p' as ObjectId, 'l' as ObjectId], { italic: true });
    expect(widthOf('l')).toBeCloseTo(widthOf('p') + 15, 9);
    replaceFontFamilyOnBoard(context, plain.runs[0]?.style.fontFamily ?? '', 'Inter');
    expect(widthOf('l')).toBeCloseTo(widthOf('p') + 15, 9);
    expect((store.get('l' as ObjectId) as TextObject).paragraphs).toEqual([{ list: 'bullet' }]);
  });
});
