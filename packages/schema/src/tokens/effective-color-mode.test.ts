import { describe, expect, it } from 'vitest';

import { createBoard } from '../board/board.js';
import type { ObjectId } from '../ids/object-id.js';
import {
  component,
  frame,
  group,
  instance,
  shape,
} from '../instances/__fixtures__/component-board.js';
import { resolveInstance } from '../instances/resolve-instance.js';
import type { BoardObject } from '../objects/board-object.js';

import { effectiveColorMode } from './effective-color-mode.js';

/**
 * Reads a stored object of a test board.
 *
 * @param board - The board.
 * @param board.objects - Its objects.
 * @param id - The id.
 * @returns The object.
 * @throws {Error} When the board has none.
 */
function objectOf(
  board: { readonly objects: ReadonlyMap<ObjectId, BoardObject> },
  id: string,
): BoardObject {
  const found = board.objects.get(id as ObjectId);
  if (found === undefined) throw new Error(`no object ${id}`);
  return found;
}

/**
 * Finds a resolved virtual object by its virtual id.
 *
 * @param objects - The resolved content.
 * @param id - The virtual id.
 * @returns The object.
 * @throws {Error} When there is none.
 */
function virtual(objects: readonly BoardObject[], id: string): BoardObject {
  const found = objects.find((object) => object.id === id);
  if (found === undefined) throw new Error(`no virtual object ${id}`);
  return found;
}

describe('effectiveColorMode', () => {
  it('takes the nearest frame with a mode, else the fallback hook, else the viewer theme', () => {
    const board = createBoard([
      frame('outer', null, { colorMode: 'dark' }),
      frame('inner', 'outer', { colorMode: 'light' }),
      group('g', 'inner'),
      shape('deep', 'g'),
      frame('plain', null),
      shape('loose', 'plain'),
    ]);
    const get = (id: string) => objectOf(board, id);
    expect(effectiveColorMode(get('deep'), board, { viewerTheme: 'dark' })).toBe('light');
    expect(effectiveColorMode(get('inner'), board)).toBe('light');
    expect(effectiveColorMode(get('outer'), board)).toBe('dark');
    expect(effectiveColorMode(get('loose'), board)).toBeUndefined();
    expect(effectiveColorMode(get('loose'), board, { viewerTheme: 'dark' })).toBe('dark');
    const fallbackMode = () => 'light' as const;
    expect(effectiveColorMode(get('loose'), board, { viewerTheme: 'dark', fallbackMode })).toBe(
      'light',
    );
    expect(
      effectiveColorMode(get('deep'), board, { viewerTheme: 'dark', fallbackMode: () => 'dark' }),
    ).toBe('light');
  });

  it("applies a main's mode to its content and to instances that set none", () => {
    const board = createBoard([
      component('m', { colorMode: 'dark' }),
      shape('child', 'm'),
      instance('plain', 'm'),
      instance('lit', 'm', { colorMode: 'light' }),
      frame('host', null, { colorMode: 'light' }),
      instance('hosted', 'm', { parentId: 'host' }),
    ]);
    const get = (id: string) => objectOf(board, id);
    expect(effectiveColorMode(get('child'), board)).toBe('dark');
    expect(effectiveColorMode(get('plain'), board)).toBe('dark');
    const plain = resolveInstance(board, get('plain') as never).objects;
    expect(effectiveColorMode(virtual(plain, 'plain/child'), board)).toBe('dark');
    const lit = resolveInstance(board, get('lit') as never).objects;
    expect(effectiveColorMode(virtual(lit, 'lit/child'), board)).toBe('light');
    // The main's own setting is nearer than the frame holding the instance.
    const hosted = resolveInstance(board, get('hosted') as never).objects;
    expect(effectiveColorMode(virtual(hosted, 'hosted/child'), board)).toBe('dark');
  });

  it("walks virtual content through the instance to the instance's ancestors", () => {
    const board = createBoard([
      component('m'),
      frame('panel', 'm'),
      shape('leaf', 'panel'),
      frame('night', null, { colorMode: 'dark' }),
      instance('i', 'm', { parentId: 'night' }),
    ]);
    const get = (id: string) => objectOf(board, id);
    const content = resolveInstance(board, get('i') as never).objects;
    expect(effectiveColorMode(virtual(content, 'i/leaf'), board, { viewerTheme: 'light' })).toBe(
      'dark',
    );
    expect(effectiveColorMode(get('leaf'), board, { viewerTheme: 'light' })).toBe('light');
  });

  it("lets a frame inside the main win over the instance's mode", () => {
    const board = createBoard([
      component('m'),
      frame('panel', 'm', { colorMode: 'light' }),
      shape('leaf', 'panel'),
      instance('i', 'm', { colorMode: 'dark' }),
    ]);
    const content = resolveInstance(board, board.objects.get('i' as ObjectId) as never).objects;
    expect(effectiveColorMode(virtual(content, 'i/leaf'), board)).toBe('light');
  });

  it('walks virtual content up through frames nested inside the main', () => {
    const board = createBoard([
      component('m'),
      frame('outer', 'm', { colorMode: 'dark' }),
      frame('panel', 'outer'),
      shape('leaf', 'panel'),
      instance('i', 'm'),
    ]);
    const content = resolveInstance(board, board.objects.get('i' as ObjectId) as never).objects;
    // i/leaf's parent is i/panel, whose source parent is a frame of the main: the walk goes on to
    // i/outer, which sets the mode, not to the instance.
    expect(effectiveColorMode(virtual(content, 'i/leaf'), board, { viewerTheme: 'light' })).toBe(
      'dark',
    );
  });

  it('walks nested instances through each instance and its main', () => {
    const board = createBoard([
      component('inner'),
      shape('dot', 'inner'),
      component('outer', { colorMode: 'light' }),
      instance('nested', 'inner', { parentId: 'outer' }),
      instance('top', 'outer', { colorMode: 'dark' }),
      instance('bare', 'outer'),
    ]);
    const get = (id: string) => objectOf(board, id);
    const top = resolveInstance(board, get('top') as never).objects;
    expect(effectiveColorMode(virtual(top, 'top/nested/dot'), board)).toBe('dark');
    const bare = resolveInstance(board, get('bare') as never).objects;
    expect(effectiveColorMode(virtual(bare, 'bare/nested/dot'), board)).toBe('light');
  });

  it('ends a walk at a missing parent or a loop', () => {
    const looped = createBoard([frame('a', 'b'), frame('b', 'a'), shape('s', 'a')]);
    expect(effectiveColorMode(objectOf(looped, 's'), looped)).toBeUndefined();
    const orphan = createBoard([shape('s', 'gone')]);
    expect(effectiveColorMode(objectOf(orphan, 's'), orphan, { viewerTheme: 'dark' })).toBe('dark');
  });

  it('takes the viewer theme as a bare third argument', () => {
    const board = createBoard([
      frame('f', null, { colorMode: 'dark' }),
      shape('in', 'f'),
      shape('out', null),
    ]);
    expect(effectiveColorMode(objectOf(board, 'in'), board, 'light')).toBe('dark');
    expect(effectiveColorMode(objectOf(board, 'out'), board, 'dark')).toBe('dark');
    expect(effectiveColorMode(objectOf(board, 'out'), board, 'light')).toBe('light');
  });
});
