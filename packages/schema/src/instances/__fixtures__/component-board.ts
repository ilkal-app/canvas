import { createBoard, type Board } from '../../board/board.js';
import type { Rgba } from '../../fields/color.js';
import type { Stroke } from '../../fields/stroke.js';
import type { TextStyle } from '../../fields/text-style.js';
import type { ObjectId } from '../../ids/object-id.js';
import type { BoardObject } from '../../objects/board-object.js';
import type { Page } from '../../pages/page.js';

import type { ComponentObject, InstanceObject } from './expected-api.js';

// Acceptance fixtures: plain objects in the shape the contract gives components,
// instances and constrained children. Built by hand rather
// than parsed, so they exist before the schemas do; the acceptance tests parse them.

/** Fields a builder adds to or replaces in its object, such as `constraints` or `x`. */
export type Fields = Readonly<Record<string, unknown>>;

/** The fixture ink: near-black. */
export const INK: Rgba = [0.1, 0.1, 0.12, 1];

/** The fixture text style: 24 px Inter, regular. */
export const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: INK,
  weight: 400,
  italic: false,
};

/** The fixture outline: 2 px ink. */
export const OUTLINE: Stroke = { color: INK, width: 2 };

/** The fixture sticky colour: pale yellow. */
export const STICKY_COLOR: Rgba = [1, 0.92, 0.55, 1];

/** The fixture fill: pale blue. */
export const FILL: Rgba = [0.66, 0.84, 0.98, 1];

/** When every fixture object was created and last changed, ms since the Unix epoch. */
export const FIXTURE_TIME = 1_760_000_000_000;

/**
 * Reads a fixture id as an object id; every fixture id matches the id pattern.
 *
 * @param value - The id text.
 * @returns The id, branded.
 */
export function id(value: string): ObjectId {
  return value as ObjectId;
}

/**
 * The fields every fixture object shares: unrotated, unlocked, at the origin, created by Ada.
 *
 * @param objectId - The object's id.
 * @param type - The object type, including the two adds.
 * @param parentId - The parent, or `null` for the board root.
 * @returns The shared fields.
 */
function shared(objectId: string, type: string, parentId: string | null): Fields {
  return {
    id: id(objectId),
    type,
    parentId: parentId === null ? null : id(parentId),
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada',
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  };
}

/**
 * Builds a fixture object of some shape from its parts, without validating it: the acceptance
 * tests parse the results against the schemas.
 *
 * @param parts - The object's fields, later parts replacing earlier ones.
 * @returns The object, for the caller to assert to its shape.
 */
function build(...parts: readonly Fields[]): object {
  return parts.reduce<Fields>((all, part) => ({ ...all, ...part }), {});
}

/**
 * A component: a 200 by 100 main named "Card", not retired, at the board root.
 *
 * @param objectId - The component's id.
 * @param fields - Fields to add or replace.
 * @returns The component.
 */
export function component(objectId: string, fields: Fields = {}): ComponentObject {
  return build(
    shared(objectId, 'component', null),
    { width: 200, height: 100, name: 'Card', retired: false },
    fields,
  ) as ComponentObject;
}

/**
 * An instance of a main: the main's default 200 by 100 size, no overrides, at the board root.
 *
 * @param objectId - The instance's id.
 * @param mainId - The component it renders.
 * @param fields - Fields to add or replace, such as `overrides` or `width`.
 * @returns The instance.
 */
export function instance(objectId: string, mainId: string, fields: Fields = {}): InstanceObject {
  return build(
    shared(objectId, 'instance', null),
    { width: 200, height: 100, mainId: id(mainId), overrides: {} },
    fields,
  ) as InstanceObject;
}

/**
 * A 20 by 20 outlined, filled rectangle without a label.
 *
 * @param objectId - The shape's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fields - Fields to add or replace.
 * @returns The shape.
 */
export function shape(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  const defaults = { width: 20, height: 20, kind: 'rectangle', stroke: OUTLINE, fill: FILL };
  return build(
    shared(objectId, 'shape', parentId),
    { ...defaults, cornerRadius: 0, sides: 4, label: null },
    fields,
  ) as BoardObject;
}

