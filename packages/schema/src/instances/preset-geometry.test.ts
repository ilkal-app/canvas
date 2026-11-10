import { describe, expect, it } from 'vitest';

import { boardOf, component, frame, id, instance, shape } from './__fixtures__/component-board.js';
import { laidInstanceSize } from './instance-layout.js';
import { drawnObject, variantSizedAxes, withRecordGeometry } from './preset-geometry.js';

const LAYOUT = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'fixed',
  height: 'fixed',
} as const;

describe('withRecordGeometry', () => {
  const main = component('main', { width: 40, height: 40 });
  const icon = shape('icon', 'main', { x: 10, y: 10, width: 20, height: 20 });
  const board = boardOf([main, icon]);

  it('returns the inputs themselves when a record repeats the stored geometry', () => {
    const drawn = withRecordGeometry(board, main, [icon], {
      [id('main')]: { width: 40 },
      [id('icon')]: { x: 10, y: 10, width: 20, height: 20 },
    });
    expect(drawn.board).toBe(board);
    expect(drawn.main).toBe(main);
  });

  it('copies only what a record changes', () => {
    const drawn = withRecordGeometry(board, main, [icon], { [id('icon')]: { x: 10, width: 24 } });
    expect(drawn.main).toBe(main);
    expect(drawn.board.objects.get(id('icon'))).toMatchObject({ x: 10, width: 24, height: 20 });
    expect(board.objects.get(id('icon'))).toBe(icon);
  });
});

describe('drawnObject', () => {
  const row = frame('row', 'main', { autoLayout: LAYOUT });

  it('keeps a container whose layout patch repeats its own layout', () => {
    const records = { [id('row')]: { autoLayout: { gap: 10, padding: LAYOUT.padding } } };
    expect(drawnObject(row, records, id('main'))).toBe(row);
  });

  it('merges a layout patch that changes a key', () => {
    const records = { [id('row')]: { autoLayout: { gap: 16 } } };
    expect(drawnObject(row, records, id('main'))).toMatchObject({
      autoLayout: { ...LAYOUT, gap: 16 },
    });
  });

  it('ignores a layout patch on a container without auto-layout', () => {
    const plain = frame('plain', 'main');
    const records = { [id('plain')]: { autoLayout: { gap: 16 } } };
    expect(drawnObject(plain, records, id('main'))).toBe(plain);
    expect(drawnObject(undefined, records, id('main'))).toBeUndefined();
  });
});

describe('variantSizedAxes', () => {
  const axes = [{ name: 'Size', values: ['base', 'lg'] }];

  it('names the axes some preset root record sets', () => {
    const main = component('main', {
      variantAxes: axes,
      variantPresets: { 'Size=lg': { [id('main')]: { width: 48 } } },
    });
    expect(variantSizedAxes(main)).toEqual({ isWidthSized: true, isHeightSized: false });
  });

  it('sizes nothing for a child record, a main without presets or another type', () => {
    const main = component('main', {
      variantAxes: axes,
      variantPresets: { 'Size=lg': { [id('icon')]: { width: 24, height: 24 } } },
    });
    const none = { isWidthSized: false, isHeightSized: false };
    expect(variantSizedAxes(main)).toEqual(none);
    expect(variantSizedAxes(component('plain'))).toEqual(none);
    expect(variantSizedAxes(shape('icon', null))).toEqual(none);
  });
});

describe('withRecordGeometry in a resized variant', () => {
  it('maps content without a record by its constraints, then applies records', () => {
    const main = component('main', { width: 40, height: 40 });
    const centred = shape('centred', 'main', {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      constraints: { x: 'center', y: 'center' },
    });
    const placed = shape('placed', 'main', { x: 0, y: 0, width: 4, height: 4 });
    const board = boardOf([main, centred, placed]);
    const drawn = withRecordGeometry(board, main, [centred, placed], {
      [id('main')]: { width: 48, height: 48 },
      [id('placed')]: { x: 40 },
    });
    expect(drawn.main).toMatchObject({ width: 48, height: 48 });
    expect(drawn.board.objects.get(id('centred'))).toMatchObject({ x: 14, y: 14 });
    expect(drawn.board.objects.get(id('placed'))).toMatchObject({ x: 40, y: 0 });
  });

  it('leaves an auto-layout main to place its own children', () => {
    const main = component('main', { width: 40, height: 40, autoLayout: LAYOUT });
    const child = shape('child', 'main', { x: 5, y: 5, constraints: { x: 'end', y: 'end' } });
    const board = boardOf([main, child]);
    const drawn = withRecordGeometry(board, main, [child], { [id('main')]: { width: 80 } });
    expect(drawn.board.objects.get(id('child'))).toBe(child);
  });
});

describe('laidInstanceSize on a hug axis of a variant-sized main', () => {
  const hug = {
    ...LAYOUT,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    width: 'hug',
  } as const;
  const main = component('main', {
    width: 20,
    height: 20,
    autoLayout: hug,
    variantAxes: [{ name: 'Size', values: ['base', 'lg'] }],
    variantPresets: { 'Size=lg': { [id('main')]: { width: 48 } } },
  });
  const child = shape('child', 'main', { x: 0, y: 0, width: 20, height: 20 });
  const board = boardOf([main, child]);
  const reader = {
    get: (objectId: string) => board.objects.get(objectId as never),
    childrenOf: (objectId: string) =>
      [...board.objects.values()].filter((o) => o.parentId === objectId).map((o) => o.id),
  };

  it('keeps an explicit root width over the laid content', () => {
    const placed = instance('inst', 'main', { width: 20, height: 20, variant: { Size: 'lg' } });
    expect(laidInstanceSize(reader, placed, main)).toMatchObject({ width: 48, height: 20 });
  });

  it('hugs the content in a variant without a root width', () => {
    const placed = instance('inst', 'main', { width: 48, height: 20, variant: { Size: 'base' } });
    expect(laidInstanceSize(reader, placed, main)).toMatchObject({ width: 20, height: 20 });
  });

  it('keeps a fixed width whatever the variant', () => {
    const placed = instance('inst', 'main', {
      width: 60,
      height: 20,
      isWidthFixed: true,
      variant: { Size: 'lg' },
    });
    expect(laidInstanceSize(reader, placed, main)).toMatchObject({ width: 60 });
  });
});
