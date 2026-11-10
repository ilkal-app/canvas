// An editing session over a sticky note: the note's text lays out inside its padding,
// centred, the note stays at least square and grows with its text, an empty note is kept, and
// the caret, the overlay and presses land where the engine draws the note's glyphs.
import { describe, expect, it } from 'vitest';

import { INK_COLORS, type BoardObject, type ObjectId, type StickyObject } from '@canvas/schema';

import { createTextModeContext, tenPointNote } from './__fixtures__/text-mode-context.js';
import { isOnSessionBox, sessionCaretBox, sessionOverlayRects } from './text-session-geometry.js';
import { TextEditingSession } from './text-session.js';

/**
 * A session over one note, the caret at an index.
 *
 * @param text - The note's text.
 * @param caret - The caret.
 * @returns The store, the session and what the context recorded.
 */
function noteSession(text: string, caret: number) {
  const note = tenPointNote('n', text);
  const fixture = createTextModeContext([note]);
  const session = new TextEditingSession(fixture.context, note, caret);
  const read = (): StickyObject | undefined =>
    fixture.store.get('n' as ObjectId) as StickyObject | undefined;
  return { ...fixture, session, read };
}

// 10 px monospaced text: 6 units a character, 12.5 a line. "abc" is 18 wide, centred in the
// 168-unit wrap width (75 in) after the 16-unit padding; one line centred in the 168-unit padded
// height: (168 − 12.5) / 2 = 77.75 below the top padding.
const TEXT_LEFT = 16 + 75;
const TEXT_TOP = 16 + 77.75;

describe('TextEditingSession on a sticky note', () => {
  it('draws an ink caret dark on the pastel note in either theme', () => {
    const plain = tenPointNote('n', 'ab');
    const runs = plain.runs.map((run) => ({ ...run, style: { ...run.style, color: 'ink' } }));
    const note = { ...plain, runs } as StickyObject;
    const fixture = createTextModeContext([note]);
    const session = new TextEditingSession(fixture.context, note, 1);
    const colors = { tokens: new Map(), board: fixture.store.read() };
    for (const theme of ['light', 'dark'] as const) {
      const caret = sessionOverlayRects(session, 1, theme, undefined, colors).at(-1);
      expect(caret?.color).toEqual(INK_COLORS.light);
      expect(sessionOverlayRects(session, 1, theme).at(-1)?.color).toEqual(INK_COLORS.light);
    }
  });

  it('draws the caret light on a token note the frame-fill rule makes dark', () => {
    const plain = tenPointNote('n', 'ab', {
      parentId: 'f' as ObjectId,
      color: { token: 'surface' },
    });
    const runs = plain.runs.map((run) => ({ ...run, style: { ...run.style, color: 'ink' } }));
    const note = { ...plain, runs } as StickyObject;
    const placement = Object.fromEntries(
      [
        'x',
        'y',
        'width',
        'height',
        'rotation',
        'z',
        'locked',
        'createdBy',
        'createdAt',
        'updatedAt',
      ].map((key) => [key, plain[key as keyof StickyObject]]),
    );
    const frame = {
      ...placement,
      id: 'f',
      parentId: null,
      type: 'frame',
      name: 'Navy',
      clip: false,
      background: [0.08, 0.1, 0.2, 1],
    } as unknown as BoardObject;
    const fixture = createTextModeContext([frame, note]);
    const session = new TextEditingSession(fixture.context, note, 1);
    const colors = { tokens: new Map(), board: fixture.store.read() };
    // The navy frame puts the note in dark mode, where surface is dark: its ink text is light.
    const caret = sessionOverlayRects(session, 1, 'light', undefined, colors).at(-1);
    expect(caret?.color).toEqual(INK_COLORS.dark);
  });

  it('writes typed text with the note kept square while the text is short', () => {
    const { session, read } = noteSession('', 0);
    session.type('Hi');
    expect(read()).toMatchObject({ text: 'Hi', width: 200, height: 200 });
  });

  it('fits the text to the note, and grows it only once the text overflows at the floor', () => {
    const fitted = noteSession('', 0);
    fitted.session.type(Array.from({ length: 15 }, () => 'x').join('\n'));
    // 15 lines of 12.5 (10 px) are 187.5, taller than the 168 inside the padding: fitted at the
    // 8 px floor they are 150, so the note keeps its 200 square.
    expect(fitted.read()).toMatchObject({ width: 200, height: 200 });
    const grown = noteSession('', 0);
    grown.session.type(Array.from({ length: 17 }, () => 'x').join('\n'));
    // 17 lines at the floor are 170, still over 168: the note grows to them and its padding.
    expect(grown.read()).toMatchObject({ width: 200, height: 202 });
  });

  it('keeps a note left empty when editing ends, typed into or not', () => {
    const untouched = noteSession('', 0);
    untouched.session.end();
    expect(untouched.read()).toBeDefined();
    const emptied = noteSession('a', 1);
    emptied.session.deleteBackward();
    emptied.session.end();
    expect(emptied.read()).toMatchObject({ text: '' });
  });

  it('places the caret by the centred text, inside the padding', () => {
    const { session } = noteSession('abc', 0);
    session.placeCaret({ x: TEXT_LEFT + 7, y: TEXT_TOP + 5 }, false);
    expect(session.editor.caret).toBe(1);
    expect(sessionCaretBox(session)).toMatchObject({ x: TEXT_LEFT + 6, y: TEXT_TOP });
  });

  it('outlines the whole note and draws the caret on the centred text', () => {
    const { session } = noteSession('abc', 3);
    const rects = sessionOverlayRects(session, 1);
    const [top] = rects;
    expect(top?.box).toMatchObject({ x: -1, y: -1, width: 202 });
    const caret = rects.at(-1)?.box;
    expect(caret?.x).toBeCloseTo(TEXT_LEFT + 18 - 0.75, 9);
    expect(caret?.y).toBeCloseTo(TEXT_TOP, 9);
  });

  it('puts the caret box at the end of a composition on the centred text', () => {
    const { session } = noteSession('abc', 3);
    session.updateComposition('xy');
    // "abcxy" is 30 wide, centred: 69 in; the composition ends after it.
    expect(sessionCaretBox(session)).toMatchObject({ x: 16 + 69 + 30, y: TEXT_TOP });
  });

  it('counts a press anywhere on the note as on the edited box', () => {
    const { session } = noteSession('abc', 0);
    expect(isOnSessionBox(session, { x: 195, y: 195 }, 0)).toBe(true);
    expect(isOnSessionBox(session, { x: 205, y: 100 }, 0)).toBe(false);
  });
});