/**
 * A 20 by 20 sticky note reading "Note".
 *
 * @param objectId - The sticky's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fields - Fields to add or replace.
 * @returns The sticky.
 */
export function sticky(
  objectId: string,
  parentId: string | null,
  fields: Fields = {},
): BoardObject {
  const content = { text: 'Note', runs: [{ length: 4, style: BODY }] };
  return build(
    shared(objectId, 'sticky', parentId),
    { width: 20, height: 20, ...content, align: 'center', autoWidth: false },
    { verticalAlign: 'middle', color: STICKY_COLOR },
    fields,
  ) as BoardObject;
}

/**
 * An auto-width text reading "Hi", 20 by 10.
 *
 * @param objectId - The text's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fields - Fields to add or replace.
 * @returns The text object.
 */
export function text(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  const content = { text: 'Hi', runs: [{ length: 2, style: BODY }] };
  return build(
    shared(objectId, 'text', parentId),
    { width: 20, height: 10, ...content, align: 'left', autoWidth: true, verticalAlign: 'top' },
    fields,
  ) as BoardObject;
}

/**
 * A 20 by 20 image showing all of a 100 by 100 asset.
 *
 * @param objectId - The image's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fields - Fields to add or replace.
 * @returns The image.
 */
export function image(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  return build(
    shared(objectId, 'image', parentId),
    { width: 20, height: 20, assetId: 'asset-photo', crop: { x: 0, y: 0, width: 1, height: 1 } },
    { naturalSize: { width: 100, height: 100 }, opacity: 1 },
    fields,
  ) as BoardObject;
}

/**
 * A straight line from its origin to (20, 10) in its own frame.
 *
 * @param objectId - The line's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fields - Fields to add or replace.
 * @returns The line.
 */
export function line(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 10 },
  ];
  return build(
    shared(objectId, 'line', parentId),
    { points, route: 'straight', stroke: OUTLINE, startCap: 'none', endCap: 'arrow' },
    fields,
  ) as BoardObject;
}

/**
 * A path of one straight segment from its origin to (20, 0).
 *
 * @param objectId - The path's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fields - Fields to add or replace.
 * @returns The path.
 */
export function path(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  const vertices = [
    { id: 'v1', x: 0, y: 0, mirror: 'none' },
    { id: 'v2', x: 20, y: 0, mirror: 'none' },
  ];
  const segments = [{ id: 's1', a: 'v1', b: 'v2', ha: { x: 0, y: 0 }, hb: { x: 0, y: 0 } }];
  return build(
    shared(objectId, 'path', parentId),
    { vertices, segments, stroke: OUTLINE, fill: null },
    fields,
  ) as BoardObject;
}

/**
 * A group; its bounds come from its children.
 *
 * @param objectId - The group's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fields - Fields to add or replace.
 * @returns The group.
 */
export function group(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  return build(shared(objectId, 'group', parentId), fields) as BoardObject;
}

/**
 * A 20 by 50 frame named "Inner", not clipping, without a background.
 *
 * @param objectId - The frame's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fields - Fields to add or replace.
 * @returns The frame.
 */
export function frame(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  return build(
    shared(objectId, 'frame', parentId),
    { width: 20, height: 50, name: 'Inner', clip: false, background: null },
    fields,
  ) as BoardObject;
}

/**
 * A straight connector attached to two objects: leaving the middle of the first's right edge,
 * arriving wherever the router picks on the second.
 *
 * @param objectId - The connector's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param fromId - The object the start is attached to.
 * @param toId - The object the end is attached to.
 * @param fields - Fields to add or replace.
 * @returns The connector.
 */
export function connector(
  objectId: string,
  parentId: string | null,
  fromId: string,
  toId: string,
  fields: Fields = {},
): BoardObject {
  return build(
    shared(objectId, 'connector', parentId),
    {
      from: { kind: 'object', objectId: id(fromId), anchor: { x: 1, y: 0.5 } },
      to: { kind: 'object', objectId: id(toId), anchor: null },
      route: 'straight',
      stroke: OUTLINE,
      startCap: 'none',
      endCap: 'arrow',
      label: null,
    },
    fields,
  ) as BoardObject;
}

