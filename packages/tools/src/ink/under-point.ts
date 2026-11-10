import { isInsideFrameShape, shapeDistance, type ShapeKind } from '@canvas/engine';
import {
  applyTransform,
  compareSiblings,
  composeTransforms,
  effectiveColorMode,
  fittedImageRect,
  invertTransform,
  isImagePaint,
  isPaintVisible,
  paintBoxOf,
  paintColorAt,
  resolveColor,
  resolvePaint,
  paintUnitPoint,
  placementTransform,
  type BoardObject,
  type ColorMode,
  type ImageObject,
  type InkTheme,
  type ObjectId,
  type Paint,
  type PathObject,
  type Point,
  type Rgba,
  type RigidTransform,
  type ShapeObject,
  type TokenTable,
} from '@canvas/schema';

// What lies under a creation's start point: the filled objects whose
// painted area contains the point by geometry (the hit-test shapes, never GPU pixels), topmost
// first, each with its colour there. Pure.

/** The distance function the shape pass draws each kind with. */
const SHAPE_KIND: Readonly<Record<ShapeObject['kind'], ShapeKind>> = {
  rectangle: 'rounded-box',
  ellipse: 'ellipse',
  diamond: 'diamond',
  polygon: 'polygon',
  star: 'star',
};

/** Steps each path segment is flattened into for the even-odd test. */
const SEGMENT_STEPS = 16;

/** What a filled object shows at the point. */
export type UnderColor =
  | {
      /** Its colour there. */
      readonly kind: 'color';
      /** The colour, straight alpha. */
      readonly color: Rgba;
    }
  | {
      /** An image whose average colour is not known yet. */
      readonly kind: 'pending';
    };

/** Reads an image asset's average colour, or null while it is pending. */
export type AverageColorOf = (assetId: string) => Rgba | null;

/**
 * How colour tokens resolve under the point: the viewer's theme, for objects in no
 * explicit colour mode, and the board's token table.
 */
export interface UnderPointColors {
  /** The viewer's theme. */
  readonly theme: InkTheme;
  /** The board's colour token table; absent, the built-ins at their defaults. */
  readonly tokens?: TokenTable;
}

/** One object's colour context: its colour mode and the board's tokens. */
interface ObjectColors {
  /** The object's effective colour mode. */
  readonly mode: ColorMode;
  /** The board's token table. */
  readonly tokens: TokenTable | undefined;
}

/**
 * The transform from an object's own frame to the board's, through its ancestors; a missing
 * parent ends the chain, a cycle is cut where it repeats.
 *
 * @param object - The object.
 * @param byId - The objects by id.
 * @returns The transform.
 */
function boardTransformOf(
  object: BoardObject,
  byId: ReadonlyMap<ObjectId, BoardObject>,
): RigidTransform {
  let transform = placementTransform(object.x, object.y, object.rotation);
  const visited = new Set<ObjectId>([object.id]);
  for (
    let parent = object.parentId === null ? undefined : byId.get(object.parentId);
    parent !== undefined && !visited.has(parent.id);
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
  ) {
    visited.add(parent.id);
    transform = composeTransforms(
      placementTransform(parent.x, parent.y, parent.rotation),
      transform,
    );
  }
  return transform;
}

/**
 * An object's stacking path, root ancestor first, as the board paints it.
 *
 * @param object - The object.
 * @param byId - The objects by id.
 * @returns The path of sibling keys.
 */
function stackPathOf(
  object: BoardObject,
  byId: ReadonlyMap<ObjectId, BoardObject>,
): { z: string; id: ObjectId }[] {
  const path = [{ z: object.z, id: object.id }];
  const visited = new Set<ObjectId>([object.id]);
  for (
    let parent = object.parentId === null ? undefined : byId.get(object.parentId);
    parent !== undefined && !visited.has(parent.id);
    parent = parent.parentId === null ? undefined : byId.get(parent.parentId)
  ) {
    visited.add(parent.id);
    path.unshift({ z: parent.z, id: parent.id });
  }
  return path;
}

/**
 * Compares two stacking paths; an ancestor paints below its descendants.
 *
 * @param first - One path.
 * @param second - The other.
 * @returns Negative when `first` paints below `second`.
 */
