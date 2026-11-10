// Written before the code. CONTRACT: mod-press on a linked editing character leaves the caret and selection, for the app's genuine-click gate to open the link; an unlinked press still places it. Deliberately not asserted: window.open or app wiring.
import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createTextModeContext, TEN, tenPointText } from './__fixtures__/text-mode-context.js';
import { TextMode } from './text-mode.js';

const LINK = 'https://example.com/guide';

function fixture() {
  const object = tenPointText('t', 'abc', {
    runs: [
      { length: 1, style: TEN },
      { length: 1, style: { ...TEN, link: LINK } },
      { length: 1, style: TEN },
    ],
  });
  const { context } = createTextModeContext([object]);
  const mode = new TextMode(context, { kind: 'edit', id: 't' as ObjectId });
  const press = (x: number) =>
    mode.onPointer({
      kind: 'pointerDown',
      screen: { x, y: 5 },
      world: { x, y: 5 },
      zoom: 1,
      isShiftPressed: false,
      isModPressed: true,
    });
  return { mode, press };
}

describe('TextMode mod-press', () => {
  it('leaves the selection as it was on a linked character, opening nothing itself', () => {
    const { mode, press } = fixture();
    const before = mode.session?.editor;
    press(9);
    expect(mode.session?.editor).toEqual(before);
  });

  it('places the caret as before when the character has no link', () => {
    const { mode, press } = fixture();
    press(2);
    expect(mode.session?.editor).toMatchObject({ caret: 0, anchor: 0 });
  });
});
