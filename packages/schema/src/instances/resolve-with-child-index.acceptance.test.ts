import { describe, expect, it } from 'vitest';

import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import {
  asBoardObject,
  boardOf,
  component,
  instance,
  instanceChain,
  mainChildren,
  shape,
} from './__fixtures__/component-board.js';
import { constrainChildren } from './constrain-children.js';
import { resolveInstance, type ResolvedInstance } from './resolve-instance.js';

// Engine acceptance: the engine
// resolves many instances per change, so `resolveInstance` and `constrainChildren` take an
// optional `ChildIndex` and, given one, never walk the whole board: every object they need is
// read by id. The board here answers `get` and `has` and throws on any iteration.

/** `resolveInstance` with the optional index the contract adds. */
const resolveWith: (
  board: Board,
  instance: InstanceObject,
  children?: ChildIndex,
) => ResolvedInstance = resolveInstance;

/** `constrainChildren` with the optional index the contract adds. */
const constrainWith: (
  board: Board,
  parent: BoardObject,
  to: { readonly width: number; readonly height: number },
  children?: ChildIndex,
) => readonly BoardObject[] = constrainChildren;

/**
 * The board read by id only: iteration throws, naming the method.
 *
 * @param board - The whole board.
 * @returns A board whose objects answer `get` and `has` alone.
 */
function readByIdOnly(board: Board): Board {
  const refuse = (method: string) => () => {
    throw new Error(`whole-board iteration: ${method}`);
  };
  const objects = {
    get: (key: ObjectId) => board.objects.get(key),
    has: (key: ObjectId) => board.objects.has(key),
    get size(): number {
      return refuse('size')();
    },
    keys: refuse('keys'),
    values: refuse('values'),
    entries: refuse('entries'),
    forEach: refuse('forEach'),
    [Symbol.iterator]: refuse('iterator'),
  };
  return { objects };
}

/**
 * Every kind of main child, a resized instance `card` with overrides, a three-level chain
 * (root instance `inst`, nested `i2`) and 50 unrelated shapes.
 *
 * @returns The board.
 */
function richBoard(): Board {
  return boardOf([
    component('main'),
    ...mainChildren('main').map((child) =>
      child.id === 'child-b' ? { ...child, constraints: { x: 'stretch', y: 'end' } } : child,
    ),
    instance('card', 'main', {
      x: 500,
      width: 320,
      height: 180,
      overrides: { sticky: { text: 'Changed' }, group: { isHidden: true } },
    }),
    ...instanceChain(3),
    ...[...Array<undefined>(50).keys()].map((index) => shape(`noise-${String(index)}`, null)),
  ]);
}

function instanceOf(board: Board, key: string): InstanceObject {
  const object = board.objects.get(key as ObjectId);
  if (object?.type !== 'instance') throw new Error(`no instance "${key}"`);
  return object;
}

describe('resolveInstance with a child index', () => {
  it('resolves by id alone, exactly as over the whole board', () => {
    const board = richBoard();
    const children = buildChildIndex(board);
    for (const key of ['card', 'inst', 'i2']) {
      const target = instanceOf(board, key);
      expect(resolveWith(readByIdOnly(board), target, children)).toEqual(
        resolveInstance(board, target),
      );
    }
  });

  it('constrains children by id alone, exactly as over the whole board', () => {
    const board = richBoard();
    const main = board.objects.get('main' as ObjectId);
    if (main === undefined) throw new Error('the board has a main');
    const to = { width: 360, height: 60 };
    expect(constrainWith(readByIdOnly(board), main, to, buildChildIndex(board))).toEqual(
      constrainChildren(board, main, to),
    );
  });

  it('resolves the same over a board holding only the reachable definitions (control)', () => {
    const board = richBoard();
    const reachable = boardOf(
      [...board.objects.values()]
        .filter((object) => !object.id.startsWith('noise-'))
        .map(asBoardObject),
    );
    const target = instanceOf(board, 'card');
    expect(resolveInstance(reachable, target)).toEqual(resolveInstance(board, target));
  });
});
