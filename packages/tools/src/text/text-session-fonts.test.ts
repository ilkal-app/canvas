// An editing session on a page whose fonts have not loaded yet: nothing is written with a size
// measured without them.
import { describe, expect, it } from 'vitest';

import type { ObjectId, TextObject } from '@canvas/schema';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import type { TextModeContext } from './text-mode-context.js';
import { draftTextObject } from './text-session-object.js';
import { TextEditingSession } from './text-session.js';

/**
 * A context whose page layout answers only once `fontsLand` is called, recording the texts it
 * is told were written unmeasured.
 *
 * @param objects - What the store starts with.
 * @returns The fixture, the context, the unmeasured ids and the switch.
 */
function fontlessContext(objects: readonly TextObject[] = []) {
  const fixture = createTextModeContext(objects);
  let hasFonts = false;
  const unmeasured: ObjectId[] = [];
  const context: TextModeContext = {
    ...fixture.context,
    layout: { layout: (input) => (hasFonts ? fixture.context.layout.layout(input) : undefined) },
    onWrittenUnmeasured: (id) => unmeasured.push(id),
  };
  const fontsLand = () => {
    hasFonts = true;
  };
  return { ...fixture, context, unmeasured, fontsLand };
}

/**
 * A text tool session on a new, empty box at the origin.
 *
 * @param context - The context.
 * @returns The session.
 */
function newBoxSession(context: TextModeContext): TextEditingSession {
  const draft = draftTextObject(context, {
    ...tenPointText('unused', ''),
    width: 1,
    height: 12.5,
    runs: [{ length: 0, style: TEN }],
  });
  return new TextEditingSession(context, draft, 0, true);
}

describe('a text session before the page’s fonts load', () => {
  it('holds a new box’s first write, then creates it measured in the typing step once they land', () => {
    const { context, store, record, unmeasured, fontsLand } = fontlessContext();
    const session = newBoxSession(context);
    session.type('a');
    session.type('b');
    expect(store.get(session.id)).toBeUndefined();
    expect(session.object()).toMatchObject({ text: 'ab' });
    expect(session.editor.text).toBe('ab');
    fontsLand();
    const steps = record.capture.length;
    session.writeHeld();
    expect(record.capture.slice(steps)).toEqual([`typing:${String(session.sessionId)}:false`]);
    expect(store.get(session.id)).toMatchObject({ text: 'ab', width: 12, height: 12.5 });
    expect(unmeasured).toEqual([]);
    session.writeHeld();
    expect(record.capture).toHaveLength(steps + 1);
  });

  it('creates held text when the session ends before the fonts, and reports it unmeasured', () => {
    const { context, store, record, unmeasured } = fontlessContext();
    const session = newBoxSession(context);
    session.type('ab');
    session.end();
    expect(store.get(session.id)).toMatchObject({ text: 'ab', width: 1 });
    expect(unmeasured).toEqual([session.id]);
    expect(record.capture.slice(-2)).toEqual([
      `typing:${String(session.sessionId)}:true`,
      'endStep',
    ]);
    session.writeHeld();
    expect(record.capture.at(-1)).toBe('endStep');
  });

  it('writes existing text without a size, reported unmeasured, and writes nothing held', () => {
    const object = tenPointText('t', 'ab');
    const { context, store, unmeasured } = fontlessContext([object]);
    const session = new TextEditingSession(context, object, 2);
    session.type('c');
    expect(store.get('t' as ObjectId)).toMatchObject({ text: 'abc', width: object.width });
    expect(unmeasured).toEqual(['t']);
    session.end();
    expect(unmeasured).toEqual(['t']);
  });

  it('writes an empty new box nothing, fonts or not', () => {
    const { context, store, unmeasured } = fontlessContext();
    const session = newBoxSession(context);
    session.writeHeld();
    session.end();
    expect(store.read().objects.size).toBe(0);
    expect(unmeasured).toEqual([]);
  });
});
