// The tools over a page with no fonts: with no text layout service given, nothing lays out, and a
// new text box falls back to a line height worked out from its font size.
import { describe, expect, it } from 'vitest';

import { createHistory } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import { TEXT_CAMERA } from './__fixtures__/text-document.js';
import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

describe('DocumentTools with no text layout', () => {
  it('lays out nothing, and sizes a new text box from its font size', () => {
    const store = createDemoDocument();
    const document = new EngineDocument({
      store,
      history: createHistory(store, LOCAL_USER_ORIGIN.principalId),
      origin: LOCAL_USER_ORIGIN,
      environment: { clock: () => 1_790_000_000_000, createId: () => 'text-1' as ObjectId },
      onChange: () => undefined,
    });
    document.setActiveTool('text');
    for (const kind of ['pointerDown', 'pointerUp'] as const) {
      document.handlePointer(
        { kind, screen: { x: 20, y: 20 }, isShiftPressed: false, isModPressed: false },
        TEXT_CAMERA,
      );
    }
    const session = document.tools.text.session();
    expect(session?.layout()).toBeUndefined();
    const draft = session?.object();
    if (draft?.type !== 'text') throw new Error('the text tool drafts a text object');
    const fontSize = draft.runs[0]?.style.fontSize ?? Number.NaN;
    expect(fontSize).toBeGreaterThan(0);
    expect(draft.height).toBe(fontSize * 1.25);
  });
});
