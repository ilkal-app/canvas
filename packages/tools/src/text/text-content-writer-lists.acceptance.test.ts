import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { toggleList } from './editor.js';
import { TextEditingSession } from './text-session.js';

it('writes a session list edit with its text and runs to the store', async () => {
  const object = tenPointText('text', 'item');
  const { store, context } = createTextModeContext([object]);
  const session = new TextEditingSession(context, object, 2);
  session.apply(toggleList(session.editor, 'bullet'), 'command');
  await Promise.resolve();
  const stored = store.get('text' as ObjectId);
  expect(stored).toMatchObject({ text: 'item', runs: object.runs });
  if (stored?.type !== 'text') throw new Error('text is not a text object');
  expect(stored.paragraphs).toEqual([{ list: 'bullet' }]);
  store.destroy();
});
