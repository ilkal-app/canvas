import { describe, expect, it } from 'vitest';

import type { ObjectId, PrincipalId, StickyObject, TextStyle } from '@canvas/schema';

import { NOTE_PADDING, noteHeightFor, noteTextPlacement, noteWrapWidth } from './note-text-box.js';
import { textOriginOf, textPlacementOf } from './text-placement.js';

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

function note(overrides: Partial<Omit<StickyObject, 'id' | 'type'>> = {}): StickyObject {
  const text = overrides.text ?? 'Hi';
  return {
    id: 'note' as ObjectId,
    type: 'sticky',
    parentId: null,
    x: 10,
    y: 20,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    width: 200,
    height: 200,
    text,
    runs: [{ length: text.length, style: STYLE }],
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
    ...overrides,
  };
}

describe('note box geometry', () => {
  it('pads the text 16 world units inside the note on every side', () => {
    expect(NOTE_PADDING).toBe(16);
    expect(noteWrapWidth(200)).toBe(168);
  });

  it('keeps a note square while its text is shorter than the note', () => {
    expect(noteHeightFor(200, 30)).toBe(200);
    expect(noteHeightFor(200, 168)).toBe(200);
  });

  it('grows a note taller than square once its text needs the room', () => {
    expect(noteHeightFor(200, 169)).toBe(201);
    expect(noteHeightFor(200, 300)).toBe(332);
  });

  it('never wraps narrower than one world unit, however narrow the note', () => {
    expect(noteWrapWidth(20)).toBe(1);
  });
});

describe('noteTextPlacement', () => {
  it('lays a note out inside its padding, at its wrap width, with its own alignment', () => {
    const placement = noteTextPlacement(note());
    expect(placement).toEqual({
      text: 'Hi',
      runs: [{ length: 2, style: STYLE }],
      origin: { x: 16, y: 16 },
      wrapWidth: 168,
      align: 'center',
      direction: 'auto',
      verticalAlign: 'middle',
      boxHeight: 168,
      fitHeight: 168,
    });
  });

  it('is what textPlacementOf gives a sticky', () => {
    const object = note({ text: 'Two words' });
    expect(textPlacementOf(object)).toEqual(noteTextPlacement(object));
  });

  it('centres short text vertically: the offset is half the room left in the padded box', () => {
    const placement = noteTextPlacement(note());
    // 200 − 2 × 16 = 168 of room for 30 of text: (168 − 30) / 2 = 69 below the top padding.
    expect(textOriginOf(placement, { height: 30 })).toEqual({ x: 16, y: 16 + 69 });
  });

  it('starts grown text at the top padding: no room is left to centre in', () => {
    const grown = note({ height: noteHeightFor(200, 300) });
    expect(textOriginOf(noteTextPlacement(grown), { height: 300 })).toEqual({ x: 16, y: 16 });
  });

  it('keeps top-aligned note text at the top padding', () => {
    const placement = noteTextPlacement(note({ verticalAlign: 'top' }));
    expect(textOriginOf(placement, { height: 30 })).toEqual({ x: 16, y: 16 });
  });
});
