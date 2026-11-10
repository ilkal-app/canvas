import { bench, describe } from 'vitest';

import type { BoardObject, InstanceOverrides, ObjectId } from '@canvas/schema';

import type { SceneChangeSet, SceneSource } from '../scene/scene-source.js';
import { benchSize } from '../spatial/__fixtures__/bench-size.js';

import {
  component,
  connector,
  id,
  image,
  instance,
  shape,
  sticky,
  text,
} from './__fixtures__/component-objects.js';
import type { DefinitionSource } from './definition-source.js';
import { InstanceExpansion } from './instance-expansion.js';

// CPU cost of component instance expansion on the page's main thread: what the app's
// document scene feed does before the renderer sees a change. The board is the frame-time
// benchmark's instance board (tooling/bench, `buildInstanceBoard`): one main of twelve children
// and 1,000 instances of it, about 12,000 virtual objects. A first load expands every instance;
// a drag of 50 instances is a placement-only change that keeps their expansions; one edit of
// the main re-resolves every instance (`dependentsOf`); an edit of an object no instance
// depends on walks its ancestry and stops. The frame-time suite measures the same board through
// the real app (`zoom-sweep-instances`, `drag-instances`, `main-edit-instances`).
// A swapped slot: an edit inside the swapped-in main re-resolves, in full, only the
// instances whose records swap it in, half the board.

/** The instances: 1,000 as in the frame-time board; 100 in CI's smoke run. */
const INSTANCE_COUNT = benchSize({ full: 1_000, smoke: 100 });
/** Instances a drag moves. */
const DRAGGED = Math.min(50, INSTANCE_COUNT);

/**
 * The main's twelve children: a background, a header, a title, an avatar, body text, a note,
 * two tags, a photo, two badges and a connector from the note to a tag.
 *
 * @returns The main and its children.
 */
function mainWithChildren(): BoardObject[] {
  return [
    component('main', { width: 200, height: 120 }),
    shape('bg', 'main', { width: 200, height: 120, z: 'a1' }),
    shape('header', 'main', { width: 200, height: 28, z: 'a2' }),
    text('title', 'main', { x: 10, y: 6, width: 140, z: 'a3' }),
    shape('avatar', 'main', { x: 172, y: 4, kind: 'ellipse', z: 'a4' }),
    text('body', 'main', { x: 10, y: 34, width: 180, height: 32, z: 'a5' }),
    sticky('note', 'main', { x: 10, y: 76, z: 'a6' }),
    shape('tag1', 'main', { x: 80, y: 80, width: 50, height: 16, z: 'a7' }),
    shape('tag2', 'main', { x: 136, y: 80, width: 50, height: 16, z: 'a8' }),
    image('photo', 'main', { x: 140, y: 34, z: 'a9' }),
    shape('badge1', 'main', { x: 186, y: 100, width: 10, height: 10, z: 'aA' }),
    shape('badge2', 'main', { x: 160, y: 100, width: 10, height: 10, z: 'aB' }),
    { ...connector('link', 'main', 'note', 'tag1'), z: 'aC' },
  ];
}

/** The bench board: the main, its children, the instances on a 40-wide grid and one loose shape. */
class InstanceBench {
  readonly objects = new Map<ObjectId, BoardObject>();
  readonly instanceIds: ObjectId[] = [];
  private readonly children = new Map<ObjectId | null, ObjectId[]>();

  constructor() {
    const all = [...mainWithChildren(), shape('loose', null, { x: -1_000 })];
    for (let index = 0; index < INSTANCE_COUNT; index += 1) {
      const instanceId = `i${String(index)}`;
      this.instanceIds.push(id(instanceId));
      all.push(
        instance(instanceId, 'main', {
          x: (index % 40) * 240,
          y: Math.floor(index / 40) * 160,
          width: 200,
          height: 120,
        }),
      );
    }
    for (const object of all) this.set(object);
  }

  /** Whole-board reads, through indexes as the document store's references are. */
  readonly definitions: DefinitionSource = {
    get: (objectId) => this.objects.get(objectId),
    childrenOf: (parentId) => this.children.get(parentId) ?? [],
    instancesOf: (mainId) =>
      this.instanceIds.filter((instanceId) => {
        const object = this.objects.get(instanceId);
        return object?.type === 'instance' && object.mainId === mainId;
      }),
  };

  /** The page's reads: every object is on the one page. */
  readonly shown: SceneSource = { get: (objectId) => this.objects.get(objectId) };