describe('TextEditingSession on a note made taller than its text', () => {
  /**
   * A session over a 200 × 400 note holding "abc", the caret at its end.
   *
   * @returns The session and a reader of the stored note.
   */
  function tallSession() {
    const note = tenPointNote('n', 'abc', { height: 400 });
    const fixture = createTextModeContext([note]);
    const session = new TextEditingSession(fixture.context, note, 3);
    const read = (): StickyObject | undefined =>
      fixture.store.get('n' as ObjectId) as StickyObject | undefined;
    return { session, read };
  }
  // One line centred in the 368-unit padded height the engine draws it in.
  const tallTextTop = 16 + (368 - 12.5) / 2;

  it('places the caret where the engine draws the text, centred in the stored height', () => {
    const { session } = tallSession();
    expect(sessionCaretBox(session)?.y).toBeCloseTo(tallTextTop, 9);
    session.placeCaret({ x: TEXT_LEFT + 7, y: tallTextTop + 5 }, false);
    expect(session.editor.caret).toBe(1);
  });

  it('outlines the whole stored height and highlights on the drawn text', () => {
    const { session } = tallSession();
    session.selectAll();
    const rects = sessionOverlayRects(session, 1);
    // The outline's bottom edge and its left side: the whole 400-unit note.
    expect(rects[1]?.box).toMatchObject({ x: -1, y: 400, width: 202 });
    expect(rects[2]?.box).toMatchObject({ x: -1, y: 0, height: 400 });
    const highlight = rects[4]?.box;
    expect(highlight?.y).toBeCloseTo(tallTextTop, 9);
  });

  it('counts a press on the lower half as on the edited box', () => {
    const { session } = tallSession();
    expect(isOnSessionBox(session, { x: 100, y: 390 }, 0)).toBe(true);
    expect(isOnSessionBox(session, { x: 100, y: 410 }, 0)).toBe(false);
  });

  it('keeps the stored height while typed into, and grows only once the text overflows at the floor', () => {
    const { session, read } = tallSession();
    session.type('d');
    expect(read()).toMatchObject({ text: 'abcd', width: 200, height: 400 });
    session.type(Array.from({ length: 31 }, () => '\n').join(''));
    // 32 lines of 12.5 (10 px) are 400, over the 368 inside the padding: fitted at 9 px they are
    // 360, so the note keeps the 400 it was made.
    expect(read()?.height).toBe(400);
    session.type(Array.from({ length: 5 }, () => '\n').join(''));
    // 37 lines at the 8 px floor are 370, still over 368: the note grows to them and its padding.
    expect(read()?.height).toBe(402);
  });
});
