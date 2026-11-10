import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { TextMode } from './text-mode.js';

// The text mode ended for a person made a viewer mid-edit: nothing is written.

describe('TextMode.abandon', () => {
  it('writes nothing: an emptied text box stays, where ending as usual deletes it', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'hello')]);
    const mode = new TextMode(context, {
      kind: 'edit',
      id: 't' as ObjectId,
      world: { x: 1, y: 5 },
    });
    mode.session?.selectAll();
    mode.session?.deleteBackward();
    const before = store.read();
    mode.abandon();
    mode.abandon();
    mode.exit();
    expect(store.read()).toBe(before);
    expect(store.get('t' as ObjectId)).toMatchObject({ text: '' });
    const ending = createTextModeContext([tenPointText('t', 'hello')]);
    const ended = new TextMode(ending.context, {
      kind: 'edit',
      id: 't' as ObjectId,
      world: { x: 1, y: 5 },
    });
    ended.session?.selectAll();
    ended.session?.deleteBackward();
    ended.exit();
    expect(ending.store.get('t' as ObjectId)).toBeUndefined();
  });
});
