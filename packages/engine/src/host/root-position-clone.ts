import type { BoardObject } from '@canvas/schema';

type PositionClone = (x: number, y: number) => BoardObject;
const BASE_KEYS = [
  'id',
  'type',
  'parentId',
  'x',
  'y',
  'rotation',
  'z',
  'locked',
  'createdBy',
  'createdAt',
  'updatedAt',
];
const KEYS: Partial<Record<BoardObject['type'], readonly string[]>> = {
  sticky: [
    ...BASE_KEYS,
    'width',
    'height',
    'text',
    'runs',
    'align',
    'verticalAlign',
    'autoWidth',
    'color',
  ],
  text: [...BASE_KEYS, 'width', 'height', 'text', 'runs', 'align', 'verticalAlign', 'autoWidth'],
  shape: [
    ...BASE_KEYS,
    'width',
    'height',
    'kind',
    'stroke',
    'fill',
    'cornerRadius',
    'sides',
    'label',
  ],
  image: [...BASE_KEYS, 'width', 'height', 'assetId', 'crop', 'naturalSize', 'opacity'],
  path: [...BASE_KEYS, 'vertices', 'segments', 'stroke', 'fill'],
};

/**
 * Selects a literal copier once for immutable retained geometry; unusual shapes use spread.
 *
 * @param object - The session base object, never mutated during retention.
 * @returns A copier preserving spread property order, values and nested references.
 */
export function rootPositionClone(object: BoardObject): PositionClone {
  const type = Object.getOwnPropertyDescriptor(object, 'type');
  const keys =
    type && Object.hasOwn(type, 'value') ? KEYS[type.value as BoardObject['type']] : undefined;
  if (!keys || !isCanonical(object, keys)) return (x, y) => ({ ...object, x, y });
  switch (object.type) {
    case 'sticky':
      return cloneSticky(object);
    case 'text':
      return cloneText(object);
    case 'shape':
      return cloneShape(object);
    case 'image':
      return cloneImage(object);
    case 'path':
      return clonePath(object);
    default:
      return (x, y) => ({ ...object, x, y });
  }
}

function cloneSticky(object: Extract<BoardObject, { type: 'sticky' }>): PositionClone {
  return (x, y) => ({
    id: object.id,
    type: object.type,
    parentId: object.parentId,
    x: x,
    y: y,
    rotation: object.rotation,
    z: object.z,
    locked: object.locked,
    createdBy: object.createdBy,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    width: object.width,
    height: object.height,
    text: object.text,
    runs: object.runs,
    align: object.align,
    verticalAlign: object.verticalAlign,
    autoWidth: object.autoWidth,
    color: object.color,
  });
}

function cloneText(object: Extract<BoardObject, { type: 'text' }>): PositionClone {
  return (x, y) => ({
    id: object.id,
    type: object.type,
    parentId: object.parentId,
    x: x,
    y: y,
    rotation: object.rotation,
    z: object.z,
    locked: object.locked,
    createdBy: object.createdBy,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    width: object.width,
    height: object.height,
    text: object.text,
    runs: object.runs,
    align: object.align,
    verticalAlign: object.verticalAlign,
    autoWidth: object.autoWidth,
  });
}

function cloneShape(object: Extract<BoardObject, { type: 'shape' }>): PositionClone {
  return (x, y) => ({
    id: object.id,
    type: object.type,
    parentId: object.parentId,
    x: x,
    y: y,
    rotation: object.rotation,
    z: object.z,
    locked: object.locked,
    createdBy: object.createdBy,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    width: object.width,
    height: object.height,
    kind: object.kind,
    stroke: object.stroke,
    fill: object.fill,
    cornerRadius: object.cornerRadius,
    sides: object.sides,
    label: object.label,
  });
}

function cloneImage(object: Extract<BoardObject, { type: 'image' }>): PositionClone {
  return (x, y) => ({
    id: object.id,
    type: object.type,
    parentId: object.parentId,
    x: x,
    y: y,
    rotation: object.rotation,
    z: object.z,
    locked: object.locked,
    createdBy: object.createdBy,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    width: object.width,
    height: object.height,
    assetId: object.assetId,
    crop: object.crop,
    naturalSize: object.naturalSize,
    opacity: object.opacity,
  });
}

function clonePath(object: Extract<BoardObject, { type: 'path' }>): PositionClone {
  return (x, y) => ({
    id: object.id,
    type: object.type,
    parentId: object.parentId,
    x: x,
    y: y,
    rotation: object.rotation,
    z: object.z,
    locked: object.locked,
    createdBy: object.createdBy,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    vertices: object.vertices,
    segments: object.segments,
    stroke: object.stroke,
    fill: object.fill,
  });
}

function isCanonical(object: BoardObject, keys: readonly string[]): boolean {
  if (Object.getPrototypeOf(object) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(object);
  return (
    actual.length === keys.length &&
    keys.every((key, index) => {
      if (actual[index] !== key) return false;
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  );
}
