import { createBoard, type Board } from '../../board/board.js';
import type { AssetId } from '../../ids/asset-id.js';
import type { ObjectId } from '../../ids/object-id.js';
import type { PrincipalId } from '../../ids/principal-id.js';
import type { BoardObject } from '../../objects/board-object.js';
import { DEFAULT_PAGE } from '../../pages/page.js';

/**
 * Reads a fixture id as an object id; every fixture id matches the id pattern.
 *
 * @param value - The id text.
 * @returns The id, branded.
 */
function id(value: string): ObjectId {
  return value as ObjectId;
}

/**
 * Reads a fixture asset id as an asset id.
 *
 * @param value - The asset id text.
 * @returns The asset id, branded.
 */
function asset(value: string): AssetId {
  return value as AssetId;
}

const INK = [0.1, 0.1, 0.12, 1] as [number, number, number, number];
const BODY = { fontFamily: 'Inter', fontSize: 24, color: INK, weight: 400, italic: false } as const;
const BOLD = { ...BODY, weight: 700 } as const;
const OUTLINE = { color: INK, width: 2 };

/**
 * The shared fields of a fixture object: created by Ada at a fixed time, unlocked, unrotated.
 *
 * @param objectId - The object's id.
 * @param z - The object's fractional-index key.
 * @param parentId - The object's parent, or `null` for the root.
 * @returns The shared fields, without `type`.
 */
function shared(
  objectId: string,
  z: string,
  parentId: string | null = null,
): Omit<BoardObject, 'type'> & {
  parentId: ObjectId | null;
} {
  return {
    id: id(objectId),
    parentId: parentId === null ? null : id(parentId),
    pageId: parentId === null ? DEFAULT_PAGE.id : null,
    x: 0,
    y: 0,
    rotation: 0,
    z,
    locked: false,
    createdBy: 'user:ada' as PrincipalId,
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_500_000,
  };
}

// @canvas/document repeats these objects as portable JSON for its Yjs round-trip and sync tests
// (packages/document/src/codec/__fixtures__/fixture-board-json.ts); keep the two in step.
// The sync fuzz harness (tooling/sync-fuzz) converges concurrent edits on every one of these types.

/**
 * The objects of the fixture board: at least one of every object type, nested (a group inside a
 * frame), attached (a connector between two objects, comments on an object and on a point) and with
 * non-default values in every optional structure (rich runs, a crop, a trim, a curved path, a
 * rotated and locked object).
 */
