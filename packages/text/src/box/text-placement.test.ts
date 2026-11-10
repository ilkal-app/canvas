import { describe, expect, it } from 'vitest';

import type {
  BoardObject,
  ConnectorObject,
  ObjectId,
  PrincipalId,
  ShapeObject,
  StickyObject,
  TextObject,
  TextStyle,
} from '@canvas/schema';

import { LABEL_PADDING, labelPaddingOf, shapeLabelBox } from './shape-label-box.js';
import { CONNECTOR_LABEL_WRAP_WIDTH, noteHeightFor } from './text-boxes.js';
import {
  connectorLabelPlacementAt,
  noteTextPlacement,
  shapeLabelPlacement,
  textOriginOf,
  textPlacementOf,
} from './text-placement.js';

const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/** The fields every fixture object shares. */
const BASE = {
  id: 'object' as ObjectId,
  parentId: null,
  x: 10,
  y: 20,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:fixture' as PrincipalId,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
} as const;

/**
 * A 200 × 200 centred sticky note saying `Hi`.
 *
 * @param overrides - Fields to change.
 * @returns The note.
 */
function note(overrides: Partial<StickyObject> = {}): StickyObject {
  const text = overrides.text ?? 'Hi';
  return {
    ...BASE,
    type: 'sticky',
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

/**
 * A 200 × 100 shape of a kind, labelled `Hi`.
 *
 * @param kind - The kind.
 * @param overrides - Fields to change.
 * @returns The shape.
 */
function labelled(kind: ShapeObject['kind'], overrides: Partial<ShapeObject> = {}): ShapeObject {
  return {
    ...BASE,
    type: 'shape',
    kind,
    width: 200,
    height: 100,
    stroke: null,
    fill: [1, 0, 0, 1],
    cornerRadius: 0,
    sides: 4,
    label: { text: 'Hi', runs: [{ length: 2, style: STYLE }] },
    ...overrides,
  };
}

/**
 * A 300 × 50 text object.
 *
 * @param overrides - Fields to change.
 * @returns The text.
 */
function text(overrides: Partial<TextObject> = {}): TextObject {
  return {
    ...BASE,
    type: 'text',
    width: 300,
    height: 50,
    text: 'Body',
    runs: [{ length: 4, style: STYLE }],
    align: 'right',
    autoWidth: false,
    verticalAlign: 'bottom',
    ...overrides,
  };
}

/**
 * A straight connector, labelled `Go` unless told otherwise.
 *
 * @param label - Its label.
 * @returns The connector.
 */
function connector(label: ConnectorObject['label'] = CONNECTOR_LABEL): ConnectorObject {
  return {
    ...BASE,
    type: 'connector',
    from: { kind: 'point', x: 0, y: 0 },
    to: { kind: 'point', x: 50, y: 50 },
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    label,
  };
}

const CONNECTOR_LABEL = { text: 'Go', runs: [{ length: 2, style: STYLE }] };

describe('noteTextPlacement', () => {
  it('lays a note out inside its padding, at its wrap width, with its own alignment', () => {
    expect(noteTextPlacement(note())).toEqual({
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
    expect(noteTextPlacement(note({ direction: 'rtl', height: 10 }))).toMatchObject({
      direction: 'rtl',
      boxHeight: 0,
      fitHeight: 0,
    });
  });

  it('is what textPlacementOf gives a sticky', () => {
    const object = note({ text: 'Two words' });
    expect(textPlacementOf(object)).toEqual(noteTextPlacement(object));
  });

  it('centres short text vertically and starts grown text at the top padding', () => {
    const placement = noteTextPlacement(note());
    // 200 − 2 × 16 = 168 of room for 30 of text: (168 − 30) / 2 = 69 below the top padding.
    expect(textOriginOf(placement, { height: 30 })).toEqual({ x: 16, y: 16 + 69 });
    const grown = note({ height: noteHeightFor(200, 300) });
    expect(textOriginOf(noteTextPlacement(grown), { height: 300 })).toEqual({ x: 16, y: 16 });
    const top = noteTextPlacement(note({ verticalAlign: 'top' }));
    expect(textOriginOf(top, { height: 30 })).toEqual({ x: 16, y: 16 });
  });
});

describe('shapeLabelPlacement', () => {
  it("centres the label in the kind's box inside the padding, wrapping at its width", () => {
    const placement = shapeLabelPlacement(labelled('rectangle'));
    expect(placement.text).toBe('Hi');
    expect(placement.origin).toEqual({ x: LABEL_PADDING, y: LABEL_PADDING });
    expect(placement.wrapWidth).toBe(200 - 2 * LABEL_PADDING);
    expect(placement.boxHeight).toBe(100 - 2 * LABEL_PADDING);
    expect(placement.align).toBe('center');
    expect(placement.verticalAlign).toBe('middle');
    const star = labelled('star', { width: 120, height: 90 });
    const box = shapeLabelBox(star);
    expect(shapeLabelPlacement(star).wrapWidth).toBeCloseTo(box.width - 2 * labelPaddingOf(box));
  });

  it('keeps a label taller than its box centred on it, overflowing equally above and below', () => {
    const placement = shapeLabelPlacement(labelled('rectangle'));
    expect(placement.isOverflowAligned).toBe(true);
    // The box is 84 tall inside the padding; 120 of text overflows it by 18 above and 18 below.
    expect(textOriginOf(placement, { height: 120 })).toEqual({ x: LABEL_PADDING, y: -10 });
    expect(textOriginOf(placement, { height: 20 })).toEqual({ x: LABEL_PADDING, y: 40 });
  });

  it('places an empty label for a shape without one, and never wraps below one unit', () => {
    const placement = shapeLabelPlacement(labelled('rectangle', { label: null, width: 0 }));
    expect(placement.text).toBe('');
    expect(placement.runs).toEqual([]);
    expect(placement.wrapWidth).toBe(1);
    expect(placement.boxHeight).toBe(100);
  });

  it('is what textPlacementOf gives a labelled shape, and nothing for one without', () => {
    expect(textPlacementOf(labelled('ellipse'))).toEqual(shapeLabelPlacement(labelled('ellipse')));
    expect(textPlacementOf(labelled('ellipse', { label: null }))).toBeUndefined();
  });
});

describe('connector labels', () => {
  it('centres the label on the point it is given, wrapping at a fixed width', () => {
    const placement = connectorLabelPlacementAt({ x: 25, y: 25 }, CONNECTOR_LABEL);
    expect(placement).toEqual({
      text: 'Go',
      runs: CONNECTOR_LABEL.runs,
      origin: { x: 25 - CONNECTOR_LABEL_WRAP_WIDTH / 2, y: 25 },
      wrapWidth: CONNECTOR_LABEL_WRAP_WIDTH,
      align: 'center',
      direction: 'auto',
      verticalAlign: 'middle',
      boxHeight: 0,
      isOverflowAligned: true,
    });
    expect(textOriginOf(placement, { height: 30 })).toEqual({ x: placement.origin.x, y: 10 });
  });

  it('places a connector by the point the caller finds, and none without one or a label', () => {
    const pointOf = (object: ConnectorObject) => ({ x: object.to.kind === 'point' ? 7 : 0, y: 3 });
    expect(textPlacementOf(connector(), pointOf)).toEqual(
      connectorLabelPlacementAt({ x: 7, y: 3 }, CONNECTOR_LABEL),
    );
    expect(textPlacementOf(connector())).toBeUndefined();
    expect(textPlacementOf(connector(null), pointOf)).toBeUndefined();
  });
});

describe('textPlacementOf', () => {
  it("lays a text object out in its whole box, wrapping at its width unless it's auto-width", () => {
    expect(textPlacementOf(text())).toEqual({
      text: 'Body',
      runs: [{ length: 4, style: STYLE }],
      origin: { x: 0, y: 0 },
      wrapWidth: 300,
      align: 'right',
      direction: 'auto',
      verticalAlign: 'bottom',
      boxHeight: 50,
    });
    const auto = textPlacementOf(text({ autoWidth: true, direction: 'ltr' }));
    expect(auto).toMatchObject({ wrapWidth: null, direction: 'ltr' });
    // Bottom-aligned: 50 of box for 20 of text puts it 30 down; taller text starts at the top.
    expect(textOriginOf(auto, { height: 20 })).toEqual({ x: 0, y: 30 });
    expect(textOriginOf(auto, { height: 80 })).toEqual({ x: 0, y: 0 });
  });

  it('places nothing for an object that draws no text', () => {
    const frame = { ...labelled('rectangle'), type: 'frame' } as unknown as BoardObject;
    expect(textPlacementOf(frame)).toBeUndefined();
  });
});
