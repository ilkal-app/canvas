// Engine acceptance fixtures: plain board
// objects in the shape the schema gives them, components and instances included, built by hand
// with fixed, valid fields.
import type { BoardObject, ObjectId, TextStyle } from '@canvas/schema';

/** Fields a builder adds to or replaces in its object. */
export type Fields = Readonly<Record<string, unknown>>;

/** 24 px Inter, regular, near-black. */
export const BODY: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.12, 1],
  weight: 400,
  italic: false,
};

/**
 * Brands a fixture id.
 *
 * @param value - The id text.
 * @returns The id.
 */
export function id(value: string): ObjectId {
  return value as ObjectId;
}

function build(
  type: string,
  objectId: string,
  parentId: string | null,
  ...parts: Fields[]
): BoardObject {
  const shared: Fields = {
    id: objectId,
    type,
    parentId,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_000_000,
  };
  return parts.reduce<Fields>((all, part) => ({ ...all, ...part }), shared) as BoardObject;
}

/**
 * A 200 by 100 main named "Card", not retired, at the root.
 *
 * @param objectId - Its id.
 * @param fields - Fields to add or replace (`pageId`, `x`, `retired`, `parentId`).
 * @returns The component.
 */
export function component(objectId: string, fields: Fields = {}): BoardObject {
  return build(
    'component',
    objectId,
    null,
    { width: 200, height: 100, name: 'Card', retired: false },
    fields,
  );
}

/**
 * An instance at the main's default 200 by 100 size, without overrides, at the root.
 *
 * @param objectId - Its id.
 * @param mainId - The component it renders.
 * @param fields - Fields to add or replace.
 * @returns The instance.
 */
export function instance(objectId: string, mainId: string, fields: Fields = {}): BoardObject {
  return build(
    'instance',
    objectId,
    null,
    { width: 200, height: 100, mainId, overrides: {} },
    fields,
  );
}

/**
 * A 20 by 20 filled rectangle without stroke or label.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param fields - Fields to add or replace.
 * @returns The shape.
 */
export function shape(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  const defaults = {
    width: 20,
    height: 20,
    kind: 'rectangle',
    stroke: null,
    fill: [0.66, 0.84, 0.98, 1],
  };
  return build(
    'shape',
    objectId,
    parentId,
    defaults,
    { cornerRadius: 0, sides: 4, label: null },
    fields,
  );
}

/**
 * A 40 by 40 sticky reading "Note".
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param fields - Fields to add or replace.
 * @returns The sticky.
 */
export function sticky(
  objectId: string,
  parentId: string | null,
  fields: Fields = {},
): BoardObject {
  const content = {
    text: 'Note',
    runs: [{ length: 4, style: BODY }],
    align: 'center',
    autoWidth: false,
  };
  return build(
    'sticky',
    objectId,
    parentId,
    { width: 40, height: 40, ...content },
    { verticalAlign: 'middle', color: [1, 0.92, 0.55, 1] },
    fields,
  );
}

/**
 * A fixed-width text reading "Hi", 40 by 20.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param fields - Fields to add or replace.
 * @returns The text.
 */
export function text(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  const content = {
    text: 'Hi',
    runs: [{ length: 2, style: BODY }],
    align: 'left',
    autoWidth: false,
  };
  return build(
    'text',
    objectId,
    parentId,
    { width: 40, height: 20, ...content, verticalAlign: 'top' },
    fields,
  );
}

/**
 * A 20 by 20 image of a whole 100 by 100 asset.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param fields - Fields to add or replace.
 * @returns The image.
 */
export function image(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  const crop = { x: 0, y: 0, width: 1, height: 1 };
  return build(
    'image',
    objectId,
    parentId,
    { width: 20, height: 20, assetId: 'asset-photo', crop },
    { naturalSize: { width: 100, height: 100 }, opacity: 1 },
    fields,
  );
}

/**
 * A group; its bounds come from its children.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param fields - Fields to add or replace.
 * @returns The group.
 */
export function group(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  return build('group', objectId, parentId, fields);
}

/**
 * A 100 by 100 frame with a white background, not clipping.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param fields - Fields to add or replace.
 * @returns The frame.
 */
export function frame(objectId: string, parentId: string | null, fields: Fields = {}): BoardObject {
  return build(
    'frame',
    objectId,
    parentId,
    { width: 100, height: 100, name: 'Frame', clip: false, background: [1, 1, 1, 1] },
    fields,
  );
}

/**
 * A straight connector between two objects.
 *
 * @param objectId - Its id.
 * @param parentId - Its parent, or null.
 * @param fromId - The start's object.
 * @param toId - The end's object.
 * @returns The connector.
 */
export function connector(
  objectId: string,
  parentId: string | null,
  fromId: string,
  toId: string,
): BoardObject {
  const stroke = { color: [0.1, 0.1, 0.12, 1], width: 2 };
  const ends = {
    from: { kind: 'object', objectId: fromId, anchor: null },
    to: { kind: 'object', objectId: toId, anchor: null },
  };
  return build('connector', objectId, parentId, ends, {
    route: 'straight',
    stroke,
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  });
}

/**
 * The card main `main` on `pageId` and its children: a frame-backed title shape, a sticky, a
 * text, an image, a group holding a shape, and a connector between the title and the sticky.
 *
 * @param pageId - The main's page, or undefined for the unnamed page.
 * @returns The main and its 8 descendants.
 */
export function cardMain(pageId?: string): BoardObject[] {
  return [
    component('main', pageId === undefined ? {} : { pageId }),
    shape('title', 'main', { x: 10, y: 10, width: 180, height: 20, z: 'a1' }),
    sticky('note', 'main', { x: 10, y: 40, z: 'a2' }),
    text('caption', 'main', { x: 60, y: 40, z: 'a3' }),
    image('photo', 'main', { x: 110, y: 40, z: 'a4' }),
    group('badge', 'main', { x: 150, y: 40, z: 'a5' }),
    shape('dot', 'badge', { x: 0, y: 0, width: 10, height: 10 }),
    connector('link', 'main', 'title', 'note'),
  ];
}
