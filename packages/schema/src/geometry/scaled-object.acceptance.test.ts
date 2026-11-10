import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import {
  frame,
  group,
  image,
  line,
  path,
  instance,
  shape,
  sticky,
  text,
} from '../instances/__fixtures__/component-board.js';
import type { BoardObject } from '../objects/board-object.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

function scale(object: BoardObject, factor: number): BoardObject {
  const exported = Reflect.get(schema, 'scaledObject') as
    ((source: BoardObject, value: number) => BoardObject) | undefined;
  if (exported === undefined) throw new Error('missing export: scaledObject');
  return exported(object, factor);
}

describe('scaledObject', () => {
  it('scales shape geometry, stroke, label, and every shadow layer', () => {
    const source = deepFreeze(
      shape('s', null, {
        x: 10,
        y: -5,
        width: 20,
        height: 12,
        rotation: 0.7,
        cornerRadius: 3,
        label: {
          text: 'A',
          runs: [
            {
              length: 1,
              style: {
                fontFamily: 'Inter',
                fontSize: 10,
                color: [1, 0, 0, 1],
                weight: 400,
                italic: false,
              },
            },
          ],
        },
        shadow: [
          { x: 1, y: -2, blur: 3, spread: -1, color: [0, 0, 0, 0.5] },
          { x: -3, y: 4, blur: 5, spread: 2, color: [0, 0, 0, 0.25] },
        ],
      }),
    );
    const result = scale(source, 2);
    expect(result).toMatchObject({
      id: source.id,
      x: 20,
      y: -10,
      width: 40,
      height: 24,
      rotation: 0.7,
      cornerRadius: 6,
      stroke: { width: 4 },
      label: { runs: [{ length: 1, style: { fontSize: 20, weight: 400 } }] },
      shadow: [
        { x: 2, y: -4, blur: 6, spread: -2 },
        { x: -6, y: 8, blur: 10, spread: 4 },
      ],
    });
    expect(source).toMatchObject({ x: 10, stroke: { width: 2 }, cornerRadius: 3 });
  });

  it('scales frame radii, stroke, shadow and auto-layout lengths, keeping modes', () => {
    const source = deepFreeze(
      frame('f', null, {
        x: 3,
        y: 4,
        cornerRadius: [1, 2, 3, 4],
        stroke: { color: [0, 0, 0, 1], width: 2 },
        shadow: { x: 1, y: 2, blur: 3, spread: 4, color: [0, 0, 0, 1] },
        autoLayout: {
          direction: 'row',
          gap: 6,
          padding: { top: 1, right: 2, bottom: 3, left: 4 },
          align: 'start',
          justify: 'start',
          width: 'hug',
          height: 'fixed',
        },
      }),
    );
    expect(scale(source, 2)).toMatchObject({
      x: 6,
      y: 8,
      width: 40,
      height: 100,
      cornerRadius: [2, 4, 6, 8],
      stroke: { width: 4 },
      shadow: { x: 2, y: 4, blur: 6, spread: 8 },
      autoLayout: {
        direction: 'row',
        gap: 12,
        padding: { top: 2, right: 4, bottom: 6, left: 8 },
        width: 'hug',
        height: 'fixed',
      },
    });
  });

  it('scales text runs in absolute units and preserves percent and unitless values', () => {
    const base = text('t', null);
    if (base.type !== 'text') throw new Error('text fixture has wrong type');
    const firstRun = base.runs[0];
    if (firstRun === undefined) throw new Error('text fixture has no run');
    const source = deepFreeze({
      ...base,
      x: 5,
      y: 7,
      runs: [
        {
          length: 2,
          style: {
            ...firstRun.style,
            fontSize: 12,
            letterSpacing: { unit: 'px' as const, value: -2 },
            lineHeight: { unit: 'px' as const, value: 18 },
          },
        },
      ],
    });
    const result = scale(source, 2);
    expect(result).toMatchObject({
      x: 10,
      y: 14,
      width: 40,
      height: 20,
      runs: [
        {
          length: 2,
          style: {
            fontSize: 24,
            letterSpacing: { unit: 'px', value: -4 },
            lineHeight: { unit: 'px', value: 36 },
          },
        },
      ],
    });
    const percent = {
      ...source,
      runs: [
        {
          length: 2,
          style: {
            ...firstRun.style,
            fontSize: 12,
            letterSpacing: { unit: 'percent' as const, value: 10 },
            lineHeight: { unit: 'percent' as const, value: 120 },
          },
        },
      ],
    };
    expect(scale(percent, 2)).toMatchObject({
      runs: [
        {
          style: {
            fontSize: 24,
            letterSpacing: { value: 10 },
            lineHeight: { value: 120 },
          },
        },
      ],
    });
  });

  it('scales path vertices and handles and line points with their strokes', () => {
    const p = deepFreeze(
      path('p', null, {
        x: 3,
        y: 4,
        segments: [{ id: 's1', a: 'v1', b: 'v2', ha: { x: 2, y: -3 }, hb: { x: -4, y: 5 } }],
      }),
    );
    expect(scale(p, 2)).toMatchObject({
      x: 6,
      y: 8,
      vertices: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      segments: [{ ha: { x: 4, y: -6 }, hb: { x: -8, y: 10 } }],
      stroke: { width: 4 },
    });
    expect(scale(deepFreeze(line('l', null, { x: 3, y: 4 })), 2)).toMatchObject({
      x: 6,
      y: 8,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 20 },
      ],
      stroke: { width: 4 },
    });
  });

  it('scales sticky, group, and image placement without changing non-length data', () => {
    expect(scale(deepFreeze(sticky('n', null, { x: 5, y: 6 })), 2)).toMatchObject({
      x: 10,
      y: 12,
      width: 40,
      height: 40,
      runs: [{ style: { fontSize: 48 } }],
    });
    expect(scale(deepFreeze(group('g', null, { x: 5, y: 6, rotation: 1 })), 2)).toMatchObject({
      x: 10,
      y: 12,
      rotation: 1,
    });
    const photo = deepFreeze(image('i', null, { x: 5, y: 6, opacity: 0.4 }));
    expect(scale(photo, 2)).toMatchObject({
      x: 10,
      y: 12,
      width: 40,
      height: 40,
      opacity: 0.4,
      assetId: 'asset-photo',
      naturalSize: { width: 100, height: 100 },
      crop: { x: 0, y: 0, width: 1, height: 1 },
    });
  });

  it('composes a nested instance scale and keeps its override values in main units, including measuredSize', () => {
    const source = deepFreeze(
      instance('nested', 'main', {
        x: 5,
        y: 6,
        scale: 0.5,
        overrides: { label: { text: 'Long', measuredSize: { width: 30, height: 12 } } },
      }),
    );
    expect(scale(source, 2)).toMatchObject({
      x: 10,
      y: 12,
      width: 400,
      height: 200,
      scale: 1,
      overrides: { label: { text: 'Long', measuredSize: { width: 30, height: 12 } } },
    });
    expect((scale(source, 2) as typeof source).overrides).toEqual(source.overrides);
  });

  it('returns an equal object at scale 1 without mutating frozen input', () => {
    const source = deepFreeze(shape('s', null, { x: 9, y: 3, cornerRadius: 2 }));
    expect(scale(source, 1)).toEqual(source);
    expect(source).toMatchObject({ x: 9, y: 3, cornerRadius: 2 });
  });
});
