import { expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import { createTextModeContext, tenPointText } from './__fixtures__/text-mode-context.js';
import { TextMode } from './text-mode.js';

/**
 * A primary-button input at a world point, the camera at the origin at 100%.
 *
 * @param kind - Down, move or up.
 * @param x - World x, and CSS px.
 * @param y - World y.
 * @param options - Shift and the time.
 * @param options.isShiftPressed - Whether Shift is held.
 * @param options.timeStamp - When, ms.
 * @returns The input.
 */
function at(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp',
  x: number,
  y: number,
  options: { readonly isShiftPressed?: boolean; readonly timeStamp?: number } = {},
): ToolPointerInput {
  return {
    kind,
    screen: { x, y },
    world: { x, y },
    isShiftPressed: options.isShiftPressed ?? false,
    isModPressed: false,
    zoom: 1,
    ...(options.timeStamp === undefined ? {} : { timeStamp: options.timeStamp }),
  };
}

it('asks before entering unavailable-font text from activation or a text-tool click', () => {
  const { store, context } = createTextModeContext([tenPointText('t', 'private words')]);
  const guarded = { ...context, canEditText: () => false };
  const direct = new TextMode(guarded, { kind: 'edit', id: 't' as ObjectId });
  expect(direct.session).toBeUndefined();
  const click = new TextMode(guarded, { kind: 'create' });
  click.onPointer(at('pointerDown', 2, 2));
  click.onPointer(at('pointerUp', 2, 2));
  expect(click.session).toBeUndefined();
  expect(store.get('t' as ObjectId)).toMatchObject({ text: 'private words' });
  direct.exit();
  click.exit();
  store.destroy();
});

it('blocks word changes after a font becomes missing while keeping style changes available', () => {
  const { store, context } = createTextModeContext([tenPointText('t', 'private words')]);
  let canEdit = true;
  const mode = new TextMode(
    { ...context, canEditText: () => canEdit },
    { kind: 'edit', id: 't' as ObjectId },
  );
  canEdit = false;
  mode.session?.type('lost words');
  expect(store.get('t' as ObjectId)).toMatchObject({ text: 'private words' });
  mode.session?.setStyle({ fontSize: 32 });
  expect(mode.session?.editor.runs[0]?.style.fontSize).toBe(32);
  mode.exit();
  store.destroy();
});
