import { describe, expect, it } from 'vitest';

import { layOutStack, type StackLayout, type StackNode } from './stack-layout.js';

const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };
const layout = (fields: Partial<StackLayout> = {}): StackLayout => ({
  direction: 'column',
  gap: 0,
  padding: NO_PADDING,
  align: 'start',
  isHuggingWidth: true,
  isHuggingHeight: true,
  ...fields,
});
const box = (
  key: string,
  width: number,
  height: number,
  fields: Partial<StackNode> = {},
): StackNode => ({
  key,
  width,
  height,
  ...fields,
});
const byKey = (root: StackNode) =>
  Object.fromEntries(layOutStack(root).map(({ key, ...rest }) => [key, rest]));

describe('layOutStack', () => {
  it('stacks a column with gap and padding and hugs its content', () => {
    const root = box('col', 0, 0, {
      layout: layout({ gap: 8, padding: { top: 10, right: 12, bottom: 14, left: 16 } }),
      children: [box('a', 50, 20), box('b', 80, 30)],
    });
    expect(byKey(root)).toEqual({
      col: { x: 0, y: 0, width: 16 + 80 + 12, height: 10 + 20 + 8 + 30 + 14 },
      a: { x: 16, y: 10, width: 50, height: 20 },
      b: { x: 16, y: 38, width: 80, height: 30 },
    });
  });

  it('stacks a row and aligns children on the cross axis', () => {
    const children = [box('a', 10, 10), box('b', 10, 30)];
    const at = (align: StackLayout['align']) =>
      byKey(box('row', 0, 0, { layout: layout({ direction: 'row', gap: 5, align }), children }));
    expect(at('start').a).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(at('center').a).toEqual({ x: 0, y: 10, width: 10, height: 10 });
    expect(at('end').a).toEqual({ x: 0, y: 20, width: 10, height: 10 });
    expect(at('stretch').a).toEqual({ x: 0, y: 0, width: 10, height: 30 });
    expect(at('start').b).toEqual({ x: 15, y: 0, width: 10, height: 30 });
    expect(at('start').row).toEqual({ x: 0, y: 0, width: 25, height: 30 });
  });

  it('shares the space a fixed-size container has left among its fillers', () => {
    const root = box('row', 200, 40, {
      layout: layout({
        direction: 'row',
        gap: 10,
        padding: { top: 0, right: 10, bottom: 0, left: 10 },
        isHuggingWidth: false,
        isHuggingHeight: false,
        align: 'center',
      }),
      children: [
        box('label', 30, 20),
        box('a', 0, 20, { isFilling: true }),
        box('b', 0, 20, { isFilling: true }),
      ],
    });
    const placed = byKey(root);
    expect(placed.row).toEqual({ x: 0, y: 0, width: 200, height: 40 });
    expect(placed.a).toEqual({ x: 50, y: 10, width: 65, height: 20 });
    expect(placed.b).toEqual({ x: 125, y: 10, width: 65, height: 20 });
  });

  it('keeps a filler at its own size in a container that hugs its main axis', () => {
    const root = box('row', 0, 0, {
      layout: layout({ direction: 'row' }),
      children: [box('a', 30, 10, { isFilling: true })],
    });
    expect(byKey(root).a).toEqual({ x: 0, y: 0, width: 30, height: 10 });
  });

  it('never gives a filler a negative size', () => {
    const root = box('row', 20, 10, {
      layout: layout({ direction: 'row', isHuggingWidth: false }),
      children: [box('wide', 50, 10), box('a', 5, 10, { isFilling: true })],
    });
    expect(byKey(root).a?.width).toBe(0);
  });

  it('measures text that wraps at the width the layout gives it', () => {
    const text = box('text', 300, 20, { heightForWidth: (width) => Math.ceil(300 / width) * 20 });
    const root = box('col', 100, 0, {
      layout: layout({ isHuggingWidth: false, align: 'stretch' }),
      children: [text],
    });
    expect(byKey(root)).toEqual({
      col: { x: 0, y: 0, width: 100, height: 60 },
      text: { x: 0, y: 0, width: 100, height: 60 },
    });
  });

  it('nests layouts: a column of rows of fields', () => {
    const field = (key: string) =>
      box(key, 0, 0, {
        layout: layout({ direction: 'row', gap: 4, align: 'center' }),
        children: [box(`${key}-prefix`, 10, 12), box(`${key}-value`, 40, 16)],
      });
    const row = box('row', 0, 0, {
      layout: layout({ direction: 'row', gap: 8 }),
      children: [field('w'), field('h')],
    });
    const panel = box('panel', 0, 0, {
      layout: layout({ gap: 12, padding: { top: 16, right: 16, bottom: 16, left: 16 } }),
      children: [box('title', 60, 16), row],
    });
    const placed = byKey(panel);
    expect(placed['w-prefix']).toEqual({ x: 0, y: 2, width: 10, height: 12 });
    expect(placed.h).toEqual({ x: 62, y: 0, width: 54, height: 16 });
    expect(placed.row).toEqual({ x: 16, y: 44, width: 116, height: 16 });
    expect(placed.panel).toEqual({ x: 0, y: 0, width: 148, height: 76 });
  });

  it('lays out an empty container as its padding', () => {
    const root = box('empty', 0, 0, {
      layout: layout({ gap: 10, padding: { top: 1, right: 2, bottom: 3, left: 4 } }),
    });
    expect(byKey(root).empty).toEqual({ x: 0, y: 0, width: 6, height: 4 });
  });

  it('does not change its input', () => {
    const root = box('col', 0, 0, { layout: layout(), children: [box('a', 1, 2)] });
    const copy = structuredClone({ ...root, children: [box('a', 1, 2)] });
    layOutStack(root);
    expect(root).toEqual(copy);
  });
});
