// Where a peer's edit lies on the board, with the monospaced fake layout
// (engine/__fixtures__/text-document.ts): 24 px text, 14.4 px a character, lines 30 px tall.
// In Chrome: tooling/scenario/specs/app/peer-editing*.spec.ts.
import { describe, expect, it } from 'vitest';

import { NOTE_FIT_FLOOR_PX, NOTE_PADDING } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { MONO_LAYOUT } from '../engine/__fixtures__/text-document.js';
import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { peerEditingGeometryOf, rgbaOfHex } from './peer-editing-geometry.js';

const STYLE = { ...DEFAULT_TEXT_STYLE, fontSize: 24 };

function runs(text: string) {
  return [{ length: text.length, style: STYLE }];
}

const TEXT = {
  id: 'text',
  type: 'text',
  parentId: null,
  x: 100,
  y: 50,
  rotation: 0,
  width: 400,
  height: 24,
  text: 'Hello world',
  runs: runs('Hello world'),
  align: 'left',
  verticalAlign: 'top',
  autoWidth: true,
};

const NOTE = {
  id: 'note',
  type: 'sticky',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  width: 200,
  height: 200,
  text: 'Hi',
  runs: runs('Hi'),
  align: 'left',
  verticalAlign: 'top',
  autoWidth: false,
};

function boardOf(...objects: object[]) {
  const list = objects as BoardObject[];
  return { get: (id: ObjectId) => list.find((object) => object.id === id) };
}

describe('rgbaOfHex', () => {
  it('reads a presence colour as opaque channels from 0 to 1', () => {
    expect(rgbaOfHex('#ff8000')).toEqual([1, 128 / 255, 0, 1]);
  });
});

describe('peerEditingGeometryOf', () => {
  it('places a text object’s box, the caret at the focus and no highlight for a caret', () => {
    const geometry = peerEditingGeometryOf(boardOf(TEXT), MONO_LAYOUT, {
      objectId: 'text',
      anchor: 5,
      focus: 5,
    });
    expect(geometry?.box).toMatchObject({ x: 100, y: 50, rotation: 0 });
    expect(geometry?.box.width).toBeCloseTo(11 * 14.4);
    expect(geometry?.caret.x).toBeCloseTo(100 + 5 * 14.4);
    expect(geometry?.caret).toMatchObject({ y: 50, width: 0 });
    expect(geometry?.caret.height).toBeCloseTo(30);
    expect(geometry?.highlights).toEqual([]);
  });

  it('highlights a selection either way round, and holds offsets past the text at its end', () => {
    const backwards = peerEditingGeometryOf(boardOf(TEXT), MONO_LAYOUT, {
      objectId: 'text',
      anchor: 11,
      focus: 6,
    });
    expect(backwards?.highlights).toHaveLength(1);
    expect(backwards?.highlights[0]?.x).toBeCloseTo(100 + 6 * 14.4);
    expect(backwards?.highlights[0]?.width).toBeCloseTo(5 * 14.4);
    const past = peerEditingGeometryOf(boardOf(TEXT), MONO_LAYOUT, {
      objectId: 'text',
      anchor: 400,
      focus: 400,
    });
    expect(past?.caret.x).toBeCloseTo(100 + 11 * 14.4);
  });

  it('highlights a selection over wrapped lines line by line', () => {
    const wrapped = { ...TEXT, autoWidth: false, width: 6 * 14.4 + 1 };
    const geometry = peerEditingGeometryOf(boardOf(wrapped), MONO_LAYOUT, {
      objectId: 'text',
      anchor: 0,
      focus: 11,
    });
    expect(geometry?.highlights.length).toBe(2);
    expect(geometry?.highlights[1]?.y).toBeCloseTo(50 + 30);
  });

  it('places a note’s padded box and its text inside the padding, turned with it', () => {
    const turned = { ...NOTE, x: 10, y: 20, rotation: Math.PI / 2 };
    const geometry = peerEditingGeometryOf(boardOf(turned), MONO_LAYOUT, {
      objectId: 'note',
      anchor: 0,
      focus: 0,
    });
    expect(geometry?.box).toMatchObject({ x: 10, y: 20, width: 200, height: 200 });
    expect(geometry?.box.rotation).toBeCloseTo(Math.PI / 2);
    // The text's corner, (padding, padding) in the note, turned a quarter about (10, 20).
    expect(geometry?.caret.x).toBeCloseTo(10 - NOTE_PADDING);
    expect(geometry?.caret.y).toBeCloseTo(20 + NOTE_PADDING);
  });

  it('grows a note’s box with text taller than it even at the fit’s floor', () => {
    const tall = { ...NOTE, height: 10 };
    const geometry = peerEditingGeometryOf(boardOf(tall), MONO_LAYOUT, {
      objectId: 'note',
      anchor: 0,
      focus: 0,
    });
    // No room inside the padding: the text is fitted at the 8 px floor (its 30 px line at 24 px
    // scaled to 8) and the box grows to it.
    expect(geometry?.box.height).toBeCloseTo(30 * (NOTE_FIT_FLOOR_PX / 24) + 2 * NOTE_PADDING);
  });

  it('places a shape’s label in the shape’s box', () => {
    const shape = {
      ...NOTE,
      id: 'shape',
      type: 'shape',
      kind: 'rectangle',
      cornerRadius: 0,
      sides: 4,
      stroke: null,
      fill: null,
      label: { text: 'Go', runs: runs('Go') },
    };
    const geometry = peerEditingGeometryOf(boardOf(shape), MONO_LAYOUT, {
      objectId: 'shape',
      anchor: 0,
      focus: 2,
    });
    expect(geometry?.box).toMatchObject({ x: 0, y: 0, width: 200, height: 200 });
    expect(geometry?.highlights).toHaveLength(1);
  });

  it('shows nothing for an absent object, one without text, a connector, or no font', () => {
    const spot = { objectId: 'x', anchor: 0, focus: 0 };
    expect(peerEditingGeometryOf(boardOf(), MONO_LAYOUT, spot)).toBeUndefined();
    const blank = { ...NOTE, id: 'x', type: 'shape', kind: 'rectangle', label: null };
    expect(peerEditingGeometryOf(boardOf(blank), MONO_LAYOUT, spot)).toBeUndefined();
    const connector = { ...NOTE, id: 'x', type: 'connector', label: null };
    expect(peerEditingGeometryOf(boardOf(connector), MONO_LAYOUT, spot)).toBeUndefined();
    const frame = { ...NOTE, id: 'x', type: 'frame' };
    expect(peerEditingGeometryOf(boardOf(frame), MONO_LAYOUT, spot)).toBeUndefined();
    const noFont = { layout: () => undefined };
    expect(peerEditingGeometryOf(boardOf({ ...NOTE, id: 'x' }), noFont, spot)).toBeUndefined();
  });
});
