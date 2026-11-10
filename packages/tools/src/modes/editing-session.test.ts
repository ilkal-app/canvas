import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { rect } from '../select/__fixtures__/select-board.js';
import { ShapeMode } from '../shape/shape-mode.js';
import { StickyMode } from '../sticky/sticky-mode.js';
import {
  createTextModeContext,
  tenPointNote,
  tenPointText,
} from '../text/__fixtures__/text-mode-context.js';
import { TextMode } from '../text/text-mode.js';

import { editingSessionOf } from './editing-session.js';

describe('editingSessionOf', () => {
  it('finds the session of a text mode and of a sticky mode editing a note', () => {
    const { context } = createTextModeContext([tenPointText('t', 'a'), tenPointNote('n', 'b')]);
    const text = new TextMode(context, { kind: 'edit', id: 't' as ObjectId });
    const note = new StickyMode(context, { kind: 'edit', id: 'n' as ObjectId });
    expect(editingSessionOf(text)?.id).toBe('t');
    expect(editingSessionOf(note)?.id).toBe('n');
  });

  it("finds the session of a shape mode editing a shape's label", () => {
    const shape = rect('s', null, { x: 0, y: 0, width: 10, height: 10 });
    const { context } = createTextModeContext([shape]);
    const mode = new ShapeMode(context, { kind: 'edit', id: shape.id });
    expect(editingSessionOf(mode)?.id).toBe('s');
    expect(editingSessionOf(new ShapeMode(context, { kind: 'create' }))).toBeUndefined();
  });

  it('finds none for a mode that edits no text, or no mode', () => {
    const { context } = createTextModeContext();
    expect(editingSessionOf(new StickyMode(context, { kind: 'create' }))).toBeUndefined();
    expect(editingSessionOf(undefined)).toBeUndefined();
  });
});
