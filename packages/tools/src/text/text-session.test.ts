// The editing session's edges: deleting forward, a cancelled composition, an edit that changes
// nothing, and a page with no fonts yet (nothing lays out). The rest through the text mode:
// text-mode.test.ts.
import { describe, expect, it } from 'vitest';

import type { ObjectId, TextObject, TokenEntry } from '@canvas/schema';

import { ADA, createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { isOnSessionBox, sessionCaretBox, sessionOverlayRects } from './text-session-geometry.js';
import { draftTextObject } from './text-session-object.js';
import { TextEditingSession } from './text-session.js';

/**
 * A session over one text object, the caret at an index.
 *
 * @param text - The object's text.
 * @param caret - The caret.
 * @param hasFonts - Whether the page can lay text out.
 * @returns The store, the session and what the context recorded.
 */
function sessionOver(text: string, caret: number, hasFonts = true) {
  const object = tenPointText('t', text);
  const fixture = createTextModeContext([object]);
  const context = hasFonts
    ? fixture.context
    : { ...fixture.context, layout: { layout: () => undefined } };
  const session = new TextEditingSession(context, object, caret);
  const read = (): TextObject => fixture.store.get('t' as ObjectId) as TextObject;
  return { ...fixture, session, read };
}

describe('TextEditingSession', () => {
  it("draws the caret in the text's colour token, in the object's mode", () => {
    const plain = tenPointText('t', 'ab');
    const runs = plain.runs.map((run) => ({
      ...run,
      style: { ...run.style, color: { token: 'brand' } },
    }));
    const object = { ...plain, runs } as TextObject;
    const fixture = createTextModeContext([object]);
    const session = new TextEditingSession(fixture.context, object, 1);
    const brand: TokenEntry = {
      id: 'brand',
      name: 'Brand',
      light: [1, 0, 0, 1],
      dark: [0, 0, 1, 1],
      builtin: false,
      createdBy: null,
      createdAt: 0,
    };
    const colors = { tokens: new Map([[brand.id, brand]]), board: fixture.store.read() };
    const colours = (theme: 'light' | 'dark') =>
      sessionOverlayRects(session, 1, theme, undefined, colors).map(({ color }) => color);
    expect(colours('dark')).toContainEqual([0, 0, 1, 1]);
    expect(colours('light')).toContainEqual([1, 0, 0, 1]);
    expect(colours('dark')).not.toContainEqual([1, 0, 0, 1]);
  });

  it('deletes forward, and writes nothing for a delete at the text’s end', () => {
    const { session, read, record } = sessionOver('abc', 1);
    session.deleteForward();
    expect(read().text).toBe('ac');
    session.move({ unit: 'textEdge', direction: 1, isExtending: false });
    const steps = [...record.capture];
    session.deleteForward();
    expect(read().text).toBe('ac');
    expect(record.capture).toEqual(steps);
  });

  it('takes an applied edit that leaves the text as it is without writing the document', () => {
    const { session, read, store } = sessionOver('ab', 2);
    const before = store.encodeState();
    session.apply({ ...session.editor, caret: 0, anchor: 0 }, 'command');
    expect(session.editor.caret).toBe(0);
    expect(read().text).toBe('ab');
    expect(store.encodeState()).toEqual(before);
  });

  it('writes nothing for a composition cancelled empty, and drops its preview', () => {
    const { session, read, record } = sessionOver('ab', 2);
    session.startComposition();
    session.updateComposition('k');
    session.commitComposition('');
    expect(read().text).toBe('ab');
    expect(record.previews.get('t' as ObjectId)).toBeUndefined();
    expect(session.isComposing).toBe(false);
  });

  it('edits without a size, and shows nothing, while the page has no fonts', () => {
    const { session, read } = sessionOver('ab', 2, false);
    session.type('c');
    expect(read()).toMatchObject({ text: 'abc', width: 12, height: 12.5 });
    expect(sessionCaretBox(session)).toBeUndefined();
    expect(sessionOverlayRects(session, 1)).toEqual([]);
    expect(isOnSessionBox(session, { x: 5, y: 5 }, 0)).toBe(true);
    expect(isOnSessionBox(session, { x: 50, y: 5 }, 0)).toBe(false);
  });

  it('places nothing once its object is gone', () => {
    const { session, store } = sessionOver('ab', 2);
    store.transact({ kind: 'user', principalId: 'user:bob' as never }, (transaction) => {
      transaction.deleteObject('t' as ObjectId);
    });
    expect(isOnSessionBox(session, { x: 1, y: 1 }, 0)).toBe(false);
    expect(sessionCaretBox(session)).toBeUndefined();
    expect(sessionOverlayRects(session, 1)).toEqual([]);
  });

  it('ignores empty typing, other objects’ changes and a second end, and composes once', () => {
    const other = tenPointText('u', 'zz');
    const fixture = createTextModeContext([tenPointText('t', 'ab'), other]);
    const object = fixture.store.get('t' as ObjectId) as TextObject;
    const session = new TextEditingSession(fixture.context, object, 'all');
    const steps = [...fixture.record.capture];
    session.type('');
    fixture.store.transact(ADA, (transaction) => {
      transaction.patchObject('u' as ObjectId, { x: 40 });
    });
    expect(session.editor).toMatchObject({ caret: 2, anchor: 0 });
    expect(fixture.record.capture).toEqual(steps);
    expect(session.currentStyle()).toMatchObject({ fontSize: 10 });
    session.updateComposition('k');
    session.startComposition();
    expect(session.displayed().text).toBe('k');
    session.end();
    session.end();
    expect(fixture.record.previews.get('t' as ObjectId)).toBeUndefined();
  });

  it('reports an edit the document refuses: locked text, a draft whose id is taken', () => {
    const locked = tenPointText('t', 'ab', { locked: true });
    const fixture = createTextModeContext([locked, tenPointText('new-1', 'taken')]);
    const refused: unknown[] = [];
    const context = {
      ...fixture.context,
      onCommandRefused: (errors: unknown) => refused.push(errors),
    };
    const session = new TextEditingSession(context, locked, 2);
    session.type('c');
    expect(session.editor.text).toBe('ab');
    const draft = draftTextObject(context, {
      ...locked,
      text: '',
      runs: [{ length: 0, style: TEN }],
    });
    const drafted = new TextEditingSession(context, draft, 0, true);
    // A style change of the empty draft is kept, not written; its first character is refused.
    drafted.apply(
      { ...drafted.editor, runs: [{ length: 0, style: { ...TEN, italic: true } }] },
      'command',
    );
    expect(drafted.object()).toMatchObject({
      runs: [{ length: 0, style: { ...TEN, italic: true } }],
    });
    drafted.type('x');
    expect(drafted.editor.text).toBe('');
    expect(refused).toHaveLength(2);
    expect(fixture.store.get('new-1' as ObjectId)).toMatchObject({ text: 'taken' });
  });
});
