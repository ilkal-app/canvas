// Text on the engine's document side before the page's fonts load: nothing is written
// with a size measured without them, and what was written without them is measured once they
// land. The monospaced fake layout (__fixtures__/text-document.ts): 24 px text is 14.4 px a
// character, 30 px a line.
import { describe, expect, it } from 'vitest';

import type { ChangeSet } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';
import type { TextLayoutService } from '@canvas/tools';

import { MONO_LAYOUT, setUpTextDocument } from './__fixtures__/text-document.js';

/**
 * A page layout that answers only after `fontsLand`, which also settles `whenReady`.
 *
 * @returns The layout and the switch.
 */
function fontlessLayout() {
  let hasFonts = false;
  let settle: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const layout: TextLayoutService = {
    layout: (input) => (hasFonts ? MONO_LAYOUT.layout(input) : undefined),
    whenReady: () => ready,
  };
  const fontsLand = async () => {
    hasFonts = true;
    settle();
    await ready;
    // The follower writes after the listeners, in a microtask.
    await Promise.resolve();
    await Promise.resolve();
  };
  return { layout, fontsLand };
}

describe('DocumentText before the page’s fonts load', () => {
  it('creates a box typed into before the fonts once they land, measured, in the first word’s step', async () => {
    const { layout, fontsLand } = fontlessLayout();
    const { document, press, store, history } = setUpTextDocument(layout);
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('Hi');
    expect(store.get('text-1' as ObjectId)).toBeUndefined();
    await fontsLand();
    const created = store.get('text-1' as ObjectId) as {
      text: string;
      width: number;
      height: number;
    };
    expect(created.text).toBe('Hi');
    expect(created.width).toBeCloseTo(28.8, 6);
    expect(created.height).toBeCloseTo(30, 6);
    document.tools.text.session()?.type('!');
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    history.undo();
    expect(store.get('text-1' as ObjectId)).toBeUndefined();
  });

  it('measures a text written without the fonts once they land, as no one’s undo step', async () => {
    const { layout, fontsLand } = fontlessLayout();
    const { document, press, store, history } = setUpTextDocument(layout);
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('Hi');
    document.runCanvasAction({ type: 'selection', command: 'deselect' }, 1);
    expect(store.get('text-1' as ObjectId)).toMatchObject({ text: 'Hi', width: 1 });
    const written: ChangeSet[] = [];
    store.subscribe((changes) => written.push(changes));
    await fontsLand();
    expect((store.get('text-1' as ObjectId) as { width: number }).width).toBeCloseTo(28.8, 6);
    expect(written.map((changes) => changes.origin.kind)).toEqual(['system']);
    history.undo();
    expect(store.get('text-1' as ObjectId)).toBeUndefined();
  });

  it('does nothing when the fonts land after it was destroyed', async () => {
    const { layout, fontsLand } = fontlessLayout();
    const { document, press, store } = setUpTextDocument(layout);
    document.setActiveTool('text');
    press('pointerDown', 20, 20);
    press('pointerUp', 20, 20);
    document.tools.text.session()?.type('Hi');
    document.tools.text.destroy();
    await fontsLand();
    expect(store.get('text-1' as ObjectId)).toBeUndefined();
  });
});
