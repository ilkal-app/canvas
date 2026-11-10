import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { MIXED } from '../panels/controls/mixed-value.js';

import { CONNECTOR, LINE, SHAPE, SHAPE_2, TEXT } from './popover-shape-connector-fixtures.js';
import {
  FRAME,
  FRAME_2,
  FREEHAND,
  GROUP,
  IMAGE,
  IMAGE_2,
  PATH,
  STICKY,
} from './popover-viv-629-fixtures.js';
import {
  colourChangesOf,
  isFrameSelection,
  isImageSelection,
  isSeveralSelection,
  sharedBackgroundOf,
  sharedColourOf,
  takesColour,
} from './several-values.js';

const RED = [1, 0, 0, 1] as const;

describe('isSeveralSelection', () => {
  it('takes two or more objects of mixed types', () => {
    expect(isSeveralSelection([SHAPE, TEXT])).toBe(true);
    expect(isSeveralSelection([STICKY, TEXT, IMAGE])).toBe(true);
    expect(isSeveralSelection([GROUP, GROUP])).toBe(true);
  });

  it('leaves one object and one-type selections to their own rows', () => {
    expect(isSeveralSelection([])).toBe(false);
    expect(isSeveralSelection([SHAPE])).toBe(false);
    expect(isSeveralSelection([SHAPE, SHAPE_2])).toBe(false);
    expect(isSeveralSelection([FRAME, FRAME_2])).toBe(false);
    expect(isSeveralSelection([IMAGE, IMAGE_2])).toBe(false);
    expect(isSeveralSelection([CONNECTOR, LINE])).toBe(false);
  });

  it('names frame-only and image-only selections', () => {
    expect(isFrameSelection([FRAME, FRAME_2])).toBe(true);
    expect(isFrameSelection([FRAME, IMAGE])).toBe(false);
    expect(isFrameSelection([])).toBe(false);
    expect(isImageSelection([IMAGE])).toBe(true);
    expect(isImageSelection([IMAGE, TEXT])).toBe(false);
  });
});

describe('the several-objects colour', () => {
  it('applies to stickies, fills, backgrounds and strokes, not texts, images or groups', () => {
    const takes = [STICKY, SHAPE, PATH, FRAME, CONNECTOR, LINE, FREEHAND].map(takesColour);
    expect(takes.every(Boolean)).toBe(true);
    expect([TEXT, IMAGE, GROUP].map(takesColour)).toEqual([false, false, false]);
  });

  it('reads the colour every object that takes one shares', () => {
    const red = (object: BoardObject): BoardObject =>
      object.type === 'sticky'
        ? { ...object, color: [...RED] }
        : object.type === 'shape'
          ? { ...object, fill: [...RED] }
          : object;
    expect(sharedColourOf([red(STICKY), red(SHAPE), TEXT])).toEqual([...RED]);
    expect(sharedColourOf([STICKY, SHAPE])).toBe(MIXED);
    expect(
      sharedColourOf([
        { ...PATH, fill: null },
        { ...FRAME, background: null },
      ]),
    ).toBeNull();
  });

  it('counts a gradient as mixed', () => {
    const gradient = { type: 'linear' as const, angle: 0, stops: [] };
    expect(sharedColourOf([{ ...SHAPE, fill: gradient }])).toBe(MIXED);
    expect(sharedBackgroundOf([{ ...FRAME, background: gradient }])).toBe(MIXED);
  });

  it('changes each object by its own field, keeping the rest of a stroke', () => {
    const color = { token: 'accent' };
    expect(colourChangesOf([FREEHAND, TEXT, GROUP, FRAME], color)).toEqual([
      { id: FREEHAND.id, style: { stroke: { ...FREEHAND.stroke, color } } },
      { id: FRAME.id, style: { background: color } },
    ]);
  });
});

describe('sharedBackgroundOf', () => {
  it('reads a shared background, none, or mixed', () => {
    expect(sharedBackgroundOf([FRAME, { ...FRAME_2, background: FRAME.background }])).toEqual(
      FRAME.background,
    );
    expect(sharedBackgroundOf([FRAME_2])).toBeNull();
    expect(sharedBackgroundOf([FRAME, FRAME_2])).toBe(MIXED);
  });
});
