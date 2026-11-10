// Acceptance, written by Claude after the hosted coverage run of PR 153
// showed these pinned rules had no test: the override vocabulary of every child type, a run
// swallowed by a boundary moved out of a surrogate pair, a connector inside a main attached to an
// object outside it or to nothing, and the sticky height floor inside a proportionally resized
// group.
import { describe, expect, it } from 'vitest';

import * as schema from '../index.js';
import type { BoardObject } from '../objects/board-object.js';

import {
  asBoardObject,
  BODY,
  boardOf,
  component,
  connector,
  frame,
  group,
  image,
  instance,
  line,
  path,
  shape,
  sticky,
  text,
} from './__fixtures__/component-board.js';
import { expectedExport, type BoxSize } from './__fixtures__/expected-api.js';
import { byId, fullBoard, resolve, type Loose } from './__fixtures__/resolved-board.js';

/**
 * The schema's `instanceOverrideFields`, failing by name on a build without it.
 *
 * @returns The function.
 * @throws {Error} `missing export: instanceOverrideFields` when it is absent.
 */
function overrideFields(): (object: BoardObject) => readonly string[] {
  const value = (schema as Readonly<Record<string, unknown>>).instanceOverrideFields;
  if (typeof value !== 'function') throw new Error('missing export: instanceOverrideFields');
  return value as (object: BoardObject) => readonly string[];
}

describe('the override vocabulary of each child type', () => {
  it.each([
    // Added textStyle and runs wherever text is overridable; a text's and a
    // sticky's measuredSize; a box child's x, y, width and height (a text's height comes
    // from its content; a group's and a path's size from their contents), and a frame's layout;
    // Every drawn child's layer opacity.
    {
      type: 'text',
      child: text('child', 'main'),
      fields: [
        'isHidden',
        'measuredSize',
        'opacity',
        'runs',
        'text',
        'textStyle',
        'width',
        'x',
        'y',
      ],
    },
    {
      type: 'sticky',
      child: sticky('child', 'main'),
      fields: [
        'color',
        'height',
        'isHidden',
        'measuredSize',
        'opacity',
        'runs',
        'text',
        'textStyle',
        'width',
        'x',
        'y',
      ],
    },
    {
      type: 'shape',
      child: shape('child', 'main'),
      fields: [
        'fill',
        'height',
        'isHidden',
        'opacity',
        'runs',
        'strokeColor',
        'text',
        'textStyle',
        'width',
        'x',
        'y',
      ],
    },
    {
      type: 'connector',
      child: connector('child', 'main', 'a', 'b'),
      fields: ['isHidden', 'opacity', 'runs', 'strokeColor', 'text', 'textStyle'],
    },
    {
      type: 'path',
      child: path('child', 'main'),
      fields: ['fill', 'isHidden', 'opacity', 'strokeColor', 'x', 'y'],
    },
    { type: 'line', child: line('child', 'main'), fields: ['isHidden', 'opacity', 'strokeColor'] },
    {
      type: 'image',
      child: image('child', 'main'),
      fields: [
        'assetId',
        'crop',
        'height',
        'isHidden',
        'naturalSize',
        'opacity',
        'width',
        'x',
        'y',
      ],
    },
    { type: 'group', child: group('child', 'main'), fields: ['isHidden', 'opacity', 'x', 'y'] },
    {
      type: 'frame',
      child: frame('child', 'main'),
      // A frame's background as fill, its stroke's colour as strokeColor.
      fields: [
        'autoLayout',
        'fill',
        'height',
        'isHidden',
        'opacity',
        'strokeColor',
        'width',
        'x',
        'y',
      ],
    },
    // (decision 3): a nested instance may also take a variant selection, and
    // a swapped-in main.
    {
      type: 'instance',
      child: asBoardObject(instance('child', 'other')),
      fields: ['height', 'isHidden', 'mainId', 'opacity', 'variant', 'width', 'x', 'y'],
    },
  ])('lets a $type take only $fields', ({ child, fields }) => {
    expect([...overrideFields()(child)].sort()).toEqual(fields);
  });
});

describe('text inherited by an override', () => {
  it('drops a run a moved boundary swallows and merges the equal styles around it', () => {
    const bold = { ...BODY, weight: 700 };
    const runs = [
      { length: 1, style: BODY },
      { length: 1, style: bold },
      { length: 2, style: BODY },
    ];
    // The first boundary (1) falls inside the new text's surrogate pair and moves to 2, where
    // the bold run ends too: bold gets no character, and the plain runs either side become one.
    const board = fullBoard({ overrides: { sticky: { text: '\u{1F600}xy' } } }, [
      sticky('sticky', 'main', { x: 30, y: 40, z: 'a2', runs }),
    ]);
    const resolved = byId(resolve(board).objects, 'inst/sticky');
    expect(resolved.text).toBe('\u{1F600}xy');
    expect(resolved.runs).toEqual([{ length: 4, style: BODY }]);
  });
});

describe('a connector inside a main', () => {
  it('follows its sibling to the virtual copy and keeps an outside or free end as it is', () => {
    const board = boardOf([
      component('main'),
      shape('inside', 'main', { x: 10, y: 10 }),
      shape('outside', null, { x: 900, y: 0 }),
      connector('to-outside', 'main', 'inside', 'outside', { z: 'a3' }),
      connector('to-nowhere', 'main', 'inside', 'inside', {
        z: 'a4',
        to: { kind: 'point', x: 150, y: 80 },
      }),
      instance('inst', 'main', { x: 500 }),
    ]);
    const { objects, issue } = resolve(board);
    expect(issue).toBeUndefined();
    expect(byId(objects, 'inst/to-outside')).toMatchObject({
      from: { kind: 'object', objectId: 'inst/inside' },
      to: { kind: 'object', objectId: 'outside' },
    });
    expect(byId(objects, 'inst/to-nowhere')).toMatchObject({
      from: { kind: 'object', objectId: 'inst/inside' },
      to: { kind: 'point', x: 150, y: 80 },
    });
  });
});

/**
 * Resizes a parent through the schema's `constrainChildren`.
 *
 * @param objects - The board's objects.
 * @param to - The main's new size.
 * @returns The rewritten descendants.
 * @throws {Error} When the fixture has no main.
 */
function resizeMain(objects: readonly object[], to: BoxSize): Loose[] {
  const board = boardOf(objects);
  const main = board.objects.get('main' as BoardObject['id']);
  if (main === undefined) throw new Error('no main in the fixture');
  return expectedExport('constrainChildren')(board, main, to).map((object) => object as Loose);
}

describe('a sticky in a group of a resized main', () => {
  it('never shrinks below its source height while the group maps it proportionally', () => {
    const objects = [
      component('main'),
      group('group', 'main', { x: 30, y: 10, constraints: { x: 'start', y: 'stretch' } }),
      sticky('note', 'group', { x: 0, y: 0 }),
      shape('box', 'group', { x: 20, y: 0 }),
    ];
    // The group's 20-high interior stretches to 10: the shape follows; the sticky keeps 20.
    const shrunk = resizeMain(objects, { width: 200, height: 90 });
    expect(byId(shrunk, 'box')).toMatchObject({ height: 10 });
    expect(byId(shrunk, 'note')).toMatchObject({ height: 20 });
    // Stretched to 40, both follow the group's mapping.
    const grown = resizeMain(objects, { width: 200, height: 120 });
    expect(byId(grown, 'box')).toMatchObject({ height: 40 });
    expect(byId(grown, 'note')).toMatchObject({ height: 40 });
  });
});