/**
 * A comment pinned to an object, at (10, 10) in that object's frame.
 *
 * @param objectId - The comment's id.
 * @param parentId - The parent, or `null` for the board root.
 * @param anchorId - The object the pin sits on.
 * @param fields - Fields to add or replace.
 * @returns The comment.
 */
export function comment(
  objectId: string,
  parentId: string | null,
  anchorId: string,
  fields: Fields = {},
): BoardObject {
  return build(
    shared(objectId, 'comment', parentId),
    {
      threadId: `thread-${objectId}`,
      anchor: { kind: 'object', objectId: id(anchorId), offset: { x: 10, y: 10 } },
    },
    fields,
  ) as BoardObject;
}

/**
 * Every kind of child a main may hold, placed inside the 200 by 100 main `mainId`: two labelled
 * and unlabelled shapes joined by a connector, a sticky, an auto-width text, an image, a line, a
 * path, a group holding a shape, a nested frame holding a shape, and a comment on a shape.
 *
 * @param mainId - The main the children belong to.
 * @returns The children, in no particular order.
 */
export function mainChildren(mainId = 'main'): BoardObject[] {
  const label = { text: 'A', runs: [{ length: 1, style: BODY }] };
  return [
    shape('child-a', mainId, { x: 30, y: 10, z: 'a0', label }),
    shape('child-b', mainId, { x: 100, y: 10, z: 'a1' }),
    sticky('sticky', mainId, { x: 30, y: 40, z: 'a2' }),
    text('text', mainId, { x: 60, y: 40, z: 'a3' }),
    image('image', mainId, { x: 120, y: 40, z: 'a4' }),
    line('line', mainId, { x: 30, y: 70, z: 'a5' }),
    path('path', mainId, { x: 150, y: 70, z: 'a6' }),
    group('group', mainId, { x: 30, y: 10, z: 'a7' }),
    shape('grouped', 'group', { x: 0, y: 0 }),
    frame('inner', mainId, { x: 30, y: 10, z: 'a8' }),
    shape('framed', 'inner', { x: 5, y: 0, width: 10, height: 10 }),
    connector('conn', mainId, 'child-a', 'child-b', { z: 'a9' }),
    comment('comment', mainId, 'child-a', { z: 'aA' }),
  ];
}

/**
 * A chain of nested instances `depth` long: mains `m1` to `m<depth>`, a shape `leaf` in `m1`,
 * an instance `i<k>` of `m<k>` inside `m<k + 1>`, and a root instance `inst` of `m<depth>`, so
 * `inst` expands through `depth` instances before reaching `leaf`.
 *
 * @param depth - How many instances `inst` expands through, at least 1.
 * @returns The objects of the chain.
 */
export function instanceChain(depth: number): BoardObject[] {
  const objects: BoardObject[] = [shape('leaf', 'm1', { x: 30, y: 10 })];
  for (let level = 1; level <= depth; level += 1) {
    objects.push(asBoardObject(component(`m${String(level)}`, { x: level * 300 })));
    if (level < depth) {
      const nested = instance(`i${String(level)}`, `m${String(level)}`, {
        parentId: id(`m${String(level + 1)}`),
      });
      objects.push(asBoardObject(nested));
    }
  }
  objects.push(asBoardObject(instance('inst', `m${String(depth)}`, { x: -300 })));
  return objects;
}

/**
 * Reads a component, instance or other fixture value as a board object, so it can enter a board.
 *
 * @param value - The object.
 * @returns The same value, typed as a board object.
 */
export function asBoardObject(value: object): BoardObject {
  return value as BoardObject;
}

/**
 * Builds a board from fixture objects, components and instances included.
 *
 * @param objects - The objects, each with a distinct id.
 * @param pages - The board's pages; none for a board of the default page only.
 * @returns The board.
 */
export function boardOf(objects: readonly object[], pages?: readonly Page[]): Board {
  return createBoard(objects.map(asBoardObject), pages);
}
