// Written before the code. CONTRACT: runLinkAt finds the character box under a world point for text, sticky and labels, leaving object-link fallback to the caller. Deliberately not asserted: browser pointer trust or window.open.
import { describe, expect, it } from 'vitest';

import { fontFaceId, fontFaceOf, layoutText, type GlyphMeasurer } from '@canvas/engine';
import type { BoardObject, ObjectId, TextObject, PrincipalId } from '@canvas/schema';
import { textOriginIn, type EditableTextObject } from '@canvas/tools';

import { runLinkAt } from './link-at.js';

const LINK = 'https://example.com/run';
const STYLE = {
  fontFamily: 'Liberation Sans',
  fontSize: 10,
  color: [0, 0, 0, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};
const MEASURER: GlyphMeasurer = {
  faceIdOf: (style) => fontFaceId(fontFaceOf(style)),
  advance: () => 0.6,
  kerning: () => 0,
  lineMetrics: () => ({ ascent: 0.8, descent: 0.2 }),
};
const TEXT: TextObject = {
  id: 't' as ObjectId,
  type: 'text',
  parentId: null,
  x: 100,
  y: 200,
  width: 18,
  height: 12.5,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:test' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  text: 'abc',
  runs: [
    { length: 1, style: STYLE },
    { length: 1, style: { ...STYLE, link: LINK } },
    { length: 1, style: STYLE },
  ],
  align: 'left',
  autoWidth: true,
  verticalAlign: 'top',
  link: 'https://example.com/object',
};

function laidOut() {
  return layoutText(TEXT.text, TEXT.runs, null, MEASURER);
}

describe('runLinkAt', () => {
  it('returns only the link on the character whose box holds the point', () => {
    const layout = laidOut();
    expect(runLinkAt(TEXT, layout, { x: 109, y: 205 })).toBe(LINK);
    expect(runLinkAt(TEXT, layout, { x: 103, y: 205 })).toBeUndefined();
    expect(runLinkAt(TEXT, layout, { x: 115, y: 205 })).toBeUndefined();
    expect(runLinkAt(TEXT, layout, { x: 150, y: 205 })).toBeUndefined();
  });

  it.each(['sticky', 'shape', 'connector'] as const)(
    'finds the linked character in a %s text or label',
    (type) => {
      const label = { text: TEXT.text, runs: TEXT.runs };
      const object = (type === 'sticky'
        ? { ...TEXT, type, width: 100, height: 60, autoWidth: false, color: [1, 1, 0, 1] }
        : type === 'shape'
          ? {
              ...TEXT,
              type,
              width: 100,
              height: 60,
              kind: 'rectangle',
              stroke: null,
              fill: null,
              cornerRadius: 0,
              sides: 4,
              label,
            }
          : {
              ...TEXT,
              type,
              from: { kind: 'point', x: 100, y: 200 },
              to: { kind: 'point', x: 200, y: 200 },
              route: 'straight',
              stroke: { color: [0, 0, 0, 1], width: 2 },
              startCap: 'none',
              endCap: 'arrow',
              label,
            }) as unknown as EditableTextObject;
      const layout = laidOut();
      const origin = textOriginIn(object, layout);
      expect(
        runLinkAt(object as BoardObject, layout, {
          x: object.x + origin.x + 9,
          y: object.y + origin.y + 5,
        }),
      ).toBe(LINK);
    },
  );
});
