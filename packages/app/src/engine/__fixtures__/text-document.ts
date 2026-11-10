// The engine's document side over the demo document with a monospaced fake text layout, for the
// text tests in Node and jsdom (no fonts there). Text in Chrome, with the page's fonts:
// tooling/scenario/specs/tools/text-*.spec.ts.
import { vi } from 'vitest';

import { createHistory } from '@canvas/document';
import { layoutText, type Camera, type GlyphMeasurer } from '@canvas/engine';
import {
  objectToBoardTransform,
  type Board,
  type BoardObject,
  type ObjectId,
  type TextObject,
} from '@canvas/schema';
import type { TextLayoutService } from '@canvas/tools';

import { createDemoDocument, LOCAL_USER_ORIGIN } from '../demo-document.js';
import { EngineDocument } from '../engine-document.js';
import type { ScreenPointerInput } from '../select-input-binding.js';
import { TYPING_CAPTURE_WINDOW_MS } from '../typing-undo-policy.js';

/** The origin at 100% in an 800 × 600 view: screen px are world units. */
export const TEXT_CAMERA: Camera = {
  x: 0,
  y: 0,
  zoom: 1,
  viewportWidthPx: 800,
  viewportHeightPx: 600,
  dpr: 1,
};

/** Every character 0.6 em wide: 24 px text is 14.4 px a character. */
export const MONO: GlyphMeasurer = {
  faceIdOf: (style) => `${style.fontFamily}-${String(style.weight)}-${String(style.italic)}`,
  advance: () => 0.6,
  kerning: () => 0,
  lineMetrics: () => ({ ascent: 0.8, descent: 0.2 }),
};

/** The page's layout with {@link MONO}. */
export const MONO_LAYOUT: TextLayoutService = {
  layout: ({ text, runs, wrapWidth, align, paragraphs }) =>
    layoutText(text, runs, wrapWidth, MONO, align, 'auto', paragraphs),
};

/**
 * The document side with the monospaced layout, ids `text-1`, `text-2`… and the typing capture
 * window, attached to a view that draws nothing.
 *
 * @param textLayout - The page's layout; the monospaced one by default.
 * @returns The store, history, document side, a press at a screen point, a text reader and the
 *   tool-change spy.
 */
export function setUpTextDocument(textLayout: TextLayoutService = MONO_LAYOUT) {
  const store = createDemoDocument();
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId, {
    captureTimeout: TYPING_CAPTURE_WINDOW_MS,
  });
  let nextId = 1;
  const onToolChange = vi.fn();
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: {
      clock: () => 1_790_000_000_000,
      createId: () => `text-${String(nextId++)}` as ObjectId,
    },
    onChange: () => undefined,
    onToolChange,
    textLayout,
  });
  document.attach({ enqueue: () => undefined, showOverlay: () => undefined });
  const press = (kind: 'pointerDown' | 'pointerUp', x: number, y: number, timeStamp = 0) => {
    const input: ScreenPointerInput = {
      kind,
      screen: { x, y },
      isShiftPressed: false,
      isModPressed: false,
      timeStamp,
    };
    document.handlePointer(input, TEXT_CAMERA);
  };
  const text = (id: string): TextObject => {
    const object = store.get(id as ObjectId);
    if (object?.type !== 'text') throw new Error(`${id} is not text`);
    return object;
  };
  return { store, history, document, press, text, onToolChange };
}

/**
 * Where an object is on the board, whatever its parent (item 9: one drawn on a demo
 * section joins it, its stored position then in the section's frame).
 *
 * @param store - The store.
 * @param store.read - Reads the board.
 * @param object - The object.
 * @returns Its board x and y.
 */
export function onBoard(
  store: { readonly read: () => Board },
  object: BoardObject | undefined,
): readonly [number | undefined, number | undefined] {
  const at = object && objectToBoardTransform(store.read(), object);
  return [at?.x, at?.y];
}
