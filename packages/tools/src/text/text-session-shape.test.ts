// An editing session over a shape's label: the label is created by the first character
// in the style typing uses, written without a size (a label has none), laid out centred in the
// box inscribed in the shape, and the caret, the overlay and presses land where the engine draws
// its glyphs; a label emptied leaves the shape as it was.
import { describe, expect, it } from 'vitest';

import { runCommand, setTextRunsCommand } from '@canvas/document';
import type { ObjectId, PrincipalId, ShapeObject } from '@canvas/schema';

import { rect } from '../select/__fixtures__/select-board.js';

import { createTextModeContext, TEN } from './__fixtures__/text-mode-context.js';
import { isOnSessionBox, sessionCaretBox } from './text-session-geometry.js';
import { TextEditingSession } from './text-session.js';

/**
 * A session over one 200 × 100 rectangle at the origin, with a label or none.
 *
 * @param label - The label's text, or null for none.
 * @param caret - The caret.
 * @returns The store, the session and what the context recorded.
 */
function shapeSession(label: string | null, caret: number | 'all' = 0) {
  const base = rect('s', null, { x: 0, y: 0, width: 200, height: 100 });
  const shape: ShapeObject = {
    ...base,
    label: label === null ? null : { text: label, runs: [{ length: label.length, style: TEN }] },
  };
  const fixture = createTextModeContext([shape]);
  const session = new TextEditingSession(fixture.context, shape, caret);
  const read = (): ShapeObject | undefined =>
    fixture.store.get('s' as ObjectId) as ShapeObject | undefined;
  return { ...fixture, session, read };
}

/** A collaborator. */
const BOB = { kind: 'user', principalId: 'user:bob' as PrincipalId } as const;

// 10 px monospaced text: 6 units a character, 12.5 a line. The sharp rectangle's label box is the
// whole shape less 8 units of padding: 184 wide, 84 tall. "abc" (18 wide) is centred in it, 83 in;
// its one line is centred in the height, (84 − 12.5) / 2 = 35.75 below the padding.
const TEXT_LEFT = 8 + 83;
const TEXT_TOP = 8 + 35.75;

describe('TextEditingSession on a shape label', () => {
  it("creates the label with the first character typed, in the typing style, the shape's size kept", () => {
    const { session, read } = shapeSession(null);
    expect(session.editor.text).toBe('');
    session.type('Hi');
    expect(read()).toMatchObject({
      label: { text: 'Hi', runs: [{ length: 2, style: TEN }] },
      width: 200,
      height: 100,
    });
  });

  it('keeps the shape, and its empty label, when the label is emptied and editing ends', () => {
    const { session, read } = shapeSession('a', 1);
    session.deleteBackward();
    session.end();
    expect(read()).toMatchObject({ label: { text: '' } });
  });

  it('places the caret by the text centred in the shape', () => {
    const { session } = shapeSession('abc', 0);
    session.placeCaret({ x: TEXT_LEFT + 7, y: TEXT_TOP + 5 }, false);
    expect(session.editor.caret).toBe(1);
    const caret = sessionCaretBox(session);
    expect(caret?.x).toBeCloseTo(TEXT_LEFT + 6, 9);
    expect(caret?.y).toBeCloseTo(TEXT_TOP, 9);
  });

  it("takes presses on the whole shape as the editor's, and none outside it", () => {
    const { session } = shapeSession('abc', 0);
    expect(isOnSessionBox(session, { x: 195, y: 95 }, 0)).toBe(true);
    expect(isOnSessionBox(session, { x: 210, y: 50 }, 0)).toBe(false);
  });

  it('takes presses on label lines that overflow the shape, which stays centred on them', () => {
    // Twelve lines of 12.5 (150) in the 84-tall box: centred, 33 above it and 33 below, so the
    // text runs from 8 − 33 = −25 to 8 + 84 + 33 = 125.
    const text = Array.from({ length: 12 }, () => 'abc').join('\n');
    const { session } = shapeSession(text, 0);
    expect(sessionCaretBox(session)?.y).toBeCloseTo(-25, 9);
    expect(isOnSessionBox(session, { x: 100, y: -20 }, 0)).toBe(true);
    expect(isOnSessionBox(session, { x: 100, y: 120 }, 0)).toBe(true);
    expect(isOnSessionBox(session, { x: 100, y: -30 }, 0)).toBe(false);
    expect(isOnSessionBox(session, { x: 100, y: 130 }, 0)).toBe(false);
    expect(isOnSessionBox(session, { x: 210, y: 50 }, 0)).toBe(false);
  });

  it('previews a composition in the label, and writes nothing until it commits', () => {
    const { session, read, record } = shapeSession('ab', 2);
    session.updateComposition('c');
    expect(record.previews.get('s' as ObjectId)).toMatchObject({ label: { text: 'abc' } });
    expect(read()?.label?.text).toBe('ab');
    session.commitComposition('c');
    expect(read()?.label?.text).toBe('abc');
  });

  it("follows a collaborator's typing in the label", () => {
    const { session, store } = shapeSession('ab', 2);
    const runs = [{ length: 3, style: TEN }];
    const environment = { clock: () => 1, createId: () => 'unused' as ObjectId };
    const input = { id: 's' as ObjectId, text: 'xab', runs };
    runCommand(store, BOB, setTextRunsCommand, input, environment);
    expect(session.editor.text).toBe('xab');
    expect(session.editor.caret).toBe(3);
  });
});