  set(object: BoardObject): void {
    if (!this.objects.has(object.id)) {
      const siblings = this.children.get(object.parentId) ?? [];
      siblings.push(object.id);
      this.children.set(object.parentId, siblings);
    }
    this.objects.set(object.id, object);
  }

  /**
   * A page change set over the board.
   *
   * @param kind - Whether the ids are created or updated.
   * @param ids - The ids.
   * @returns The change set.
   */
  changes(kind: 'created' | 'updated', ids: readonly ObjectId[]): SceneChangeSet {
    return {
      created: kind === 'created' ? ids : [],
      updated: kind === 'updated' ? ids : [],
      deleted: [],
      get: (objectId) => this.objects.get(objectId),
    };
  }

  /**
   * An expansion that has shown the whole board.
   *
   * @returns The loaded expansion.
   */
  loaded(): InstanceExpansion {
    const expansion = new InstanceExpansion(this.definitions);
    expansion.expand(this.changes('created', [...this.objects.keys()]));
    return expansion;
  }
}

describe(`${String(INSTANCE_COUNT)} instances of a 12-child main`, () => {
  const board = new InstanceBench();
  const everything = [...board.objects.keys()];

  bench('expand: first load of the board (every instance resolved)', () => {
    const expansion = new InstanceExpansion(board.definitions);
    expansion.expand(board.changes('created', everything));
  });

  const dragExpansion = board.loaded();
  const dragged = board.instanceIds.slice(0, DRAGGED);
  let dragStep = 0;
  bench(`expand: move ${String(DRAGGED)} instances (placement only)`, () => {
    dragStep += 1;
    for (const instanceId of dragged) {
      const object = board.objects.get(instanceId);
      if (object !== undefined)
        board.set({ ...object, x: object.x + (dragStep % 2 === 0 ? -1 : 1) });
    }
    dragExpansion.expand(board.changes('updated', dragged));
  });

  const editExpansion = board.loaded();
  const fills: readonly [number, number, number, number][] = [
    [0.96, 0.96, 0.98, 1],
    [0.98, 0.72, 0.6, 1],
  ];
  let editStep = 0;
  bench('dependentsOf: one main edit reaching every instance', () => {
    editStep += 1;
    const background = board.objects.get(id('bg'));
    if (background?.type === 'shape')
      board.set({ ...background, fill: fills[editStep % 2] ?? null });
    editExpansion.dependentsOf([id('bg')], board.shown);
  });

  bench('dependentsOf: an edit no instance depends on', () => {
    editExpansion.dependentsOf([id('loose')], board.shown);
  });
});

describe(`${String(INSTANCE_COUNT)} instances of a main with variants`, () => {
  const board = new InstanceBench();
  const fills: readonly [number, number, number, number][] = [
    [0.2, 0.3, 0.6, 1],
    [0.6, 0.3, 0.2, 1],
  ];
  /**
   * The main with a `state` axis whose `hover` preset recolours the background and hides a badge.
   *
   * @param fill - The background colour the preset sets.
   * @returns The main.
   * @throws {Error} When the bench board has no main.
   */
  const withPresets = (fill: [number, number, number, number]): BoardObject => {
    const main = board.objects.get(id('main'));
    if (main?.type !== 'component') throw new Error('the bench board has no main');
    return {
      ...main,
      variantAxes: [{ name: 'state', values: ['rest', 'hover'] }],
      variantPresets: {
        'state=rest': {},
        'state=hover': { bg: { fill }, badge1: { isHidden: true } },
      },
    };
  };
  board.set(withPresets(fills[0] ?? [0, 0, 0, 1]));
  for (const instanceId of board.instanceIds) {
    const object = board.objects.get(instanceId);
    if (object?.type === 'instance') board.set({ ...object, variant: { state: 'hover' } });
  }
  const expansion = board.loaded();
  let step = 0;

  bench('dependentsOf: one preset edit reaching every instance', () => {
    step += 1;
    board.set(withPresets(fills[step % 2] ?? [0, 0, 0, 1]));
    expansion.dependentsOf([id('main')], board.shown);
  });

  bench('dependentsOf: a main rename no instance reads', () => {
    step += 1;
    const main = board.objects.get(id('main'));
    if (main?.type === 'component') board.set({ ...main, name: `Card ${String(step % 2)}` });
    expansion.dependentsOf([id('main')], board.shown);
  });
});