const FIXTURE_OBJECTS: BoardObject[] = [
  {
    ...shared('component-card', 'a8'),
    type: 'component',
    width: 200,
    height: 100,
    name: 'Card',
    retired: false,
  },
  {
    ...shared('instance-card', 'a9'),
    type: 'instance',
    x: 2000,
    width: 200,
    height: 100,
    mainId: id('component-card'),
    overrides: {},
  },
  {
    ...shared('frame-plan', 'a0'),
    type: 'frame',
    x: -400,
    y: -300,
    width: 1200,
    height: 900,
    name: 'Launch plan',
    clip: true,
    background: [1, 1, 1, 1],
  },
  {
    ...shared('text-title', 'a0', 'frame-plan'),
    type: 'text',
    x: 40,
    y: 40,
    width: 320,
    height: 34,
    text: 'Launch plan v2',
    runs: [
      { length: 12, style: BOLD },
      { length: 2, style: { ...BODY, color: [0.8, 0.1, 0.1, 1] } },
    ],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  },
  {
    ...shared('sticky-idea', 'a1', 'frame-plan'),
    type: 'sticky',
    x: 40,
    y: 120,
    width: 200,
    height: 200,
    text: 'Ship the beta 😀',
    runs: [{ length: 16, style: BODY }],
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
  },
  { ...shared('group-diagram', 'a2', 'frame-plan'), type: 'group', x: 400, y: 120, rotation: 0.25 },
  {
    ...shared('shape-box', 'a0', 'group-diagram'),
    type: 'shape',
    width: 160,
    height: 100,
    kind: 'rectangle',
    stroke: OUTLINE,
    fill: [0.66, 0.84, 0.98, 1],
    cornerRadius: 12,
    sides: 4,
    label: { text: 'API', runs: [{ length: 3, style: BODY }] },
  },
  {
    ...shared('shape-star', 'a1', 'group-diagram'),
    type: 'shape',
    x: 200,
    width: 80,
    height: 80,
    kind: 'star',
    stroke: null,
    fill: [1, 0.8, 0.2, 1],
    cornerRadius: 0,
    sides: 5,
    label: null,
    locked: true,
  },
  {
    ...shared('image-photo', 'a1'),
    type: 'image',
    x: 900,
    y: -300,
    width: 400,
    height: 300,
    assetId: asset('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'),
    crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
    naturalSize: { width: 4000, height: 2400 },
    opacity: 0.9,
  },
  {
    ...shared('video-demo', 'a2'),
    type: 'video',
    x: 900,
    y: 100,
    width: 640,
    height: 360,
    assetId: asset('clip-demo'),
    poster: asset('clip-demo-poster'),
    loop: true,
    muted: true,
    trim: { startMs: 1500, endMs: 42_000.5 },
  },
  {
    ...shared('line-divider', 'a3'),
    type: 'line',
    x: -400,
    y: 700,
    points: [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
    ],
    route: 'straight',
    stroke: { color: INK, width: 1 },
    startCap: 'none',
    endCap: 'none',
  },
  {
    ...shared('connector-flow', 'a4'),
    type: 'connector',
    from: { kind: 'object', objectId: id('sticky-idea'), anchor: { x: 1, y: 0.5 } },
    to: { kind: 'object', objectId: id('shape-box'), anchor: null },
    route: 'elbow',
    stroke: OUTLINE,
    startCap: 'none',
    endCap: 'arrow',
    label: { text: 'becomes', runs: [{ length: 7, style: { ...BODY, italic: true } }] },
  },
  {
    ...shared('path-squiggle', 'a5'),
    type: 'path',
    x: -300,
    y: 800,
    vertices: [
      { id: 'v1', x: 0, y: 0, mirror: 'none' },
      { id: 'v2', x: 100, y: 0, mirror: 'both' },
      { id: 'v3', x: 200, y: 50, mirror: 'angle' },
    ],
    segments: [
      { id: 's1', a: 'v1', b: 'v2', ha: { x: 0, y: 0 }, hb: { x: -30, y: -40 } },
      { id: 's2', a: 'v2', b: 'v3', ha: { x: 30, y: 40 }, hb: { x: 0, y: 0 } },
    ],
    stroke: { color: [0.2, 0.4, 0.9, 1], width: 3 },
    fill: null,
  },
  {
    ...shared('freehand-scribble', 'a5V'),
    type: 'freehand',
    x: -300,
    y: 1000,
    tool: 'marker',
    points: [0, 0, 40, 30, 90, 10, 140, 40],
    pressures: [0.3, 0.7, 0.9, 0.5],
    stroke: { color: 'ink', width: 8 },
  },
  {
    ...shared('link-card', 'a5W'),
    type: 'link',
    x: 1400,
    y: 1000,
    width: 320,
    height: 280,
    url: 'https://example.com/article',
    title: 'An article',
    description: 'What the page says about itself.',
    siteName: 'Example',
    imageAssetId: asset('asset-preview'),
    faviconAssetId: asset('asset-favicon'),
    layout: 'vertical',
    status: 'ready',
    unfurlKey: 'fixture-paste',
  },
  {
    ...shared('comment-on-photo', 'a6'),
    type: 'comment',
    threadId: 'thread-photo',
    anchor: { kind: 'object', objectId: id('image-photo'), offset: { x: 380, y: 20 } },
  },
  {
    ...shared('comment-free', 'a7'),
    type: 'comment',
    x: 1000,
    y: 800,
    threadId: 'thread-free',
    anchor: { kind: 'point' },
  },
];

/**
 * Builds the fixture board: every object type, nested, attached and styled. A new board, with
 * new objects, on every call, so a test may freeze or compare it freely.
 *
 * @returns The fixture board.
 */
export function createFixtureBoard(): Board {
  return createBoard(structuredCloneObjects(FIXTURE_OBJECTS), [{ ...DEFAULT_PAGE }]);
}

/**
 * Copies the fixture objects through JSON, which they are made of.
 *
 * @param objects - The objects to copy.
 * @returns Deep copies of the objects.
 */
function structuredCloneObjects(objects: readonly BoardObject[]): BoardObject[] {
  return JSON.parse(JSON.stringify(objects)) as BoardObject[];
}