function comparePaths(
  first: readonly { z: string; id: ObjectId }[],
  second: readonly { z: string; id: ObjectId }[],
): number {
  for (let step = 0; step < Math.min(first.length, second.length); step += 1) {
    const a = first[step];
    const b = second[step];
    if (a === undefined || b === undefined) break;
    const order = compareSiblings(a, b);
    if (order !== 0) return order;
  }
  return first.length - second.length;
}

/**
 * Whether a point in a shape's frame is inside its painted area, by its kind's outline.
 *
 * @param shape - The shape.
 * @param point - The point, in the shape's frame.
 * @returns True inside.
 */
function isInsideShape(shape: ShapeObject, point: Point): boolean {
  const halfSize = { x: shape.width / 2, y: shape.height / 2 };
  const radius =
    shape.kind === 'rectangle' ? Math.min(shape.cornerRadius, halfSize.x, halfSize.y) : 0;
  const local = { x: point.x - halfSize.x, y: point.y - halfSize.y };
  return shapeDistance(SHAPE_KIND[shape.kind], local, halfSize, radius, shape.sides) <= 0;
}

/**
 * A point on a cubic.
 *
 * @param p0 - Start.
 * @param p1 - First control point.
 * @param p2 - Second control point.
 * @param p3 - End.
 * @param t - Where, 0 to 1.
 * @returns The point.
 */
function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const s = 1 - t;
  const a = s * s * s;
  const b = 3 * s * s * t;
  const c = 3 * s * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * Whether a point in a path's frame is inside its even-odd fill: a ray to +x crosses its
 * flattened segments an odd number of times.
 *
 * @param path - The path.
 * @param point - The point, in the path's frame.
 * @returns True inside.
 */
function isInsidePath(path: PathObject, point: Point): boolean {
  const vertices = new Map(path.vertices.map((vertex) => [vertex.id, vertex]));
  let isInside = false;
  for (const segment of path.segments) {
    const start = vertices.get(segment.a);
    const end = vertices.get(segment.b);
    if (start === undefined || end === undefined) continue;
    const c1 = { x: start.x + segment.ha.x, y: start.y + segment.ha.y };
    const c2 = { x: end.x + segment.hb.x, y: end.y + segment.hb.y };
    let previous: Point = start;
    for (let step = 1; step <= SEGMENT_STEPS; step += 1) {
      const next = cubicAt(start, c1, c2, end, step / SEGMENT_STEPS);
      if (previous.y > point.y !== next.y > point.y) {
        const x =
          previous.x + ((point.y - previous.y) * (next.x - previous.x)) / (next.y - previous.y);
        if (x > point.x) isInside = !isInside;
      }
      previous = next;
    }
  }
  return isInside;
}

/**
 * Whether a point is inside a box from the origin.
 *
 * @param box - The box's size.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @param point - The point, in the box's frame.
 * @returns True inside.
 */
function isInsideBox(box: { width: number; height: number }, point: Point): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= box.width && point.y <= box.height;
}

/**
 * The colour a paint shows at a point of a painted object, or undefined when it shows none. An
 * image paint shows its asset's average colour, as an image object does: pending while
 * that is not known.
 *
 * @param object - The painted object.
 * @param paint - Its paint.
 * @param point - The point, in its frame.
 * @param averageColorOf - An image asset's average colour.
 * @param colors - Its colour mode and the board's tokens, which a token paint resolves with.
 * @returns The colour, or undefined.
 */
function paintAt(
  object: ShapeObject | PathObject | Extract<BoardObject, { type: 'frame' }>,
  paint: Paint | null,
  point: Point,
  averageColorOf: AverageColorOf | undefined,
  colors: ObjectColors,
): UnderColor | undefined {
  if (paint === null || !isPaintVisible(paint)) return undefined;
  if (isImagePaint(paint)) {
    const average = averageColorOf?.(paint.assetId) ?? null;
    if (average === null) return { kind: 'pending' };
    return average[3] > 0 ? { kind: 'color', color: average } : undefined;
  }
  const { u, v } = paintUnitPoint(paintBoxOf(object), point);
  const color = paintColorAt(resolvePaint(paint, colors.mode, colors.tokens), u, v);
  return color !== null && color[3] > 0 ? { kind: 'color', color } : undefined;
}

