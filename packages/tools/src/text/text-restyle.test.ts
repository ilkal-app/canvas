import { describe, expect, it } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { ObjectId, ShapeObject, TextObject } from '@canvas/schema';

import { rect } from '../select/__fixtures__/select-board.js';

import {
  createTextModeContext,
  TEN,
  tenPointNote,
  tenPointText,
} from './__fixtures__/text-mode-context.js';
import { NO_LETTER_SPACING } from './runs/style-fields.js';
import {
  alignTextObjects,
  commonStyleOfObjects,
  directTextObjects,
  lockedLeftNotice,
  restyleTextObjects,
  toggledItalic,
  isBoldWeight,
  toggledWeight,
} from './text-restyle.js';

const RED = { ...TEN, color: [1, 0, 0, 1] as [number, number, number, number] };

/**
 * Reads a text object.
 *
 * @param store - The store.
 * @param store.get - Reads an object.
 * @param id - The id.
 * @returns The text object.
 * @throws {Error} When it is not a text object.
 */
function textIn(store: { get: (id: ObjectId) => unknown }, id: string): TextObject {
  const object = store.get(id as ObjectId) as TextObject | undefined;
  if (object?.type !== 'text') throw new Error(`${id} is not a text object`);
  return object;
}

describe('commonStyleOfObjects', () => {
  it('keeps the fields every text object shares, colours compared by value', () => {
    const a = tenPointText('a', 'ab');
    const b = tenPointText('b', 'cd', { runs: [{ length: 2, style: { ...TEN, weight: 700 } }] });
    expect(commonStyleOfObjects([a, b])).toEqual({
      fontFamily: TEN.fontFamily,
      fontSize: 10,
      color: TEN.color,
      italic: false,
      letterSpacing: NO_LETTER_SPACING,
      lineHeight: 'auto',
      fontVariations: {},
    });
    const red = tenPointText('r', 'ef', { runs: [{ length: 2, style: RED }] });
    expect(commonStyleOfObjects([a, red])).not.toHaveProperty('color');
  });

  it('shares a letter-spacing and line-height set alike, and leaves them out when they differ', () => {
    const tracked = { ...TEN, letterSpacing: { value: 5, unit: 'percent' } } as const;
    const a = tenPointText('a', 'ab', { runs: [{ length: 2, style: tracked }] });
    const b = tenPointText('b', 'cd', { runs: [{ length: 2, style: tracked }] });
    expect(commonStyleOfObjects([a, b])).toMatchObject({
      letterSpacing: tracked.letterSpacing,
      lineHeight: 'auto',
    });
    const plain = tenPointText('p', 'ef');
    expect(commonStyleOfObjects([a, plain])).not.toHaveProperty('letterSpacing');
    expect(commonStyleOfObjects([a, plain])).toHaveProperty('lineHeight', 'auto');
  });

  it('shares nothing when no text object is given', () => {
    expect(commonStyleOfObjects([undefined])).toEqual({});
  });
});

describe('restyling the labels of selected shapes', () => {
  /**
   * A 100 × 60 rectangle, labelled or not.
   *
   * @param id - Its id.
   * @param label - Its label's text, or null for none.
   * @returns The shape.
   */
  function shape(id: string, label: string | null): ShapeObject {
    const base = rect(id, null, { x: 0, y: 0, width: 100, height: 60 });
    const runs = [{ length: label?.length ?? 0, style: TEN }];
    return { ...base, label: label === null ? null : { text: label, runs } };
  }

  it("reads and restyles a label's characters, the shape's size kept, and skips an unlabelled one", () => {
    const { store, context } = createTextModeContext([shape('s', 'ab'), shape('bare', null)]);
    expect(commonStyleOfObjects([store.get('s' as ObjectId)])).toMatchObject({ fontSize: 10 });
    expect(commonStyleOfObjects([store.get('bare' as ObjectId)])).toEqual({});
    restyleTextObjects(context, ['s', 'bare'] as ObjectId[], { fontSize: 20 });
    expect(store.get('s' as ObjectId)).toMatchObject({
      width: 100,
      height: 60,
      label: { runs: [{ length: 2, style: { ...TEN, fontSize: 20 } }] },
    });
    expect(store.get('bare' as ObjectId)).toMatchObject({ label: null });
  });

  it('aligns no shape: a label is always centred', () => {
    const { store, context, record } = createTextModeContext([shape('s', 'ab')]);
    alignTextObjects(context, ['s' as ObjectId], 'left');
    expect(record.capture).toEqual([]);
    expect(store.get('s' as ObjectId)).not.toHaveProperty('align');
  });
});

