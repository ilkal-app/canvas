// A mount's peers' selections (item 14 and the owner's staging rulings): one box per
// peer, an object's own or the box round a multi-selection, placed again from the live document
// whenever it changes or a drag moves a selected object, dropped with a deleted object, objects
// not on the board left out, and the model sent only when it changed.
import { describe, expect, it, vi } from 'vitest';

import type { PeerSelectionModel } from '@canvas/engine';
import type { BoardObject, ObjectId } from '@canvas/schema';

import { MAX_OUTLINED_PER_PEER, MountPeerSelection } from './mount-peer-selection.js';
import { PEER_SELECTION_LAYER } from './shell-overlay.js';

/**
 * A rectangle of the board.
 *
 * @param id - Its id.
 * @param x - Its left, world units.
 * @param y - Its top.
 * @param rotation - Its turn, radians.
 * @returns The rectangle.
 */
function rect(id: string, x: number, y: number, rotation = 0): BoardObject {
  return {
    id,
    type: 'shape',
    kind: 'rectangle',
    parentId: null,
    x,
    y,
    rotation,
    width: 40,
    height: 20,
  } as unknown as BoardObject;
}

const MIRA = { clientId: 7, principalId: 'mira', name: 'Mira', color: '#ff0000' } as const;

/**
 * A group of the board.
 *
 * @param id - Its id.
 * @returns The group.
 */
function group(id: string): BoardObject {
  return { id, type: 'group', parentId: null, x: 0, y: 0, rotation: 0 } as unknown as BoardObject;
}

/**
 * A board of objects, with a spatial index that holds every object but a group at its stored
 * place, as the app's index does, and a drag preview the test can lay over an object, as the
 * select tool's source does (the index does not follow it).
 *
 * @param objects - The objects.
 * @param children - Each group's children's ids.
 * @returns The mount, the layers, what reads the last model, and what changes the board.
 */
function setUp(
  objects: readonly BoardObject[],
  children: Readonly<Record<string, readonly string[]>> = {},
) {
  const byId = new Map(objects.map((object) => [object.id as string, object]));
  const previews = new Map<string, BoardObject>();
  const source = {
    get: (id: ObjectId) => previews.get(id) ?? byId.get(id),
    childrenOf: (id: ObjectId) => children[id] ?? [],
  };
  const store = { get: (id: ObjectId) => byId.get(id) };
  const snapIndex = {
    boundsOf: (id: ObjectId) => {
      const object = byId.get(id) as unknown as
        { type: string; x: number; y: number; width: number; height: number } | undefined;
      if (object === undefined || object.type === 'group') return undefined;
      const { x, y, width, height } = object;
      return { minX: x, minY: y, maxX: x + width, maxY: y + height };
    },
  };
  const document = { tools: { services: () => ({ selectTool: { source }, snapIndex, store }) } };
  const layers = { show: vi.fn() };
  const peers = new MountPeerSelection(() => document as never, layers);
  const lastModel = (): PeerSelectionModel =>
    layers.show.mock.calls.at(-1)?.[1] as PeerSelectionModel;
  return { peers, layers, lastModel, byId, previews };
}

