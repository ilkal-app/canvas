import { describe, expect, it } from 'vitest';

import type { Rgba } from '../fields/color.js';
import type { TextStyle } from '../fields/text-style.js';
import type { BoardObject } from '../objects/board-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import {
  asBoardObject,
  BODY,
  boardOf,
  component,
  connector,
  id,
  instance,
  mainChildren,
  shape,
  sticky,
  text,
} from './__fixtures__/component-board.js';
import { applyInstanceOverride } from './override-content.js';
import { resolveInstanceChild } from './resolve-instance-child.js';
import { resolveInstance } from './resolve-instance.js';

// An override record may restyle a text child (`textStyle`) and carry its own runs
// (`runs`, only beside `text`).

const RED: Rgba = [1, 0, 0, 1];
const AMBER: Rgba = [1, 0.75, 0, 1];
const BOLD: TextStyle = { ...BODY, weight: 700 };
const MENTION: TextStyle = { ...BODY, color: AMBER };

/**
 * Resolves `inst` on a board and returns one of its virtual objects.
 *
 * @param objects - The board's objects, including `inst`.
 * @param childPath - The source path under `inst`.
 * @returns The virtual object.
 * @throws {Error} When `inst` has no such virtual child.
 */
function resolvedChild(objects: readonly object[], childPath: string): BoardObject {
  const board = boardOf(objects);
  const placement = board.objects.get(id('inst')) as InstanceObject;
  const found = resolveInstance(board, placement).objects.find(
    (object) => object.id === `inst/${childPath}`,
  );
  if (found === undefined) throw new Error(`no inst/${childPath}`);
  return found;
}

/**
 * A main holding one child and an instance of it with one record on that child.
 *
 * @param child - The main's child, with id `child`.
 * @param record - The instance's record for `child`.
 * @returns The board's objects.
 */
