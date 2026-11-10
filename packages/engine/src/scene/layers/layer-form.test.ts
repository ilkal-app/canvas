import { describe, expect, it } from 'vitest';

import type { BoardObject } from '@canvas/schema';

import { component, instance } from '../../components/__fixtures__/component-objects.js';
import {
  connectorObject,
  imageObject,
  lineObject,
  pathObject,
  stickyObject,
  textObject,
} from '../../spatial/__fixtures__/spatial-objects.js';
import { frameObject, groupObject, shapeObject } from '../__fixtures__/scene-objects.js';

import { isLayerForm, ownOpacityOf } from './layer-form.js';

const label = { text: 'Hi', runs: [] };
const triangle = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

describe('isLayerForm', () => {
  it('reads an object’s own opacity, opaque when absent or out of range', () => {
    expect(ownOpacityOf(shapeObject('a'))).toBe(1);
    expect(ownOpacityOf(shapeObject('a', { opacity: 0.25 }))).toBe(0.25);
    expect(ownOpacityOf({ ...shapeObject('a'), opacity: 3 })).toBe(1);
    expect(ownOpacityOf(textObject('t'))).toBe(1);
  });

  it('is never layer form while opaque', () => {
    expect(isLayerForm(groupObject('g'))).toBe(false);
    expect(isLayerForm(frameObject('f', { opacity: 1 }))).toBe(false);
  });

  it('composites translucent containers, at any opacity below 1 including 0', () => {
    expect(isLayerForm(groupObject('g', { opacity: 0.5 }))).toBe(true);
    expect(isLayerForm(frameObject('f', { opacity: 0 }))).toBe(true);
    expect(isLayerForm(component('m', { opacity: 0.5 }))).toBe(true);
    expect(isLayerForm(instance('i', 'm', { opacity: 0.5 }))).toBe(true);
  });

  it('composites multi-part leaves and multiplies single-part ones', () => {
    const cases: [BoardObject, boolean][] = [
      [shapeObject('plain', { opacity: 0.5 }), false],
      [shapeObject('labelled', { opacity: 0.5, label }), true],
      [shapeObject('blank label', { opacity: 0.5, label: { text: ' ', runs: [] } }), false],
      [
        shapeObject('shadowed', {
          opacity: 0.5,
          shadow: { x: 2, y: 2, blur: 0, spread: 0, color: [0, 0, 0, 1] },
        }),
        true,
      ],
      [stickyObject('note', { opacity: 0.5 }), true],
      [lineObject('line', { opacity: 0.5 }), false],
      [{ ...textObject('text'), opacity: 0.5 }, false],
      [{ ...imageObject('image'), opacity: 0.5 }, false],
      [{ ...connectorObject('connector'), opacity: 0.5 }, false],
      [{ ...connectorObject('connector'), opacity: 0.5, label }, true],
      [
        {
          ...pathObject('fill', triangle, { isFilled: true, isClosed: true, strokeWidth: null }),
          fill: [1, 0, 0, 1],
          opacity: 0.5,
        },
        false,
      ],
      [
        {
          ...pathObject('both', triangle, { isFilled: true, isClosed: true, strokeWidth: 2 }),
          fill: [1, 0, 0, 1],
          opacity: 0.5,
        },
        true,
      ],
    ];
    for (const [object, isExpected] of cases)
      expect(isLayerForm(object), object.id).toBe(isExpected);
  });
});
