import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { TextEditingSession } from './text-session.js';

const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

it('keeps an unedited replacement pending until the preceding held write lands', async () => {
  const object = tenPointText('text', 'old');
  const { store, context } = createTextModeContext([object]);
  const run = store.beginRun();
  const first = new TextEditingSession(context, object, 3);
  first.type('a');
  first.end();
  const second = new TextEditingSession(context, object, 4);
  expect(second.editor.text).toBe('olda');
  second.end();
  const third = new TextEditingSession(context, object, 4);
  expect(third.editor.text).toBe('olda');
  third.type('c');
  third.end();
  run.close();
  await flush();
  expect(store.get(object.id)).toMatchObject({ text: 'oldac' });
  store.destroy();
});

it('deletes an emptied box after its unedited held-run replacement ends', async () => {
  const object = tenPointText('text', 'a');
  const { store, context } = createTextModeContext([object]);
  const run = store.beginRun();
  const first = new TextEditingSession(context, object, 1);
  first.deleteBackward();
  first.end();
  const second = new TextEditingSession(context, object, 0);
  expect(second.editor.text).toBe('');
  second.end();
  run.close();
  await flush();
  expect(store.get(object.id)).toBeUndefined();
  store.destroy();
});

it('starts a third held session without the discarded replacement edit', async () => {
  const object = tenPointText('text', 'old');
  const { store, context } = createTextModeContext([object]);
  const run = store.beginRun();
  const first = new TextEditingSession(context, object, 3);
  first.type('a');
  first.end();
  const second = new TextEditingSession(context, object, 4);
  second.type('b');
  second.end(false);
  const third = new TextEditingSession(context, object, 4);
  expect(third.editor.text).toBe('olda');
  third.type('c');
  third.end();
  run.close();
  await flush();
  expect(store.get(object.id)).toMatchObject({ text: 'oldac' });
  store.destroy();
});

type Step = 'begin' | 'close' | 'open' | 'type' | 'end' | 'discard' | 'idle';

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

it('preserves exactly the written and non-discarded characters across seeded session chains', async () => {
  for (let seed = 1; seed <= 300; seed++) {
    const object = tenPointText('text', 'old');
    const { store, context } = createTextModeContext([object]);
    const next = random(seed);
    const steps: string[] = [];
    const characters: { value: string; session: number; isWritten: boolean }[] = [];
    let run: ReturnType<typeof store.beginRun> | undefined;
    let session: TextEditingSession | undefined;
    let sessionNumber = 0;
    let typedCount = 0;
    const settle = (): void => {
      for (const character of characters) character.isWritten = true;
    };

    for (let index = 0; index < 35; index++) {
      const choices: Step[] = ['idle'];
      if (run === undefined) choices.push('begin');
      else choices.push('close');
      if (session === undefined) choices.push('open');
      else choices.push('type', 'end', 'discard');
      const step = choices[next() % choices.length] ?? 'idle';
      if (step === 'begin') run = store.beginRun();
      else if (step === 'close') {
        run?.close();
        run = undefined;
      } else if (step === 'open') {
        if (run === undefined) settle();
        session = new TextEditingSession(
          context,
          store.get(object.id) as typeof object,
          3 + characters.length,
        );
        sessionNumber++;
      } else if (step === 'type') {
        const value = String.fromCharCode(0x100 + typedCount++);
        if (run === undefined) settle();
        session?.type(value);
        characters.push({ value, session: sessionNumber, isWritten: run === undefined });
        steps.push(`type ${JSON.stringify(value)}`);
        continue;
      } else if (step === 'end' || step === 'discard') {
        session?.end(step === 'end');
        if (step === 'discard') {
          for (let position = characters.length - 1; position >= 0; position--) {
            const character = characters[position];
            if (character?.session === sessionNumber && !character.isWritten)
              characters.splice(position, 1);
          }
        }
        session = undefined;
      } else {
        await flush();
        if (run === undefined) settle();
      }
      steps.push(step);
    }
    session?.end();
    run?.close();
    await flush();
    settle();
    const expected = `old${characters.map((character) => character.value).join('')}`;
    expect(
      store.get('text' as ObjectId),
      `seed ${String(seed)}: ${steps.join(' → ')}`,
    ).toMatchObject({
      text: expected,
    });
    store.destroy();
  }
}, 20_000);
