// Board objects the spatial tests need beyond the scene fixtures' shapes, frames and groups:
// lines, paths, stickies, connectors and comments, with fixed, valid fields.
import type {
  AssetId,
  BaseObject,
  CommentObject,
  ConnectorObject,
  ImageObject,
  LineObject,
  ObjectId,
  PathObject,
  Point,
  PrincipalId,
  StickyObject,
  TextObject,
  VideoObject,
} from '@canvas/schema';

/** Overrides for a fixture object; `parentId` may be given as a plain string. */
type Overrides<T> = Partial<Omit<T, 'id' | 'parentId'>> & { readonly parentId?: string | null };

function sharedFields(id: string, parentId: string | null | undefined): Omit<BaseObject, 'type'> {
  return {
    id: id as ObjectId,
    parentId: (parentId ?? null) as ObjectId | null,
    x: 0,
    y: 0,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: 'user:fixture' as PrincipalId,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

/**
 * A straight line from (0, 0) to (100, 0) with a 2-unit black stroke and no caps.
 *
 * @param id - The object id.
 * @param overrides - Fields to change.
 * @returns The line.
 */
export function lineObject(id: string, overrides: Overrides<LineObject> = {}): LineObject {
  const { parentId, ...fields } = overrides;
  return {
    ...sharedFields(id, parentId),
    type: 'line',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'none',
    ...fields,
  };
}

/** How {@link pathObject} builds its path. */
interface PathFixtureOptions {
  /** Whether a last segment joins the last vertex back to the first. */
  readonly isClosed?: boolean;
  /** Every segment's handles: offsets from its start and from its end. Default straight. */
  readonly handles?: readonly [Point, Point];
  /** The stroke width, or null for no stroke. Default 2. */
  readonly strokeWidth?: number | null;
  /** Whether the path is filled. */
  readonly isFilled?: boolean;
}

/**
 * A path through the given vertices, one segment between each consecutive pair (closed back to
 * the first when `isClosed`), with the given handles on every segment.
 *
 * @param id - The object id.
 * @param points - The vertices, in the path's own frame.
 * @param options - Closure, handles, stroke and fill.
 * @param overrides - Base fields to change.
 * @returns The path.
 */
export function pathObject(
  id: string,
  points: readonly Point[],
  options: PathFixtureOptions = {},
  overrides: Overrides<PathObject> = {},
): PathObject {
  const { parentId, ...fields } = overrides;
  const vertices = points.map((point, index) => ({
    id: `v${String(index)}`,
    x: point.x,
    y: point.y,
    mirror: 'none' as const,
  }));
  const pairCount = options.isClosed ? points.length : points.length - 1;
  const [ha, hb] = options.handles ?? [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  const segments = Array.from({ length: Math.max(0, pairCount) }, (unused, index) => ({
    id: `s${String(index)}`,
    a: `v${String(index)}`,
    b: `v${String((index + 1) % points.length)}`,
    ha,
    hb,
  }));
  const strokeWidth = options.strokeWidth === undefined ? 2 : options.strokeWidth;
  return {
    ...sharedFields(id, parentId),
    type: 'path',
    vertices,
    segments,
    stroke: strokeWidth === null ? null : { color: [0, 0, 0, 1], width: strokeWidth },
    fill: options.isFilled ? [0, 0, 1, 1] : null,
    ...fields,
  };
}

/**
 * A 100 × 100 yellow sticky note at the origin, empty.
 *
 * @param id - The object id.
 * @param overrides - Fields to change.
 * @returns The sticky.
 */
export function stickyObject(id: string, overrides: Overrides<StickyObject> = {}): StickyObject {
  const { parentId, ...fields } = overrides;
  return {
    ...sharedFields(id, parentId),
    type: 'sticky',
    width: 100,
    height: 100,
    text: '',
    runs: [
      {
        length: 0,
        style: {
          fontFamily: 'Inter',
          fontSize: 24,
          color: [0, 0, 0, 1],
          weight: 400,
          italic: false,
        },
      },
    ],
    align: 'center',
    autoWidth: false,
    verticalAlign: 'middle',
    color: [1, 0.92, 0.55, 1],
    ...fields,
  };
}

/**
 * A straight connector between two free points.
 *
 * @param id - The object id.
 * @returns The connector.
 */
export function connectorObject(id: string): ConnectorObject {
  return {
    ...sharedFields(id, null),
    type: 'connector',
    from: { kind: 'point', x: 0, y: 0 },
    to: { kind: 'point', x: 50, y: 50 },
    route: 'straight',
    stroke: { color: [0, 0, 0, 1], width: 2 },
    startCap: 'none',
    endCap: 'arrow',
    label: null,
  };
}

/**
 * A comment pinned to a board point.
 *
 * @param id - The object id.
 * @returns The comment.
 */
export function commentObject(id: string): CommentObject {
  return {
    ...sharedFields(id, null),
    type: 'comment',
    threadId: 'thread-1',
    anchor: { kind: 'point' },
  };
}

const FIXTURE_STYLE = {
  fontFamily: 'Inter',
  fontSize: 24,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
} as const;

/**
 * A 200 × 30 text box at the origin.
 *
 * @param id - The object id.
 * @returns The text object.
 */
export function textObject(id: string): TextObject {
  return {
    ...sharedFields(id, null),
    type: 'text',
    width: 200,
    height: 30,
    text: 'Hello',
    runs: [{ length: 5, style: { ...FIXTURE_STYLE, color: [0, 0, 0, 1] } }],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  };
}

/**
 * A 320 × 240 image at the origin.
 *
 * @param id - The object id.
 * @returns The image.
 */
export function imageObject(id: string): ImageObject {
  return {
    ...sharedFields(id, null),
    type: 'image',
    width: 320,
    height: 240,
    assetId: 'asset-photo' as AssetId,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    naturalSize: { width: 1600, height: 1200 },
    opacity: 1,
  };
}

/**
 * A 640 × 360 video at the origin.
 *
 * @param id - The object id.
 * @returns The video.
 */
export function videoObject(id: string): VideoObject {
  return {
    ...sharedFields(id, null),
    type: 'video',
    width: 640,
    height: 360,
    assetId: 'asset-clip' as AssetId,
    poster: null,
    loop: false,
    muted: true,
    trim: null,
  };
}
