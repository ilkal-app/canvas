import { describe, expect, it } from 'vitest';

import type { BoardObject, ObjectId } from '@canvas/schema';

import { frame, id, rect } from '../select/__fixtures__/select-board.js';
import { createSelectStore } from '../select/__fixtures__/select-store.js';
import { tenPointNote, tenPointText } from '../text/__fixtures__/text-mode-context.js';

import { carriedLabelsOf, type RaiseDirection } from './carried-labels.js';

/**
 * A text label with a stacking key, 60 × 12.5 at a point in its parent's frame.
 *
 * @param objectId - Its id.
 * @param z - Its stacking key.
 * @param x - Its left, in the parent's frame.
 * @param y - Its top.
 * @param parentId - Its parent, or the board.
 * @returns The text.
 */
function label(objectId: string, z: string, x: number, y: number, parentId: string | null = null) {
  return tenPointText(objectId, 'label text', {
    z,
    x,
    y,
    parentId: parentId === null ? null : id(parentId),
  });
}

/** A note at the board's origin, 200 × 200, stacked at `a2`. */
const NOTE = tenPointNote('note', '', { z: 'a2' });

/**
 * Expands ids over a store holding the objects.
 *
 * @param objects - The board.
 * @param ids - The selection.
 * @param direction - The raise.
 * @returns The expanded ids.
 */
function expand(
  objects: readonly BoardObject[],
  ids: readonly string[],
  direction: RaiseDirection = 'front',
): readonly ObjectId[] {
  return carriedLabelsOf(createSelectStore(objects), ids.map(id), direction);
}

/**
 * A card that is not text, 40 × 40, stacked at a key.
 *
 * @param objectId - Its id.
 * @param z - Its stacking key.
 * @returns The shape.
 */
function card(objectId: string, z: string): BoardObject {
  return { ...rect(objectId, null, { x: 20, y: 20, width: 40, height: 40 }), z };
}

describe('carriedLabelsOf', () => {
  it('carries the text above a selected note that overlaps it, after the selection', () => {
    const board = [NOTE, label('over', 'a3', 50, 50)];
    expect(expand(board, ['note'])).toEqual(['note', 'over']);
  });

  it('leaves text below the note, text beside it and objects that are not text', () => {
    const board = [
      NOTE,
      label('under', 'a1', 50, 50),
      label('beside', 'a3', 300, 50),
      { ...rect('card', null, { x: 20, y: 20, width: 40, height: 40 }), z: 'a4' },
    ];
    expect(expand(board, ['note'])).toEqual(['note']);
  });

  it('leaves text in another parent, even where it overlaps the note on the board', () => {
    const board = [
      NOTE,
      { ...frame('f', null, { x: 0, y: 0, width: 400, height: 400 }), z: 'a0' },
      label('framed', 'a0', 50, 50, 'f'),
    ];
    expect(expand(board, ['note'])).toEqual(['note']);
  });

  it('carries every label above in stacking order, each once, a selected label not again', () => {
    const board = [NOTE, label('top', 'a5', 60, 60), label('middle', 'a3', 10, 10)];
    expect(expand(board, ['note'])).toEqual(['note', 'middle', 'top']);
    expect(expand(board, ['top', 'note'])).toEqual(['top', 'note', 'middle']);
  });

  it('measures overlap by the turned boxes in the parent frame', () => {
    // A quarter turn clockwise about its corner puts a label at (250, 0) over x 237.5–250.
    const turned = { ...label('turned', 'a3', 250, 0), rotation: Math.PI / 2 };
    expect(expand([NOTE, turned], ['note'])).toEqual(['note']);
    const reaching = { ...label('reaching', 'a3', 205, 0), rotation: Math.PI / 2 };
    expect(expand([NOTE, reaching], ['note'])).toEqual(['note', 'reaching']);
  });

  it('carries what lies on any of several selected notes of one parent', () => {
    const second = tenPointNote('second', '', { z: 'a4', x: 400 });
    const board = [
      NOTE,
      second,
      label('on-second', 'a5', 450, 50),
      label('on-first', 'a3', 20, 20),
    ];
    expect(expand(board, ['note', 'second'])).toEqual(['note', 'second', 'on-first', 'on-second']);
  });

  it('returns a selection without notes as it is', () => {
    const board = [NOTE, label('over', 'a3', 50, 50)];
    expect(expand(board, ['over'])).toEqual(['over']);
    expect(expand(board, [])).toEqual([]);
  });

  it('passes over text below the lowest selected note, and weighs each note of several', () => {
    const upper = tenPointNote('upper', '', { z: 'a6' });
    const board = [NOTE, upper, label('between', 'a4', 50, 50), label('under', 'a1', 50, 50)];
    expect(expand(board, ['upper', 'note'])).toEqual(['upper', 'note', 'between']);
  });
});

describe('carriedLabelsOf bringing notes forward', () => {
  it('leaves a label the note does not hop over: note, other, label, other', () => {
    const board = [NOTE, card('x', 'a3'), label('on', 'a4', 50, 50), card('m', 'a5')];
    expect(expand(board, ['note'], 'forward')).toEqual(['note']);
    expect(expand(board, ['note'])).toEqual(['note', 'on']);
  });

  it('carries the label right above the note, and the next one the grown run would hop', () => {
    const board = [
      NOTE,
      label('first', 'a3', 50, 50),
      label('second', 'a4', 60, 60),
      label('beside', 'a5', 300, 50),
      card('m', 'a6'),
    ];
    expect(expand(board, ['note'], 'forward')).toEqual(['note', 'first', 'second']);
  });

  it('joins selected siblings above a carried label into the run', () => {
    const upper = tenPointNote('upper', '', { z: 'a4', x: 400 });
    const board = [NOTE, label('on', 'a3', 50, 50), upper, label('on-upper', 'a5', 450, 50)];
    expect(expand(board, ['note', 'upper'], 'forward')).toEqual([
      'note',
      'upper',
      'on',
      'on-upper',
    ]);
  });

  it('carries nothing for a note at the top, or text off the note right above it', () => {
    expect(expand([card('m', 'a1'), NOTE], ['note'], 'forward')).toEqual(['note']);
    const board = [NOTE, label('beside', 'a3', 300, 50), label('on', 'a4', 50, 50)];
    expect(expand(board, ['note'], 'forward')).toEqual(['note']);
  });
});