describe(`${String(INSTANCE_COUNT)} instances with a swapped slot`, () => {
  const board = new InstanceBench();
  // The main gains a slot showing `icon-a`; every other instance swaps it to `icon-b`.
  for (const icon of ['icon-a', 'icon-b']) {
    board.set(component(icon, { width: 10, height: 10 }));
    board.set(shape(`${icon}-mark`, icon, { width: 10, height: 10 }));
  }
  board.set(instance('slot', 'icon-a', { parentId: 'main', x: 4, y: 100, width: 10, height: 10 }));
  board.instanceIds.forEach((instanceId, index) => {
    const object = board.objects.get(instanceId);
    if (object?.type === 'instance' && index % 2 === 0) {
      board.set({ ...object, overrides: { slot: { mainId: id('icon-b') } } });
    }
  });
  const expansion = board.loaded();
  const fills: readonly [number, number, number, number][] = [
    [0.2, 0.6, 0.3, 1],
    [0.6, 0.2, 0.3, 1],
  ];
  let step = 0;

  bench('dependentsOf: a swapped-in main edit reaching the instances that swap', () => {
    step += 1;
    const mark = board.objects.get(id('icon-b-mark'));
    if (mark?.type === 'shape') board.set({ ...mark, fill: fills[step % 2] ?? null });
    expansion.dependentsOf([id('icon-b-mark')], board.shown);
  });
});

describe(`${String(INSTANCE_COUNT)} instances of a laid-out main`, () => {
  // The frame-time board's laid-out main (`instances-laid-out`): a fixed row, 4 apart, padded 8.
  const board = new InstanceBench();
  const main = board.objects.get(id('main'));
  if (main?.type === 'component') {
    board.set({
      ...main,
      autoLayout: {
        direction: 'row',
        gap: 4,
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        align: 'start',
        justify: 'start',
        width: 'fixed',
        height: 'fixed',
      },
    });
  }
  const expansion = board.loaded();
  const fills: readonly [number, number, number, number][] = [
    [0.96, 0.96, 0.98, 1],
    [0.98, 0.72, 0.6, 1],
  ];
  let step = 0;

  bench('dependentsOf: a recolour no layout reads (patched in place)', () => {
    step += 1;
    const background = board.objects.get(id('bg'));
    if (background?.type === 'shape') board.set({ ...background, fill: fills[step % 2] ?? null });
    expansion.dependentsOf([id('bg')], board.shown);
  });

  bench('dependentsOf: a resize the layout reads (every instance laid out)', () => {
    step += 1;
    const tag = board.objects.get(id('tag1'));
    if (tag?.type === 'shape') board.set({ ...tag, width: step % 2 === 0 ? 50 : 54 });
    expansion.dependentsOf([id('tag1')], board.shown);
  });
});

describe(`${String(INSTANCE_COUNT)} instances of a laid-out main with variants`, () => {
  // The laid-out main above with a `state` axis: a preset that only repaints patches each copy in
  // place; one that moves or sizes a child, or sizes the variant, resolves every instance in full.
  const board = new InstanceBench();
  const main = board.objects.get(id('main'));
  if (main?.type !== 'component') throw new Error('the bench board has no main');
  const laidOut: BoardObject = {
    ...main,
    autoLayout: {
      direction: 'row',
      gap: 4,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      align: 'start',
      justify: 'start',
      width: 'fixed',
      height: 'fixed',
    },
    variantAxes: [{ name: 'state', values: ['rest', 'hover'] }],
  };
  /**
   * The laid-out main with one `hover` preset.
   *
   * @param hover - The preset's records.
   * @returns The main.
   */
  const withHover = (hover: InstanceOverrides): BoardObject => ({
    ...laidOut,
    variantPresets: { 'state=rest': {}, 'state=hover': hover },
  });
  board.set(withHover({}));
  for (const instanceId of board.instanceIds) {
    const object = board.objects.get(instanceId);
    if (object?.type === 'instance') board.set({ ...object, variant: { state: 'hover' } });
  }
  const expansion = board.loaded();
  const fills: readonly [number, number, number, number][] = [
    [0.2, 0.3, 0.6, 1],
    [0.6, 0.3, 0.2, 1],
  ];
  let step = 0;

  bench('dependentsOf: a preset recolour (patched in place)', () => {
    step += 1;
    board.set(withHover({ bg: { fill: fills[step % 2] ?? [0, 0, 0, 1] } }));
    expansion.dependentsOf([id('main')], board.shown);
  });

  bench('dependentsOf: a preset resizing a child (every instance resolved)', () => {
    step += 1;
    board.set(withHover({ tag1: { width: step % 2 === 0 ? 50 : 54 } }));
    expansion.dependentsOf([id('main')], board.shown);
  });
});
