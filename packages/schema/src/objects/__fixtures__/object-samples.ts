import type { Stroke } from '../../fields/stroke.js';
import type { TextStyle } from '../../fields/text-style.js';
import type { AssetId } from '../../ids/asset-id.js';
import type { ObjectId } from '../../ids/object-id.js';
import type { PrincipalId } from '../../ids/principal-id.js';
import type { BaseObject } from '../base-object.js';
import type { BoardObjectOf } from '../board-object.js';
import type { ObjectType } from '../object-type.js';

/** Style of the fixture text: 24 px Inter, near-black, regular. */
export const SAMPLE_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0.1, 0.1, 0.1, 1],
  weight: 400,
  italic: false,
};

/** A thin black stroke. */
export const SAMPLE_STROKE: Stroke = { color: [0, 0, 0, 1], width: 2 };

/**
 * The shared fields with fixed, valid values, for building sample objects in tests.
 *
 * @param id - The object's id.
 * @returns The shared fields of an unlocked, unrotated root object at (10, 20).
 */
export function sampleSharedFields(id: string): Omit<BaseObject, 'type'> {
  return {
    id: id as ObjectId,
    parentId: null,
    x: 10,
    y: 20,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

/** The type-specific fields of one valid sample of each object type. */
const SAMPLE_FIELDS: {
  [Type in ObjectType]: Omit<BoardObjectOf<Type>, Exclude<keyof BaseObject, 'name'>>;
} = {
  component: { width: 200, height: 100, name: 'Card', retired: false },
  instance: { width: 200, height: 100, mainId: 'sample-component' as ObjectId, overrides: {} },
  text: {
    width: 200,
    height: 30,
    text: 'Hello',
    runs: [{ length: 5, style: SAMPLE_STYLE }],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  },
  sticky: {
    width: 200,
    height: 200,
    text: '',
    runs: [{ length: 0, style: SAMPLE_STYLE }],
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
  },
  image: {
    width: 320,
    height: 240,
    assetId: 'asset-photo' as AssetId,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    naturalSize: { width: 1600, height: 1200 },
    opacity: 1,
  },
  video: {
    width: 640,
    height: 360,
    assetId: 'asset-clip' as AssetId,
    poster: null,
    loop: false,
    muted: true,
    trim: null,
  },
  shape: {
    width: 100,
    height: 80,
    kind: 'rectangle',
    stroke: SAMPLE_STROKE,
    fill: null,
    cornerRadius: 0,
    sides: 4,
    label: null,
  },
  line: {
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    route: 'straight',
    stroke: SAMPLE_STROKE,
    startCap: 'none',
    endCap: 'arrow',
  },
  connector: {
    from: { kind: 'point', x: 0, y: 0 },
    to: { kind: 'point', x: 50, y: 50 },
    route: 'straight',
    stroke: SAMPLE_STROKE,
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  },
  path: { vertices: [], segments: [], stroke: SAMPLE_STROKE, fill: null },
  freehand: { tool: 'pencil', points: [0, 0, 10, 4], stroke: SAMPLE_STROKE },
  group: {},
  frame: { width: 800, height: 600, name: 'Frame', clip: true, background: null },
  comment: { threadId: 'thread-1', anchor: { kind: 'point' } },
  link: {
    width: 320,
    height: 240,
    url: 'https://example.com/',
    title: 'Example',
    description: '',
    siteName: '',
    layout: 'vertical',
    status: 'pending',
    unfurlKey: 'sample-paste',
  },
};

/**
 * Builds a valid sample object of any type, for tests: the shared fields of
 * {@link sampleSharedFields}, the type's sample fields, then `overrides`.
 *
 * @param type - The object type.
 * @param id - The object's id.
 * @param overrides - Fields to replace, including shared ones such as `parentId`.
 * @returns A new object that passes its type's schema unless `overrides` break it.
 */
export function sampleObject<Type extends ObjectType>(
  type: Type,
  id: string,
  overrides: Partial<BoardObjectOf<Type>> = {},
): BoardObjectOf<Type> {
  // TypeScript cannot correlate `type` with `SAMPLE_FIELDS[type]` across the spread, so the
  // result is asserted; the board-object test checks every sample against its schema.
  const sample: unknown = { ...sampleSharedFields(id), type, ...SAMPLE_FIELDS[type], ...overrides };
  return sample as BoardObjectOf<Type>;
}
