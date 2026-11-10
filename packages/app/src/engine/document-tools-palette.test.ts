// The overlay in the editing states' colours: the shell's palette rides on every model
// the tools show, the text being edited is outlined in its `you`, and a theme change shows the
// overlay again.
import { describe, expect, it } from 'vitest';

import { createHistory } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';
import type { OverlayPalette, SelectionOverlayModel } from '@canvas/tools';

import { MONO_LAYOUT, TEXT_CAMERA } from './__fixtures__/text-document.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

const PALETTE: OverlayPalette = {
  you: [0.89, 0.66, 0.23, 1],
  guide: [0.88, 0.39, 0.35, 1],
  hover: [0.64, 0.64, 0.61, 1],
  locked: [0.42, 0.42, 0.4, 1],
};

function setUp() {
  const store = createDemoDocument();
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  let nextId = 1;
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: {
      clock: () => 1_790_000_000_000,
      createId: () => `text-${String(nextId++)}` as ObjectId,
    },
    onChange: () => undefined,
    textLayout: MONO_LAYOUT,
    creationInk: { theme: () => 'dark', overlayPalette: () => PALETTE },
  });
  const shown: SelectionOverlayModel[] = [];
  document.attach({
    enqueue: () => undefined,
    showOverlay: (model) => {
      shown.push(model);
    },
  });
  return { document, shown };
}

describe('DocumentTools: the overlay palette', () => {
  it('sends the palette with every overlay, and shows it again on refresh', () => {
    const { document, shown } = setUp();
    expect(shown.at(-1)?.palette).toBe(PALETTE);
    const count = shown.length;
    document.tools.refresh();
    expect(shown).toHaveLength(count + 1);
    expect(shown.at(-1)?.palette).toBe(PALETTE);
  });

  it('outlines the text being edited in the palette’s you', () => {
    const { document, shown } = setUp();
    document.setActiveTool('text');
    for (const kind of ['pointerDown', 'pointerUp'] as const) {
      document.handlePointer(
        { kind, screen: { x: 20, y: 20 }, isShiftPressed: false, isModPressed: false },
        TEXT_CAMERA,
      );
    }
    document.tools.text.session()?.type('Hi');
    const outline = shown.at(-1)?.toolRects.slice(0, 4) ?? [];
    expect(outline).toHaveLength(4);
    expect(outline.every(({ color }) => color === PALETTE.you)).toBe(true);
  });
});
