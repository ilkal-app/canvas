import { describe, expect, it } from 'vitest';

import { createEditorState } from '@canvas/tools';

import { textKeyActionOf } from './text-keys.js';

/**
 * A key as the editor sees it.
 *
 * @param key - The key.
 * @param modifiers - Which modifiers are held.
 * @returns The event fields.
 */
function key(
  key: string,
  modifiers: Partial<
    Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing', boolean>
  > = {},
) {
  return {
    key,
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    ...modifiers,
  };
}

describe('textKeyActionOf', () => {
  it('moves by character, extends with Shift, and by word with Alt or Ctrl', () => {
    expect(textKeyActionOf(key('ArrowLeft'), 'other')).toEqual({
      kind: 'move',
      motion: { unit: 'character', direction: -1, isExtending: false },
    });
    expect(textKeyActionOf(key('ArrowRight', { shiftKey: true }), 'mac')).toEqual({
      kind: 'move',
      motion: { unit: 'character', direction: 1, isExtending: true },
    });
    expect(textKeyActionOf(key('ArrowLeft', { altKey: true }), 'mac')).toMatchObject({
      motion: { unit: 'word' },
    });
    expect(textKeyActionOf(key('ArrowRight', { ctrlKey: true }), 'other')).toMatchObject({
      motion: { unit: 'word', direction: 1 },
    });
  });

  it('goes to line edges with Home, End and ⌘ arrows, lines and text edges up and down', () => {
    expect(textKeyActionOf(key('Home'), 'other')).toMatchObject({
      motion: { unit: 'lineEdge', direction: -1 },
    });
    expect(textKeyActionOf(key('End', { shiftKey: true }), 'other')).toMatchObject({
      motion: { unit: 'lineEdge', direction: 1, isExtending: true },
    });
    expect(textKeyActionOf(key('ArrowLeft', { metaKey: true }), 'mac')).toMatchObject({
      motion: { unit: 'lineEdge', direction: -1 },
    });
    expect(textKeyActionOf(key('ArrowUp'), 'mac')).toMatchObject({
      motion: { unit: 'line', direction: -1 },
    });
    expect(textKeyActionOf(key('ArrowDown', { metaKey: true }), 'mac')).toMatchObject({
      motion: { unit: 'textEdge', direction: 1 },
    });
  });

  it('maps mod shortcuts: select all, bold, italic, undo and redo; Escape', () => {
    expect(textKeyActionOf(key('a', { metaKey: true }), 'mac')).toEqual({ kind: 'selectAll' });
    expect(textKeyActionOf(key('b', { ctrlKey: true }), 'other')).toEqual({ kind: 'toggleBold' });
    expect(textKeyActionOf(key('I', { metaKey: true, shiftKey: true }), 'mac')).toEqual({
      kind: 'toggleItalic',
    });
    expect(textKeyActionOf(key('z', { metaKey: true }), 'mac')).toEqual({ kind: 'undo' });
    expect(textKeyActionOf(key('z', { metaKey: true, shiftKey: true }), 'mac')).toEqual({
      kind: 'redo',
    });
    expect(textKeyActionOf(key('y', { ctrlKey: true }), 'other')).toEqual({ kind: 'redo' });
    expect(textKeyActionOf(key('y', { metaKey: true }), 'mac')).toBeUndefined();
    expect(textKeyActionOf(key('Escape'), 'mac')).toEqual({ kind: 'escape' });
  });

  it('leaves typing, other shortcuts and keys an input method is composing with alone', () => {
    expect(textKeyActionOf(key('a'), 'mac')).toBeUndefined();
    expect(textKeyActionOf(key('b', { ctrlKey: true }), 'mac')).toBeUndefined();
    expect(textKeyActionOf(key('q', { metaKey: true }), 'mac')).toBeUndefined();
    expect(textKeyActionOf(key('ArrowLeft', { isComposing: true }), 'mac')).toBeUndefined();
    expect(textKeyActionOf(key('Process'), 'mac')).toBeUndefined();
  });

  it('leaves Safari’s key that ends a composition alone, which comes with keyCode 229', () => {
    expect(textKeyActionOf({ ...key('Escape'), keyCode: 229 }, 'mac')).toBeUndefined();
    expect(textKeyActionOf({ ...key('ArrowLeft'), keyCode: 229 }, 'mac')).toBeUndefined();
    expect(textKeyActionOf({ ...key('Escape'), keyCode: 27 }, 'mac')).toEqual({ kind: 'escape' });
  });

  it('hands mod+u and mod+shift+x on as underline and strikethrough, leaving mod+x to cut', () => {
    expect(textKeyActionOf(key('u', { metaKey: true }), 'mac')).toEqual({
      kind: 'toggleUnderline',
    });
    expect(textKeyActionOf(key('X', { ctrlKey: true, shiftKey: true }), 'other')).toEqual({
      kind: 'toggleStrikethrough',
    });
    expect(textKeyActionOf(key('x', { metaKey: true }), 'mac')).toBeUndefined();
  });

  it('reads Tab and Shift+Tab as a list level only inside a list, not with mod or Alt', () => {
    const runs = [
      {
        length: 1,
        style: { fontFamily: 'Inter', fontSize: 10, color: 'ink', weight: 400, italic: false },
      },
    ] as const;
    const listed = createEditorState('a', runs, 0, [{ list: 'bullet' }]);
    const plain = createEditorState('a', runs, 0);
    expect(textKeyActionOf(key('Tab'), 'mac', listed)).toEqual({ kind: 'indentList' });
    expect(textKeyActionOf(key('Tab', { shiftKey: true }), 'other', listed)).toEqual({
      kind: 'outdentList',
    });
    expect(textKeyActionOf(key('Tab'), 'mac', plain)).toBeUndefined();
    expect(textKeyActionOf(key('Tab'), 'mac')).toBeUndefined();
    expect(textKeyActionOf(key('Tab', { altKey: true }), 'mac', listed)).toBeUndefined();
    expect(textKeyActionOf(key('Tab', { ctrlKey: true }), 'other', listed)).toBeUndefined();
  });
});
