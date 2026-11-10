// Acceptance (Claude): a collaborator without a text's font cannot change its words by
// any path (typing, Backspace, Delete, a paste, an input-method commit, Enter) until an available
// family is chosen, while style-only changes still apply; the guard covers sticky notes and shape
// labels as well as text objects and is asked about the object itself; a host without the guard
// (the owner, whose font is installed) edits as before.
import { describe, expect, it, vi } from 'vitest';

import type { BoardObject, ObjectId, ShapeObject } from '@canvas/schema';

import type { ToolPointerInput } from '../modes/tool-mode.js';

import {
  ADA,
  createTextModeContext,
  TEN,
  tenPointNote,
  tenPointText,
} from './__fixtures__/text-mode-context.js';
import { insertText } from './editor.js';
import { TextMode } from './text-mode.js';

/**
 * A primary-button input at a world point, the camera at the origin at 100%.
 *
 * @param kind - Down or up.
 * @param x - World x, and CSS px.
 * @param y - World y.
 * @returns The input.
 */
function at(kind: 'pointerDown' | 'pointerUp', x: number, y: number): ToolPointerInput {
  return {
    kind,
    screen: { x, y },
    world: { x, y },
    isShiftPressed: false,
    isModPressed: false,
    zoom: 1,
  };
}

/**
 * A rectangle whose label is set in a private family.
 *
 * @returns The shape.
 */
function privateLabelShape(): ShapeObject {
  return {
    id: 'shape' as ObjectId,
    type: 'shape',
    kind: 'rectangle',
    parentId: null,
    x: 100,
    y: 100,
    width: 120,
    height: 60,
    rotation: 0,
    z: 'a1',
    locked: false,
    createdBy: ADA.principalId,
    createdAt: 1,
    updatedAt: 1,
    stroke: null,
    fill: [1, 1, 1, 1],
    cornerRadius: 0,
    sides: 4,
    label: {
      text: 'label words',
      runs: [{ length: 11, style: { ...TEN, fontFamily: 'Private Mono' } }],
    },
  };
}

describe('words stay locked without the font', () => {
  it('blocks every word-changing path once the font goes missing mid-session, and allows styling', () => {
    const { store, context } = createTextModeContext([tenPointText('t', 'private words')]);
    let isAvailable = true;
    const mode = new TextMode(
      { ...context, canEditText: () => isAvailable },
      { kind: 'edit', id: 't' as ObjectId },
    );
    const session = mode.session;
    if (session === undefined) throw new Error('editing did not start');
    isAvailable = false;

    session.type('x');
    session.type(' ');
    session.type('\n');
    session.deleteBackward();
    session.move({ unit: 'textEdge', direction: -1, isExtending: false });
    session.deleteForward();
    session.apply(insertText(session.editor, 'pasted'), 'command');
    session.apply(insertText(session.editor, 'typed'), 'typing', true);
    session.startComposition();
    session.updateComposition('か');
    session.commitComposition('か');
    expect(store.get('t' as ObjectId)).toMatchObject({ text: 'private words' });

    session.selectAll();
    session.setStyle({ weight: 700, fontSize: 32 });
    expect(store.get('t' as ObjectId)).toMatchObject({ text: 'private words' });
    expect(session.editor.runs.every(({ style }) => style.weight === 700)).toBe(true);
    expect(session.editor.runs.every(({ style }) => style.fontSize === 32)).toBe(true);
    expect(session.editor.runs.every(({ style }) => style.fontFamily === TEN.fontFamily)).toBe(
      true,
    );
    mode.exit();
    store.destroy();
  });

  it('asks the guard about the object itself, for a note, a shape label and a text object alike', () => {
    const { store, context } = createTextModeContext([
      tenPointText('t', 'words'),
      tenPointNote('n', 'note words', { x: 300, y: 0 }),
      privateLabelShape(),
    ]);
    const asked = vi.fn<(object: BoardObject) => boolean>(() => false);
    const guarded = { ...context, canEditText: asked };
    for (const id of ['t', 'n', 'shape']) {
      const mode = new TextMode(guarded, { kind: 'edit', id: id as ObjectId });
      expect(mode.session, id).toBeUndefined();
      mode.exit();
    }
    expect(asked.mock.calls.map(([object]) => object.id)).toEqual(['t', 'n', 'shape']);
    expect(asked.mock.calls[2]?.[0]).toEqual(store.get('shape' as ObjectId));
    // A text-tool click on the note asks the same way and writes nothing.
    asked.mockClear();
    const click = new TextMode(guarded, { kind: 'create' });
    click.onPointer(at('pointerDown', 310, 10));
    click.onPointer(at('pointerUp', 310, 10));
    expect(click.session).toBeUndefined();
    expect(asked.mock.calls.map(([object]) => object.id)).toEqual(['n']);
    click.exit();
    expect(store.get('n' as ObjectId)).toMatchObject({ text: 'note words' });
    expect(store.get('shape' as ObjectId)).toMatchObject({
      label: { text: 'label words' },
    });
    store.destroy();
  });

  it('lets a guard that allows, or no guard at all, edit words as before (the owner’s path)', () => {
    const { store, context } = createTextModeContext([
      tenPointText('t', 'words'),
      tenPointText('u', 'other', { x: 0, y: 100 }),
    ]);
    const allowed = new TextMode(
      { ...context, canEditText: () => true },
      { kind: 'edit', id: 't' as ObjectId },
    );
    allowed.session?.move({ unit: 'textEdge', direction: 1, isExtending: false });
    allowed.session?.type('!');
    expect(store.get('t' as ObjectId)).toMatchObject({ text: 'words!' });
    allowed.exit();
    const unguarded = new TextMode(context, { kind: 'edit', id: 'u' as ObjectId });
    unguarded.session?.move({ unit: 'textEdge', direction: 1, isExtending: false });
    unguarded.session?.type('?');
    expect(store.get('u' as ObjectId)).toMatchObject({ text: 'other?' });
    unguarded.exit();
    store.destroy();
  });
});