describe('MountPeerSelection', () => {
  it('draws one object as its own turned box, with its frame for the tag', () => {
    const { peers, lastModel } = setUp([rect('b', 100, 50, Math.PI / 4)]);
    const [placed] = peers.show([{ ...MIRA, ids: ['b'] }]);
    expect(placed?.frame.rotation).toBeCloseTo(Math.PI / 4, 12);
    expect(placed?.frame).toMatchObject({ x: 100, y: 50, width: 40, height: 20 });
    expect(lastModel().outlines).toEqual([{ box: placed?.frame, color: [1, 0, 0, 1] }]);
  });

  it('draws a multi-selection as one box round it all, never a box per object', () => {
    const { peers, layers, lastModel } = setUp([rect('a', 0, 0), rect('b', 100, 50)]);
    const placed = peers.show([{ ...MIRA, ids: ['a', 'b', 'gone'] }]);
    expect(placed).toHaveLength(1);
    const frame = { x: 0, y: 0, width: 140, height: 70, rotation: 0 };
    expect(placed[0]?.frame).toEqual(frame);
    expect(layers.show.mock.calls[0]?.[0]).toBe(PEER_SELECTION_LAYER);
    expect(lastModel().outlines).toEqual([{ box: frame, color: [1, 0, 0, 1] }]);
  });

  it(`frames more than ${String(MAX_OUTLINED_PER_PEER)} objects from the index, groups by their own box`, () => {
    const shapes = [...Array(MAX_OUTLINED_PER_PEER).keys()].map((index) =>
      rect(`r${String(index)}`, index * 10, 0),
    );
    const groups = [group('g1'), group('g2')];
    const inner = [rect('c1', -100, -50), rect('c2', 2000, 400)];
    const { peers, lastModel } = setUp([...shapes, ...groups, ...inner], {
      g1: ['c1'],
      g2: ['c2'],
    });
    const ids = [...shapes.map((object) => object.id), 'g1', 'g2'];
    const [placed] = peers.show([{ ...MIRA, ids }]);
    expect(lastModel().outlines).toHaveLength(1);
    expect(placed?.frame).toEqual({ x: -100, y: -50, width: 2140, height: 470, rotation: 0 });
  });

  it('places the box again from the live document when an object moves, and tells listeners', () => {
    const { peers, byId, lastModel } = setUp([rect('a', 0, 0)]);
    peers.show([{ ...MIRA, ids: ['a'] }]);
    const listener = vi.fn();
    const stop = peers.subscribe(listener);
    byId.set('a', rect('a', 300, 200));
    peers.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(peers.placements()[0]?.frame).toMatchObject({ x: 300, y: 200 });
    expect(lastModel().outlines[0]?.box).toMatchObject({ x: 300, y: 200 });
    // Nothing moved: no new model, no notice.
    peers.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('follows a drag under way frame by frame, from the select tool’s preview', () => {
    const { peers, previews, lastModel } = setUp([rect('a', 0, 0)]);
    peers.show([{ ...MIRA, ids: ['a'] }]);
    previews.set('a', rect('a', 25, 10));
    peers.refresh();
    expect(lastModel().outlines[0]?.box).toMatchObject({ x: 25, y: 10 });
    previews.set('a', rect('a', 50, 20));
    peers.refresh();
    expect(lastModel().outlines[0]?.box).toMatchObject({ x: 50, y: 20 });
  });

  it(`follows a drag of an edge object past ${String(MAX_OUTLINED_PER_PEER)} objects, though the index does not`, () => {
    const shapes = [...Array(MAX_OUTLINED_PER_PEER + 1).keys()].map((index) =>
      rect(`r${String(index)}`, index * 10, 0),
    );
    const { peers, previews, lastModel } = setUp(shapes);
    peers.show([{ ...MIRA, ids: shapes.map((object) => object.id) }]);
    expect(lastModel().outlines[0]?.box).toEqual({
      x: 0,
      y: 0,
      width: 1040,
      height: 20,
      rotation: 0,
    });
    previews.set('r100', rect('r100', 1000, 300));
    peers.refresh();
    expect(lastModel().outlines[0]?.box).toEqual({
      x: 0,
      y: 0,
      width: 1040,
      height: 320,
      rotation: 0,
    });
  });

  it('follows a dragged group’s child in a large selection, though the child’s record is unchanged', () => {
    const shapes = [...Array(MAX_OUTLINED_PER_PEER).keys()].map((index) =>
      rect(`r${String(index)}`, index * 10, 0),
    );
    const child = { ...rect('c', 0, 0), parentId: 'g' } as unknown as BoardObject;
    const { peers, previews, lastModel } = setUp([...shapes, group('g'), child], { g: ['c'] });
    peers.show([{ ...MIRA, ids: [...shapes.map((object) => object.id), 'c'] }]);
    expect(lastModel().outlines[0]?.box).toMatchObject({ height: 20 });
    previews.set('g', { ...group('g'), y: 500 });
    peers.refresh();
    expect(lastModel().outlines[0]?.box).toMatchObject({ y: 0, height: 520 });
  });

  it('drops the box when the selected object is deleted, leaving no trace', () => {
    const { peers, byId, lastModel } = setUp([rect('a', 0, 0)]);
    peers.show([{ ...MIRA, ids: ['a'] }]);
    byId.delete('a');
    peers.refresh();
    expect(peers.placements()).toEqual([]);
    expect(lastModel()).toEqual({ outlines: [] });
  });

  it('leaves out a peer none of whose objects is on the board, and sends nothing at rest', () => {
    const { peers, layers } = setUp([rect('a', 0, 0)]);
    expect(peers.show([])).toEqual([]);
    expect(peers.show([{ ...MIRA, ids: ['gone'] }])).toEqual([]);
    peers.refresh();
    expect(layers.show).not.toHaveBeenCalled();
  });

  it('sends the model again only when it changed, and the empty model once the last peer goes', () => {
    const { peers, layers, lastModel } = setUp([rect('a', 0, 0), rect('b', 60, 0)]);
    peers.show([{ ...MIRA, ids: ['a'] }]);
    peers.show([{ ...MIRA, ids: ['a'] }]);
    expect(layers.show).toHaveBeenCalledTimes(1);
    peers.show([
      { ...MIRA, ids: ['a'] },
      { ...MIRA, clientId: 8, principalId: 'bo', color: '#0000ff', ids: ['b'] },
    ]);
    expect(layers.show).toHaveBeenCalledTimes(2);
    expect(lastModel().outlines.map(({ color }) => color)).toEqual([
      [1, 0, 0, 1],
      [0, 0, 1, 1],
    ]);
    peers.show([]);
    expect(lastModel()).toEqual({ outlines: [] });
  });
});
