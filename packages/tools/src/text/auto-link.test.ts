import { describe, expect, it } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { autoLinkBefore, autoLinkPasted, urlBefore, urlInWord } from './auto-link.js';
import { createEditorState } from './editor-state.js';
import { setStyle } from './editor.js';
import { pasteInto } from './session-clipboard.js';
import { replaceText } from './session-edits.js';
import { TextEditingSession } from './text-session.js';

/**
 * A URL a whole string holds, read by `urlInWord`.
 *
 * @param word - The word.
 * @returns What it finds.
 */
function urlOf(word: string): ReturnType<typeof urlInWord> {
  return urlInWord(word, 0, word.length);
}

describe('urlInWord', () => {
  it.each([
    ['https://example.com/guide', 'https://example.com/guide'],
    ['HTTP://Example.com', 'http://example.com/'],
    ['mailto:ada@example.com', 'mailto:ada@example.com'],
    ['www.example.com/a', 'https://www.example.com/a'],
  ])('reads %j as the link %j', (word, link) => {
    expect(urlOf(word)).toEqual({ start: 0, end: word.length, link });
  });

  it('leaves out the punctuation around a URL', () => {
    const text = '("https://example.com/a").';
    expect(urlOf(text)).toEqual({ start: 2, end: 23, link: 'https://example.com/a' });
  });

  it('keeps a closing parenthesis the URL opened', () => {
    const text = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    expect(urlOf(text)).toMatchObject({ start: 0, end: text.length });
    expect(urlOf(`(${text})`)).toMatchObject({ start: 1, end: text.length + 1 });
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'file:///etc/passwd',
    'https://user:secret@example.com/',
    'mailto:ada@example.com?bcc=eve@example.com',
    'example.com',
    'http://',
    'https://',
  ])('never links %j', (word) => {
    expect(urlOf(word)).toBeUndefined();
  });

  it('finds nothing in an empty word', () => {
    expect(urlInWord('...', 0, 3)).toBeUndefined();
  });
});

describe('urlBefore', () => {
  it('reads the word back to the previous whitespace', () => {
    const text = 'See https://example.com/a now';
    expect(urlBefore(text, 25)).toEqual({ start: 4, end: 25, link: 'https://example.com/a' });
  });

  it('finds nothing right after whitespace or at the start', () => {
    expect(urlBefore('a  b', 2)).toBeUndefined();
    expect(urlBefore('', 0)).toBeUndefined();
  });
});

describe('autoLinkBefore', () => {
  it('links the URL before a typed space, keeping caret, selection and pending style', () => {
    const text = 'See https://example.com ';
    const state = { ...createEditorState(text, [{ length: text.length, style: TEN }]) };
    const pending = { ...state, pending: { weight: 700 as const } };
    const next = autoLinkBefore(pending, text.length - 1);
    expect(next?.runs).toEqual([
      { length: 4, style: TEN },
      { length: 19, style: { ...TEN, link: 'https://example.com/' } },
      { length: 1, style: TEN },
    ]);
    expect(next?.caret).toBe(text.length);
    expect(next?.anchor).toBe(text.length);
    expect(next?.pending).toEqual({ weight: 700 });
  });

  it('leaves a URL that already carries a link alone', () => {
    const text = 'https://example.com/a ';
    const runs = [
      { length: 21, style: { ...TEN, link: 'https://example.com/other' } },
      { length: 1, style: TEN },
    ];
    expect(autoLinkBefore(createEditorState(text, runs), 21)).toBeUndefined();
  });

  it('does nothing after a word that is no URL', () => {
    const text = 'javascript:alert(1) ';
    expect(
      autoLinkBefore(createEditorState(text, [{ length: text.length, style: TEN }]), 19),
    ).toBeUndefined();
  });
});

describe('autoLinkPasted', () => {
  const state = (text: string) => createEditorState(text, [{ length: text.length, style: TEN }]);

  it('links pasted text that is one URL, less its surrounding whitespace', () => {
    const next = autoLinkPasted(state('Go https://example.com/x \n'), 2, 26);
    expect(next?.runs).toEqual([
      { length: 3, style: TEN },
      { length: 21, style: { ...TEN, link: 'https://example.com/x' } },
      { length: 2, style: TEN },
    ]);
  });

  it.each([
    ['two words', 'see https://example.com/x'],
    ['punctuation outside the URL', 'https://example.com/x.'],
    ['an unsafe scheme', 'javascript:alert(1)'],
    ['only whitespace', '   '],
  ])('leaves %s unlinked', (ignored, text) => {
    expect(autoLinkPasted(state(text), 0, text.length)).toBeUndefined();
  });

  it('leaves a pasted URL that already carries a link alone', () => {
    const text = 'https://example.com/x';
    const runs = [{ length: text.length, style: { ...TEN, link: 'https://example.com/y' } }];
    expect(autoLinkPasted(createEditorState(text, runs), 0, text.length)).toBeUndefined();
  });
});