describe('restyling and aligning selected text objects', () => {
  it("restyles a sticky note's text to a maximum it fits under, growing the note only past the floor", () => {
    const text = Array.from({ length: 8 }, () => 'x').join('\n');
    const { store, context } = createTextModeContext([tenPointNote('n', text)]);
    restyleTextObjects(context, ['n' as ObjectId], { fontSize: 20 });
    // Eight 25-unit lines are 200, over the 168 inside the padding: the text is fitted to the
    // note (16 px, 160), which keeps its square, and 20 is stored as the maximum.
    expect(store.get('n' as ObjectId)).toMatchObject({ width: 200, height: 200 });
    expect(store.get('n' as ObjectId)).toMatchObject({
      runs: [{ length: text.length, style: { ...TEN, fontSize: 20 } }],
    });
    // Twenty lines overflow even at the 8 px floor (200): the note grows to them, and never shrinks.
    const long = Array.from({ length: 20 }, () => 'x').join('\n');
    const grown = createTextModeContext([tenPointNote('g', long)]);
    restyleTextObjects(grown.context, ['g' as ObjectId], { fontSize: 20 });
    expect(grown.store.get('g' as ObjectId)).toMatchObject({ width: 200, height: 232 });
    restyleTextObjects(grown.context, ['g' as ObjectId], { fontSize: 10 });
    expect(grown.store.get('g' as ObjectId)).toMatchObject({ width: 200, height: 232 });
  });

  it('restyles every character of each text object in one undo step, and nothing else', () => {
    const { store, context, record } = createTextModeContext([tenPointText('t', 'abc')]);
    restyleTextObjects(context, ['t' as ObjectId, 'missing' as ObjectId], { fontSize: 20 });
    expect(textIn(store, 't').runs).toEqual([{ length: 3, style: { ...TEN, fontSize: 20 } }]);
    expect(textIn(store, 't')).toMatchObject({ width: 36, height: 25 });
    expect(record.capture).toEqual(['command']);
    restyleTextObjects(context, ['missing' as ObjectId], { fontSize: 30 });
    alignTextObjects(context, [], 'center');
    expect(record.capture).toEqual(['command']);
  });

  it('restyles several texts as one command and one change set, each size following', () => {
    const { store, context, record } = createTextModeContext([
      tenPointText('t', 'abc'),
      tenPointText('u', 'wrapped words', { autoWidth: false, width: 60 }),
    ]);
    const changeSets: ChangeSet[] = [];
    store.subscribe((changes) => changeSets.push(changes));
    restyleTextObjects(context, ['t' as ObjectId, 'u' as ObjectId], { fontSize: 20 });
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]?.updated).toEqual(['t', 'u']);
    expect(record.capture).toEqual(['command']);
    expect(textIn(store, 't')).toMatchObject({ width: 36, height: 25 });
    // 20 px text wraps at 60: "wrapped " and "words" do not fit one line, so the box grows.
    expect(textIn(store, 'u').width).toBe(60);
    expect(textIn(store, 'u').height).toBeGreaterThan(25);
    expect(textIn(store, 'u').runs).toEqual([{ length: 13, style: { ...TEN, fontSize: 20 } }]);
  });

  it('leaves locked texts out, says how many, and restyles the rest whole', () => {
    const { store, context } = createTextModeContext([
      tenPointText('t', 'abc'),
      tenPointText('l', 'xy', { locked: true }),
      tenPointText('m', 'z', { locked: true }),
    ]);
    const notices: string[] = [];
    const lockedOnly: string[] = [];
    restyleTextObjects(
      { ...context, onNotice: (message) => notices.push(message) },
      ['t', 'l', 'm'] as ObjectId[],
      { italic: true },
    );
    expect(textIn(store, 't').runs[0]?.style.italic).toBe(true);
    expect(textIn(store, 'l').runs[0]?.style.italic).toBe(false);
    expect(notices).toEqual(['2 locked objects were left as they were.']);
    restyleTextObjects(
      { ...context, onNotice: (message) => lockedOnly.push(message) },
      ['l'] as ObjectId[],
      { italic: true },
    );
    expect(lockedOnly).toEqual([lockedLeftNotice(1)]);
    expect(lockedLeftNotice(1)).toBe('1 locked object was left as it was.');
  });

  it('restyles without a size while no font is loaded, reporting the texts unmeasured', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'abc')]);
    const unmeasured: ObjectId[] = [];
    restyleTextObjects(
      {
        ...context,
        layout: { layout: () => undefined },
        onWrittenUnmeasured: (id) => unmeasured.push(id),
      },
      ['t' as ObjectId],
      { fontSize: 20 },
    );
    expect(textIn(store, 't')).toMatchObject({ width: 18, height: 12.5 });
    expect(textIn(store, 't').runs[0]?.style.fontSize).toBe(20);
    expect(unmeasured).toEqual(['t']);
  });

  it('reports a restyle the document refuses, writing nothing', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'abc')]);
    const refused: unknown[] = [];
    const before = store.encodeState();
    restyleTextObjects(
      { ...context, onCommandRefused: (errors) => refused.push(errors) },
      ['t' as ObjectId],
      { fontSize: 100_000 },
    );
    expect(refused).toHaveLength(1);
    expect(store.encodeState()).toEqual(before);
  });

  it('aligns only unlocked text boxes in one command and reports skipped locks', () => {
    const { store, context, record } = createTextModeContext([
      tenPointText('t', 'abc'),
      tenPointNote('n', 'note'),
      tenPointText('l', 'locked', { locked: true }),
      { ...tenPointNote('m', 'locked note'), locked: true },
    ]);
    const notices: string[] = [];
    const changeSets: ChangeSet[] = [];
    store.subscribe((changes) => changeSets.push(changes));
    alignTextObjects(
      { ...context, onNotice: (message) => notices.push(message) },
      ['t', 'n', 'l', 'm', 'missing'] as ObjectId[],
      'right',
    );
    expect(store.get('t' as ObjectId)).toMatchObject({ align: 'right' });
    expect(store.get('n' as ObjectId)).toMatchObject({ align: 'right' });
    expect(store.get('l' as ObjectId)).toMatchObject({ align: 'left' });
    expect(store.get('m' as ObjectId)).toMatchObject({ align: 'center' });
    expect(notices).toEqual([lockedLeftNotice(2)]);
    expect(record.capture).toEqual(['command']);
    expect(changeSets).toHaveLength(1);
    expect(changeSets[0]?.updated).toEqual(['n', 't']);
  });

  it('reports an all-locked alignment without opening a command or writing', () => {
    const { store, context, record } = createTextModeContext([
      tenPointText('l', 'locked', { locked: true }),
    ]);
    const notices: string[] = [];
    const before = store.encodeState();
    alignTextObjects(
      { ...context, onNotice: (message) => notices.push(message) },
      ['l'] as ObjectId[],
      'center',
    );
    expect(notices).toEqual([lockedLeftNotice(1)]);
    expect(record.capture).toEqual([]);
    expect(store.encodeState()).toEqual(before);
    // Reporting is optional; the locked-only path still remains a no-op.
    alignTextObjects(context, ['l'] as ObjectId[], 'right');
    expect(record.capture).toEqual([]);
  });

  it('sets the direction of text objects and notes with one command, never of a locked one', () => {
    const { store, context, record } = createTextModeContext([
      tenPointText('t', 'abc'),
      tenPointNote('n', 'note'),
      tenPointText('l', 'locked', { locked: true }),
    ]);
    const notices: string[] = [];
    directTextObjects(
      { ...context, onNotice: (message) => notices.push(message) },
      ['t', 'n', 'l'] as ObjectId[],
      'rtl',
    );
    expect(textIn(store, 't').direction).toBe('rtl');
    expect(store.get('n' as ObjectId)).toMatchObject({ direction: 'rtl' });
    expect(textIn(store, 'l')).not.toHaveProperty('direction');
    expect(notices).toEqual([lockedLeftNotice(1)]);
    expect(record.capture).toEqual(['command']);
    directTextObjects(context, ['t'] as ObjectId[], 'auto');
    expect(textIn(store, 't').direction).toBe('auto');
  });

  it('aligns text objects with one command', () => {
    const { store, context, record } = createTextModeContext([tenPointText('t', 'abc')]);
    alignTextObjects(context, ['t' as ObjectId], 'right');
    expect(textIn(store, 't').align).toBe('right');
    expect(record.capture).toEqual(['command']);
  });

  it('toggles bold off only when all is bold, italic off only when all is italic', () => {
    expect(toggledWeight({ weight: 700 })).toBe(400);
    expect(toggledWeight({})).toBe(700);
    // Semibold and heavier read as bold; medium and lighter do not.
    expect(toggledWeight({ weight: 600 })).toBe(400);
    expect(toggledWeight({ weight: 900 })).toBe(400);
    expect(toggledWeight({ weight: 500 })).toBe(700);
    expect([100, 500, 600, 800].map(isBoldWeight)).toEqual([false, false, true, true]);
    expect(toggledItalic({ italic: true })).toBe(false);
    expect(toggledItalic({})).toBe(true);
  });
});
