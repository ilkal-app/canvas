import { PORTABLE_BOARD_FORMAT, SCHEMA_VERSION } from '@canvas/schema';

// Stable pre-component portable fixture, shared by the existing command and history tests.
// Codec tests opt into the new object types without changing the legacy command/history board.

const INK = [0.1, 0.1, 0.12, 1];
const BODY = { fontFamily: 'Inter', fontSize: 24, color: INK, weight: 400, italic: false };
const BOLD = { ...BODY, weight: 700 };
const OUTLINE = { color: INK, width: 2 };

/**
 * The shared fields of a fixture object: created by Ada at a fixed time, unlocked, unrotated.
 *
 * @param id - The object's id.
 * @param z - The object's fractional-index key.
 * @param parentId - The object's parent, or `null` for the root.
 * @returns The shared fields, without `type`.
 */
function shared(id: string, z: string, parentId: string | null = null): Record<string, unknown> {
  return {
    id,
    parentId,
    pageId: parentId === null ? 'page-1' : null,
    x: 0,
    y: 0,
    rotation: 0,
    z,
    locked: false,
    createdBy: 'user:ada',
    createdAt: 1_760_000_000_000,
    updatedAt: 1_760_000_500_000,
  };
}

const FIXTURE_OBJECTS: readonly Record<string, unknown>[] = [
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
    assetId: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
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
    assetId: 'clip-demo',
    poster: 'clip-demo-poster',
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
    from: { kind: 'object', objectId: 'sticky-idea', anchor: { x: 1, y: 0.5 } },
    to: { kind: 'object', objectId: 'shape-box', anchor: null },
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
    title: '',
    description: '',
    siteName: '',
    layout: 'vertical',
    status: 'pending',
    unfurlKey: 'fixture-paste',
  },
  {
    ...shared('comment-on-photo', 'a6'),
    type: 'comment',
    threadId: 'thread-photo',
    anchor: { kind: 'object', objectId: 'image-photo', offset: { x: 380, y: 20 } },
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
 * Builds the fixture board as a portable JSON document, parsed from text so it shares nothing
 * with other calls: every object type of the schema, nested, attached and styled.
 *
 * @param shouldIncludeComponents - Include the layout-5 object types for complete codec coverage.
 * @returns A fresh portable document, ready for `importBoard`.
 */
export function createFixtureBoardJson(shouldIncludeComponents = false): unknown {
  const components = shouldIncludeComponents
    ? [
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
          width: 240,
          height: 120,
          mainId: 'component-card',
          overrides: {},
        },
      ]
    : [];
  const document = {
    format: PORTABLE_BOARD_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    objects: [...FIXTURE_OBJECTS, ...components],
  };
  return JSON.parse(JSON.stringify(document));
}