function oneChild(child: BoardObject, record: object): object[] {
  return [component('main'), child, instance('inst', 'main', { overrides: { child: record } })];
}
describe('resolving textStyle and runs', () => {
  const twoRuns = [
    { length: 2, style: BODY },
    { length: 3, style: BOLD },
  ];

  it('recolours every run and keeps the characters', () => {
    const child = text('child', 'main', { text: 'Hello', runs: twoRuns });
    const resolved = resolvedChild(oneChild(child, { textStyle: { color: RED } }), 'child');
    expect(resolved).toMatchObject({
      text: 'Hello',
      runs: [
        { length: 2, style: { ...BODY, color: RED } },
        { length: 3, style: { ...BOLD, color: RED } },
      ],
    });
  });

  it('resizes, and merges neighbours a weight makes equal', () => {
    const child = text('child', 'main', { text: 'Hello', runs: twoRuns });
    const record = { textStyle: { weight: 700, fontSize: 40 } };
    const resolved = resolvedChild(oneChild(child, record), 'child');
    expect(resolved).toMatchObject({
      text: 'Hello',
      runs: [{ length: 5, style: { ...BOLD, fontSize: 40 } }],
    });
  });

  it('gives exactly the record’s runs for text with runs', () => {
    const runs = [
      { length: 5, style: MENTION },
      { length: 3, style: BODY },
    ];
    const resolved = resolvedChild(
      oneChild(text('child', 'main'), { text: '@Mira hi', runs }),
      'child',
    );
    expect(resolved).toMatchObject({ text: '@Mira hi', runs });
  });

  it('restyles the record’s own runs with its textStyle', () => {
    const runs = [
      { length: 5, style: MENTION },
      { length: 3, style: BODY },
    ];
    const record = { text: '@Mira hi', runs, textStyle: { fontSize: 12 } };
    const resolved = resolvedChild(oneChild(text('child', 'main'), record), 'child');
    expect(resolved).toMatchObject({
      text: '@Mira hi',
      runs: [
        { length: 5, style: { ...MENTION, fontSize: 12 } },
        { length: 3, style: { ...BODY, fontSize: 12 } },
      ],
    });
  });

  it('restyles a colour override that also sets the colour of the runs to one', () => {
    const runs = [
      { length: 5, style: MENTION },
      { length: 3, style: BODY },
    ];
    const record = { text: '@Mira hi', runs, textStyle: { color: RED } };
    const resolved = resolvedChild(oneChild(text('child', 'main'), record), 'child');
    expect(resolved).toMatchObject({ runs: [{ length: 8, style: { ...BODY, color: RED } }] });
  });

  it('restyles inherited text alone', () => {
    const child = text('child', 'main', { text: 'Hello', runs: twoRuns });
    const record = { text: 'AB', textStyle: { italic: true } };
    const resolved = resolvedChild(oneChild(child, record), 'child');
    expect(resolved).toMatchObject({
      text: 'AB',
      runs: [{ length: 2, style: { ...BODY, italic: true } }],
    });
  });

  it('restyles the single run of empty text', () => {
    const record = { text: '', textStyle: { color: RED } };
    const resolved = resolvedChild(oneChild(text('child', 'main'), record), 'child');
    expect(resolved).toMatchObject({
      text: '',
      runs: [{ length: 0, style: { ...BODY, color: RED } }],
    });
  });

  it('keeps a surrogate pair whole in the record’s runs', () => {
    const runs = [
      { length: 2, style: BOLD },
      { length: 1, style: BODY },
    ];
    const record = { text: '\u{1F600}a', runs, textStyle: { color: RED } };
    const resolved = resolvedChild(oneChild(text('child', 'main'), record), 'child');
    expect(resolved).toMatchObject({
      text: '\u{1F600}a',
      runs: [
        { length: 2, style: { ...BOLD, color: RED } },
        { length: 1, style: { ...BODY, color: RED } },
      ],
    });
  });

  it('restyles a sticky’s text and leaves its background', () => {
    const record = { textStyle: { color: RED } };
    const resolved = resolvedChild(oneChild(sticky('child', 'main'), record), 'child');
    expect(resolved).toMatchObject({
      text: 'Note',
      runs: [{ length: 4, style: { ...BODY, color: RED } }],
    });
    expect((resolved as { color: unknown }).color).toEqual(
      (sticky('child', 'main') as { color: unknown }).color,
    );
  });

  it('restyles and replaces a shape’s label', () => {
    const label = { text: 'A', runs: [{ length: 1, style: BODY }] };
    const child = shape('child', 'main', { label });
    const runs = [
      { length: 1, style: BOLD },
      { length: 1, style: BODY },
    ];
    const record = { text: 'OK', runs, textStyle: { color: RED } };
    const resolved = resolvedChild(oneChild(child, record), 'child');
    expect(resolved).toMatchObject({
      label: {
        text: 'OK',
        runs: [
          { length: 1, style: { ...BOLD, color: RED } },
          { length: 1, style: { ...BODY, color: RED } },
        ],
      },
    });
  });

  it('restyles a connector’s label', () => {
    const label = { text: 'yes', runs: [{ length: 3, style: BODY }] };
    const objects = [
      component('main'),
      shape('a', 'main'),
      shape('b', 'main', { x: 100 }),
      connector('child', 'main', 'a', 'b', { label }),
      instance('inst', 'main', { overrides: { child: { textStyle: { fontSize: 10 } } } }),
    ];
    expect(resolvedChild(objects, 'child')).toMatchObject({
      label: { text: 'yes', runs: [{ length: 3, style: { ...BODY, fontSize: 10 } }] },
    });
  });

  it('leaves a label-less shape as it was', () => {
    const child = shape('child', 'main');
    const record = { text: 'A', runs: [{ length: 1, style: BODY }], textStyle: { color: RED } };
    const plain = resolvedChild(oneChild(child, {}), 'child');
    const overridden = resolvedChild(oneChild(child, record), 'child');
    expect(overridden).toEqual(plain);
  });

  it('applies a textStyle to text the main changes later', () => {
    const record = { textStyle: { color: RED } };
    const before = text('child', 'main', { text: 'Hi', runs: [{ length: 2, style: BODY }] });
    const after = text('child', 'main', { text: 'Hello', runs: twoRuns });
    expect(resolvedChild(oneChild(before, record), 'child')).toMatchObject({
      text: 'Hi',
      runs: [{ length: 2, style: { ...BODY, color: RED } }],
    });
    expect(resolvedChild(oneChild(after, record), 'child')).toMatchObject({
      text: 'Hello',
      runs: [
        { length: 2, style: { ...BODY, color: RED } },
        { length: 3, style: { ...BOLD, color: RED } },
      ],
    });
  });

  it('ignores a record whose textStyle no reader parses, as a whole', () => {
    const child = text('child', 'main');
    const record = { text: 'Changed', textStyle: { color: 'nope' } };
    expect(resolvedChild(oneChild(child, record), 'child')).toMatchObject({ text: 'Hi' });
  });

  it('applies to an object directly without mutating it', () => {
    const child = text('child', 'main', { text: 'Hello', runs: twoRuns });
    const copy = structuredClone(child);
    applyInstanceOverride(child, { textStyle: { color: RED } });
    expect(child).toEqual(copy);
  });
});

