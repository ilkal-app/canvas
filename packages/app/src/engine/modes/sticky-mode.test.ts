// The sticky tool's registration: activating a sticky note edits its text, unless it is locked.
// A double-click in Chrome: tooling/scenario/specs/tools/sticky-*.
import { describe, expect, it } from 'vitest';

import { createHistory } from '@canvas/document';
import type { Camera } from '@canvas/engine';
import type { ObjectId } from '@canvas/schema';
import { StickyMode } from '@canvas/tools';

import { createDemoDocument, LOCAL_USER_ORIGIN } from '../demo-document.js';
import { EngineDocument } from '../engine-document.js';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600, dpr: 1 };
const NOTE = 'new' as ObjectId;

/**
 * The demo document with a sticky note a click of the sticky tool made, typed in and left.
 *
 * @returns The store and the document side, the note selected with the select tool.
 */
function setUp() {
  const store = createDemoDocument();
  const document = new EngineDocument({
    store,
    history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => NOTE },
    onChange: () => undefined,
  });
  document.setActiveTool('sticky');
  for (const kind of ['pointerDown', 'pointerUp'] as const) {
    document.handlePointer(
      { kind, screen: { x: 1500, y: 1500 }, isShiftPressed: false, isModPressed: false },
      CAMERA,
    );
  }
  document.tools.text.session()?.type('Hi');
  document.setActiveTool('select');
  document.selectTool.select([NOTE]);
  return { store, document };
}

describe('the sticky tool’s activation', () => {
  it('edits the activated note’s text in the sticky mode', () => {
    const { store, document } = setUp();
    expect(store.get(NOTE)).toMatchObject({ type: 'sticky', text: 'Hi' });
    expect(document.inspect().textEditing).toBeUndefined();

    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);

    expect(document.tools.router.activeMode).toBeInstanceOf(StickyMode);
    expect(document.inspect().textEditing).toMatchObject({ id: NOTE, text: 'Hi' });
  });

  it('leaves a locked note alone', () => {
    const { store, document } = setUp();
    store.transact(LOCAL_USER_ORIGIN, (transaction) => {
      transaction.patchObject(NOTE, { locked: true });
    });

    document.runCanvasAction({ type: 'selection', command: 'activate' }, 1);

    expect(document.tools.router.activeMode).not.toBeInstanceOf(StickyMode);
    expect(document.inspect().textEditing).toBeUndefined();
  });
});
