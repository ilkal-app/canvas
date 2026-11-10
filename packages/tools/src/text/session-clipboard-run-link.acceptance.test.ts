// Written before the code. CONTRACT: a plain URL pasted onto a range links that unchanged range in one command; other pastes retain their insert behavior. Deliberately not asserted: browser clipboard permissions.
import { describe, expect, it } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { pasteInto } from './session-clipboard.js';
import { TextEditingSession } from './text-session.js';

function selected(text = 'Read now') {
  const object = tenPointText('t', text);
  const fixture = createTextModeContext([object]);
  const session = new TextEditingSession(fixture.context, object, text.length);
  session.selectAll();
  const read = (): TextObject => fixture.store.get('t' as ObjectId) as TextObject;
  return { ...fixture, session, read };
}

describe('paste link acceptance', () => {
  it('normalizes a trimmed URL onto selected text without replacing it', () => {
    const { session, read, record } = selected();
    pasteInto(session, '  HTTPS://Example.com/now  ');
    expect(read().text).toBe('Read now');
    expect(read().runs).toEqual([
      { length: 8, style: { ...TEN, link: 'https://example.com/now' } },
    ]);
    expect(record.capture.filter((entry) => entry === 'command')).toHaveLength(1);
  });

  it.each(['not a link', 'javascript:alert(1)'])(
    'inserts invalid URL text %j as before',
    (text) => {
      const { session, read, record } = selected();
      pasteInto(session, text);
      expect(read().text).toBe(text);
      expect(read().runs.some((run) => run.style.link !== undefined)).toBe(false);
      expect(record.capture.filter((entry) => entry === 'command')).toHaveLength(1);
    },
  );

  it('inserts a URL at a collapsed caret instead of linking existing text', () => {
    const object = tenPointText('t', 'Go');
    const { context, store } = createTextModeContext([object]);
    const session = new TextEditingSession(context, object, 2);
    pasteInto(session, 'https://example.com/');
    const result = store.get(object.id) as TextObject;
    expect(result.text).toBe('Gohttps://example.com/');
    // (): the pasted URL itself is linked; the existing text is not.
    expect(result.runs).toEqual([
      { length: 2, style: TEN },
      { length: 20, style: { ...TEN, link: 'https://example.com/' } },
    ]);
  });

  it('keeps a runs-flavour paste as a replacement with its own run style', () => {
    const { session, read } = selected();
    pasteInto(session, {
      text: 'Hi',
      runs: [{ length: 2, style: { ...TEN, link: 'https://example.com/other' } }],
    });
    expect(read()).toMatchObject({
      text: 'Hi',
      runs: [{ length: 2, style: { ...TEN, link: 'https://example.com/other' } }],
    });
  });
});