/**
 * An editing session on a ten-point text, caret at the end.
 *
 * @param text - Its characters.
 * @returns The session, what it records and the stored object.
 */
function editing(text: string) {
  const object = tenPointText('t', text);
  const fixture = createTextModeContext([object]);
  const session = new TextEditingSession(fixture.context, object, text.length);
  const read = (): TextObject => fixture.store.get('t' as ObjectId) as TextObject;
  return { ...fixture, session, read };
}

describe('auto-link in an editing session', () => {
  it('links a typed URL on a space, in an undo step after the typing step', () => {
    const { session, read, record } = editing('see https://example.com/a');
    session.type(' ');
    expect(read().runs).toEqual([
      { length: 4, style: TEN },
      { length: 21, style: { ...TEN, link: 'https://example.com/a' } },
      { length: 1, style: TEN },
    ]);
    expect(record.capture.slice(-2)).toEqual([expect.stringMatching(/^typing:/u), 'command']);
  });

  it('links a typed URL on Enter', () => {
    const { session, read } = editing('www.example.com');
    session.type('\n');
    expect(read().text).toBe('www.example.com\n');
    expect(read().runs[0]).toEqual({
      length: 15,
      style: { ...TEN, link: 'https://www.example.com/' },
    });
  });

  it('types a space after other words as before, one typing step', () => {
    const { session, read, record } = editing('javascript:alert(1)');
    session.type(' ');
    expect(read().runs.some((run) => run.style.link !== undefined)).toBe(false);
    expect(record.capture.filter((entry) => entry === 'command')).toHaveLength(0);
  });

  it('links a URL when the hidden input types the space (replaceText)', () => {
    const { session, read } = editing('https://example.com/b');
    replaceText(session, 21, 21, ' ');
    expect(read().runs[0]).toEqual({
      length: 21,
      style: { ...TEN, link: 'https://example.com/b' },
    });
  });

  it('inserts a URL pasted at a caret, then links it as its own step', () => {
    const { session, read, record } = editing('Go ');
    pasteInto(session, 'https://example.com/');
    expect(read().text).toBe('Go https://example.com/');
    expect(read().runs).toEqual([
      { length: 3, style: TEN },
      { length: 20, style: { ...TEN, link: 'https://example.com/' } },
    ]);
    expect(record.capture.filter((entry) => entry === 'command')).toHaveLength(2);
  });

  it('inserts pasted text that is no URL as before, one step', () => {
    const { session, read, record } = editing('Go ');
    pasteInto(session, 'data:text/html,hi');
    expect(read().runs.some((run) => run.style.link !== undefined)).toBe(false);
    expect(record.capture.filter((entry) => entry === 'command')).toHaveLength(1);
  });
});

describe('a link edited from a caret inside it', () => {
  const link = 'https://example.com/a';
  const runs = [
    { length: 3, style: TEN },
    { length: 4, style: { ...TEN, link } },
    { length: 3, style: TEN },
  ];
  const at = (caret: number) => createEditorState('Go link ok', runs, caret);

  it('changes the whole link, the caret where it was', () => {
    const next = setStyle(at(5), { link: 'https://example.com/b' });
    expect(next.runs[1]).toEqual({ length: 4, style: { ...TEN, link: 'https://example.com/b' } });
    expect([next.anchor, next.caret]).toEqual([5, 5]);
  });

  it('removes the whole link', () => {
    expect(setStyle(at(4), { link: null }).runs).toEqual([{ length: 10, style: TEN }]);
  });

  it.each([3, 7])('sets the next characters typed at the link edge %i, as before', (caret) => {
    const next = setStyle(at(caret), { link: 'https://example.com/b' });
    expect(next.runs).toBe(runs);
    expect(next.pending).toEqual({ link: 'https://example.com/b' });
  });

  it('keeps other fields at a caret inside a link pending, as before', () => {
    const next = setStyle(at(5), { weight: 700, link: null });
    expect(next.runs).toBe(runs);
    expect(next.pending).toEqual({ weight: 700, link: null });
  });
});