describe('nested records with textStyle and runs', () => {
  const innerRuns = [
    { length: 5, style: MENTION },
    { length: 3, style: BODY },
  ];

  /**
   * A main `m1` with a text `t`, a main `m2` holding an instance `i1` of `m1`, and a root
   * instance `inst` of `m2`.
   *
   * @param inner - `i1`'s record for `t`, or none.
   * @param outer - `inst`'s record for `i1/t`, or none.
   * @returns The board's objects.
   */
  function nested(inner: object | undefined, outer: object | undefined): object[] {
    return [
      component('m1'),
      text('t', 'm1', { text: 'Hello', runs: [{ length: 5, style: BODY }] }),
      component('m2', { x: 300 }),
      asBoardObject(
        instance('i1', 'm1', {
          parentId: id('m2'),
          overrides: inner === undefined ? {} : { t: inner },
        }),
      ),
      instance('inst', 'm2', {
        x: -300,
        overrides: outer === undefined ? {} : { 'i1/t': outer },
      }),
    ];
  }

  it('drops the inner runs when the outer record sets text alone', () => {
    const resolved = resolvedChild(
      nested({ text: '@Mira hi', runs: innerRuns }, { text: 'Bye' }),
      'i1/t',
    );
    expect(resolved).toMatchObject({ text: 'Bye', runs: [{ length: 3, style: BODY }] });
  });

  it('replaces the inner runs with the outer ones', () => {
    const outer = { text: 'ab', runs: [{ length: 2, style: BOLD }] };
    const resolved = resolvedChild(nested({ text: '@Mira hi', runs: innerRuns }, outer), 'i1/t');
    expect(resolved).toMatchObject({ text: 'ab', runs: [{ length: 2, style: BOLD }] });
  });

  it('restyles the inner text and runs with an outer textStyle', () => {
    const resolved = resolvedChild(
      nested({ text: '@Mira hi', runs: innerRuns }, { textStyle: { fontSize: 12 } }),
      'i1/t',
    );
    expect(resolved).toMatchObject({
      text: '@Mira hi',
      runs: [
        { length: 5, style: { ...MENTION, fontSize: 12 } },
        { length: 3, style: { ...BODY, fontSize: 12 } },
      ],
    });
  });

  it('merges the two textStyles key by key, the outer winning', () => {
    const inner = { textStyle: { color: AMBER, fontSize: 40 } };
    const outer = { textStyle: { color: RED, italic: true } };
    expect(resolvedChild(nested(inner, outer), 'i1/t')).toMatchObject({
      runs: [{ length: 5, style: { ...BODY, color: RED, fontSize: 40, italic: true } }],
    });
  });

  it('ignores an unreadable outer record whole rather than completing it with inner fields', () => {
    // Runs without text cannot be read; the inner text must not make them readable.
    const outer = { runs: [{ length: 2, style: BOLD }] };
    expect(resolvedChild(nested({ text: 'OK' }, outer), 'i1/t')).toMatchObject({
      text: 'OK',
      runs: [{ length: 2, style: BODY }],
    });
  });

  it('ignores an unreadable inner record whole under a readable outer one', () => {
    const inner = { runs: [{ length: 5, style: BOLD }] };
    expect(resolvedChild(nested(inner, { textStyle: { color: RED } }), 'i1/t')).toMatchObject({
      text: 'Hello',
      runs: [{ length: 5, style: { ...BODY, color: RED } }],
    });
  });

  it('keeps the inner style under an outer text', () => {
    const inner = { textStyle: { color: AMBER } };
    expect(resolvedChild(nested(inner, { text: 'Bye' }), 'i1/t')).toMatchObject({
      text: 'Bye',
      runs: [{ length: 3, style: MENTION }],
    });
  });
});

describe('resolveInstanceChild with textStyle and runs', () => {
  const runs = [
    { length: 1, style: MENTION },
    { length: 1, style: BODY },
  ];
  const objects = [component('main', { width: 200, height: 100 }), ...mainChildren()];
  const placements = [
    instance('restyled', 'main', {
      overrides: {
        text: { textStyle: { color: RED, fontSize: 30 } },
        sticky: { text: 'Hi', runs, textStyle: { italic: true } },
        'child-a': { text: 'OK', runs },
        'child-b': { textStyle: { color: RED } },
      },
    }),
  ] as InstanceObject[];

  it('equals resolveInstance for every patchable child', () => {
    const board = boardOf([...objects, ...placements]);
    for (const placement of placements) {
      const full = new Map(resolveInstance(board, placement).objects.map((o) => [o.id, o]));
      let patched = 0;
      for (const child of objects.slice(1)) {
        const one = resolveInstanceChild(board, placement, child.id);
        if (one?.kind !== 'shown') continue;
        patched += 1;
        expect(one.object).toEqual(full.get(id(`${placement.id}/${child.id}`)));
      }
      expect(patched).toBeGreaterThan(6);
    }
  });
});