/**
 * What an image shows at a point of its own frame: nothing outside the rectangle it draws in (its
 * fitted rectangle, where its hit test picks) or where it is invisible, else its average colour
 * with the object's opacity applied to the alpha, so a translucent image composites over what
 * lies below it; pending while the average is not known.
 *
 * @param image - The image.
 * @param point - The point, in the image's frame.
 * @param averageColorOf - An image asset's average colour.
 * @returns What it shows, or undefined.
 */
function imageColorAt(
  image: ImageObject,
  point: Point,
  averageColorOf: AverageColorOf | undefined,
): UnderColor | undefined {
  if (!(image.opacity > 0)) return undefined;
  const drawn = fittedImageRect(image);
  if (!isInsideBox(drawn, { x: point.x - drawn.x, y: point.y - drawn.y })) return undefined;
  const average = averageColorOf?.(image.assetId) ?? null;
  if (average === null) return { kind: 'pending' };
  const alpha = average[3] * image.opacity;
  return alpha > 0
    ? { kind: 'color', color: [average[0], average[1], average[2], alpha] }
    : undefined;
}

/**
 * What one object shows at a point of its own frame: its fill there, or undefined for an object
 * with no filled area there (outline-only shapes and paths, lines, connectors, text, groups).
 *
 * @param object - The object.
 * @param point - The point, in the object's frame.
 * @param averageColorOf - An image asset's average colour.
 * @param colors - The object's colour mode and the board's tokens.
 * @returns What it shows, or undefined.
 */
function colorOf(
  object: BoardObject,
  point: Point,
  averageColorOf: AverageColorOf | undefined,
  colors: ObjectColors,
): UnderColor | undefined {
  switch (object.type) {
    case 'shape':
      return isInsideShape(object, point)
        ? paintAt(object, object.fill, point, averageColorOf, colors)
        : undefined;
    case 'path':
      return object.fill !== null && isInsidePath(object, point)
        ? paintAt(object, object.fill, point, averageColorOf, colors)
        : undefined;
    case 'frame':
      // A rounded frame's corners are not its background.
      return isInsideFrameShape(object, point)
        ? paintAt(object, object.background, point, averageColorOf, colors)
        : undefined;
    case 'sticky': {
      const color = resolveColor(object.color, colors.mode, colors.tokens);
      return isInsideBox(object, point) && color[3] > 0 ? { kind: 'color', color } : undefined;
    }
    case 'image':
      return imageColorAt(object, point, averageColorOf);
    default:
      return undefined;
  }
}

/**
 * The filled objects under a board point, topmost first in paint order, each with what it shows
 * there; the walk stops at the first opaque colour or pending image, below which nothing shows.
 *
 * @param objects - The current page's objects.
 * @param point - The point, world units.
 * @param averageColorOf - An image asset's average colour, null while pending.
 * @param colors - The viewer's theme and the board's tokens, which token colours resolve with in
 *   each object's mode (`effectiveColorMode`); the light theme's built-ins when absent.
 * @returns What lies under the point, topmost first.
 */
export function colorsUnderPoint(
  objects: readonly BoardObject[],
  point: Point,
  averageColorOf?: AverageColorOf,
  colors: UnderPointColors = { theme: 'light' },
): UnderColor[] {
  const byId = new Map(objects.map((object) => [object.id, object]));
  const board = { objects: byId };
  const hits: { path: { z: string; id: ObjectId }[]; color: UnderColor }[] = [];
  for (const object of byId.values()) {
    const local = applyTransform(invertTransform(boardTransformOf(object, byId)), point);
    const mode = effectiveColorMode(object, board, colors.theme);
    const color = colorOf(object, local, averageColorOf, { mode, tokens: colors.tokens });
    if (color !== undefined) hits.push({ path: stackPathOf(object, byId), color });
  }
  hits.sort((first, second) => comparePaths(second.path, first.path));
  const under: UnderColor[] = [];
  for (const { color } of hits) {
    under.push(color);
    if (color.kind === 'pending' || color.color[3] >= 1) break;
  }
  return under;
}
