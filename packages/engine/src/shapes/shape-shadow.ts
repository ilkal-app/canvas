import {
  isPaintVisible,
  shadowValueReason,
  strokeOutsetOf,
  type CornerRadii,
  strokeOutsideFraction,
  type BoardObject,
  type Shadow,
} from '@canvas/schema';

import { readFill } from '../paint/paint-reading.js';
import {
  frameRadiiOf,
  isRoundedFrame,
  writeFrameCornerRadii,
} from '../scene/frame-shape-record.js';
import type { WorldTransform } from '../scene/world-transform.js';

import { SHAPE_KIND_CODES } from './shape-instance-layout.js';
import { isOutlineVisible, isPaintedShape, SHAPE_KIND_OF } from './shape-object-record.js';

// Drop shadows of shapes and frames, drawn the way a sticky note's shadow is: one
// soft SDF record of the object's silhouette (the shape pass's record, `SHAPE_INSTANCE_FLOATS`),
// moved by the shadow's offset, grown by its spread and blurred by its softness, drawn before
// the object. Lengths are in the object's own frame, so the shadow turns with it.

/**
 * The shape shader's softness per unit of a shadow's `blur` radius. The design tools' blur
 * radius `B` (Figma's, CSS `box-shadow`'s) is a Gaussian of standard deviation `σ = B / 2`, whose
 * edge falls off as the normal CDF; the shader's soft edge is a smoothstep over
 * `[−softness, softness]`, closest to that CDF in least squares at `softness = 2.08 σ`, within
 * 2.3% of it everywhere. So `softness = 1.04 B`.
 */
export const SHADOW_SOFTNESS_PER_BLUR = 1.04;

/** Shadow values already read, by value: objects are immutable values, so a change is a new one. */
const readLayers = new WeakMap<object, readonly Shadow[]>();

/** No layers. */
const NO_LAYERS: readonly Shadow[] = Object.freeze([]);

/**
 * Reads a stored shadow as the engine draws it, tolerant of bad values: every layer
 * it draws, in order, the first lowest. Absent, `null`, a value the schema refuses
 * (`shadowValueReason`: a peer that skipped the door, an old replay) draw none; a single shadow
 * is one layer; a layer with a fully transparent colour is left out. Memoised per value. Pure.
 *
 * @param value - The stored `shadow` field.
 * @returns The layers to draw; empty for none.
 */
export function readShadowLayers(value: unknown): readonly Shadow[] {
  if (typeof value !== 'object' || value === null) return NO_LAYERS;
  let layers = readLayers.get(value);
  if (layers === undefined) {
    const isReadable = shadowValueReason(value) === undefined;
    const all = (Array.isArray(value) ? value : [value]) as readonly Shadow[];
    layers = isReadable ? Object.freeze(all.filter((shadow) => shadow.color[3] > 0)) : NO_LAYERS;
    readLayers.set(value, layers);
  }
  return layers;
}

/**
 * Reads a stored shadow's lowest drawn layer (see {@link readShadowLayers}).
 *
 * @param value - The stored `shadow` field.
 * @returns The lowest layer to draw, or undefined for none.
 */
export function readShadow(value: unknown): Shadow | undefined {
  return readShadowLayers(value)[0];
}

/**
 * How far a shadow's pixels can reach past its object's box on any side, world units, for the
 * object's bounds (culling and z-order segments): its offset (its length, since the object may
 * turn), its spread when positive and its soft edge. Pure.
 *
 * @param shadow - The shadow.
 * @returns The margin, at least 0.
 */
export function shadowMarginOf(shadow: Shadow): number {
  return (
    Math.hypot(shadow.x, shadow.y) +
    Math.max(0, shadow.spread) +
    SHADOW_SOFTNESS_PER_BLUR * shadow.blur
  );
}

/** The silhouette a shadow record draws: the object's box and its distance function's inputs. */
export interface ShadowSilhouette {
  /** The object's width, world units. */
  readonly width: number;
  /** The object's height, world units. */
  readonly height: number;
  /** The distance function's code (`SHAPE_KIND_CODES`). */
  readonly kindCode: number;
  /** The corner radius of a rounded box, world units; 0 is sharp. */
  readonly radius: number;
  /**
   * A rounded frame's four corner radii as drawn, top-left clockwise; absent for every
   * other silhouette. Written after the shape record (the frame shadow pass's record holds them).
   */
  readonly corners?: CornerRadii;
  /** A polygon's sides or a star's points; anything for the other kinds. */
  readonly sides: number;
  /**
   * The width of the outline band that casts the shadow, world units, for an object painted by
   * its outline alone (a hollow shape's ring casts a ring); 0 when its filled area casts it.
   */
  readonly outlineWidth: number;
  /**
   * The fraction of that band outside the object's edge (`strokeOutsideFraction`):
   * 0 inside, 0.5 centred, 1 outside; 0 for a filled silhouette.
   */
  readonly outlineOutside: number;
  /**
   * How far a filled silhouette reaches past the object's box, world units: its outline's part
   * outside the edge (`strokeOutsetOf`), which casts too; 0 for a hollow one.
   */
  readonly outset: number;
}

/**
 * How far a shadow record's box is grown past the object's box on every side, world units: a
 * filled silhouette by the spread and its outline's outset; a hollow one so that its band, widened
 * by the spread on both sides, stays centred where the object's band is (`spread × (1 − 2 ×
 * outlineOutside)`: an inside band's box grows by the spread, a centred one's not at all, an
 * outside one's shrinks by it). Pure.
 *
 * @param shadow - The shadow.
 * @param silhouette - What casts it.
 * @returns The growth, world units; negative shrinks.
 */
function shadowGrowthOf(shadow: Shadow, silhouette: ShadowSilhouette): number {
  return silhouette.outlineWidth > 0
    ? shadow.spread * (1 - 2 * silhouette.outlineOutside)
    : shadow.spread + silhouette.outset;
}

/**
 * Writes a shadow's one record (the layout of `SHAPE_INSTANCE_FLOATS`): the silhouette's box
 * moved by the offset and grown by the spread on every side, and by a filled silhouette's outline
 * outset (a rounded corner's radius grows with it, a sharp corner stays sharp, as
 * CSS's spread does), placed and turned by the object's transform, in the shadow's colour with a
 * soft edge of {@link SHADOW_SOFTNESS_PER_BLUR} × blur. A filled silhouette is the record's fill;
 * a hollow one its outline band, widened by the spread on both sides and aligned as the object's
 * (`shadowGrowthOf`), over a clear fill. A spread that shrinks the box, or the band, to nothing
 * leaves the record clear, which draws nothing. Field by field: it allocates nothing.
 *
 * @param record - The record, zero-filled.
 * @param shadow - The shadow.
 * @param silhouette - What casts it.
 * @param transform - The object's frame to the world.
 */
export function writeShadowRecord(
  record: Float32Array,
  shadow: Shadow,
  silhouette: ShadowSilhouette,
  transform: WorldTransform,
): void {
  const { spread, color } = shadow;
  const grow = shadowGrowthOf(shadow, silhouette);
  const width = silhouette.width + 2 * grow;
  const height = silhouette.height + 2 * grow;
  const band = silhouette.outlineWidth > 0 ? silhouette.outlineWidth + 2 * spread : 0;
  if (!(width > 0) || !(height > 0) || (silhouette.outlineWidth > 0 && !(band > 0))) return;
  const { left, top } = shadowOriginOf(shadow, grow);
  const { cos, sin } = transform;
  record[0] = transform.x + cos * left - sin * top;
  record[1] = transform.y + sin * left + cos * top;
  record[2] = width;
  record[3] = height;
  // A filled silhouette is the record's fill; a hollow one its outline band over a clear fill.
  const colorAt = band > 0 ? 13 : 4;
  record[colorAt] = color[0];
  record[colorAt + 1] = color[1];
  record[colorAt + 2] = color[2];
  record[colorAt + 3] = color[3];
  record[8] = silhouette.radius > 0 ? Math.max(0, silhouette.radius + grow) : 0;
  record[9] = SHADOW_SOFTNESS_PER_BLUR * shadow.blur;
  record[10] = silhouette.kindCode;
  record[11] = cos;
  record[12] = sin;
  record[17] = band;
  record[18] = silhouette.sides;
  record[19] = band > 0 ? silhouette.outlineOutside : 0;
  if (silhouette.corners !== undefined) writeFrameCornerRadii(record, silhouette.corners, grow);
}

/**
 * Where a shadow's box starts in its object's own frame: its offset, less its growth
 * (`shadowGrowthOf`).
 *
 * @param shadow - The shadow.
 * @param grow - How far its box is grown on every side, world units.
 * @returns The box's top-left corner, world units, in the object's frame.
 */
function shadowOriginOf(
  shadow: Shadow,
  grow: number,
): { readonly left: number; readonly top: number } {
  return { left: shadow.x - grow, top: shadow.y - grow };
}

/**
 * Where a shadow's record is placed in the world: its box's top-left corner through the object's
 * transform, and the object's turn (`ScenePass.movePlacement`, for retained moves). The same f64
 * arithmetic as {@link writeShadowRecord}. Pure.
 *
 * @param shadow - The shadow.
 * @param silhouette - What casts it.
 * @param transform - The object's frame to the world.
 * @returns The record's placement.
 */
export function shadowPlacementOf(
  shadow: Shadow,
  silhouette: ShadowSilhouette,
  transform: WorldTransform,
): WorldTransform {
  const { left, top } = shadowOriginOf(shadow, shadowGrowthOf(shadow, silhouette));
  const { cos, sin } = transform;
  return {
    x: transform.x + cos * left - sin * top,
    y: transform.y + sin * left + cos * top,
    cos,
    sin,
  };
}

/**
 * The shadow layers an object draws: a shape's when the shape paints
 * anything (`isPaintedShape`), a frame's when its background or its outline paints
 * anything, each read by {@link readShadowLayers}; none for any other object, or when what would
 * cast them is invisible (a shadow follows what the object paints, as in the design tools). The
 * shape pass gives a shape a record per layer under its body, the frame shadow pass a frame. Pure.
 *
 * @param object - The object.
 * @returns The layers, the first lowest; empty for none.
 */
export function drawnShadowsOf(object: BoardObject): readonly Shadow[] {
  if (object.type === 'shape') {
    return isPaintedShape(object) ? readShadowLayers(object.shadow) : NO_LAYERS;
  }
  if (object.type !== 'frame') return NO_LAYERS;
  const isPainted = isPaintVisible(readFill(object.background)) || isOutlineVisible(object.stroke);
  return isPainted ? readShadowLayers(object.shadow) : NO_LAYERS;
}

/**
 * An object's lowest drawn shadow layer (see {@link drawnShadowsOf}).
 *
 * @param object - The object.
 * @returns The shadow, or undefined.
 */
export function drawnShadowOf(object: BoardObject): Shadow | undefined {
  return drawnShadowsOf(object)[0];
}

/**
 * What casts an object's shadow: a shape's kind, corner radius and sides, a frame's box with its
 * corner radii when rounded, else sharp;
 * its filled area (a shape's fill, a frame's background) grown by its outline's part outside the
 * edge or, when that fill paints nothing, its outline band where it lies. Pure.
 *
 * @param object - A shape or frame.
 * @returns The silhouette, or undefined for another object.
 */
export function shadowSilhouetteOf(object: BoardObject): ShadowSilhouette | undefined {
  if (object.type !== 'frame' && object.type !== 'shape') return undefined;
  const isFrame = object.type === 'frame';
  const isFilled = isPaintVisible(readFill(isFrame ? object.background : object.fill));
  const stroke = isOutlineVisible(object.stroke) ? object.stroke : undefined;
  const corners = isFrame && isRoundedFrame(object) ? { corners: frameRadiiOf(object) } : {};
  return {
    ...corners,
    width: object.width,
    height: object.height,
    kindCode: SHAPE_KIND_CODES[isFrame ? 'rounded-box' : SHAPE_KIND_OF[object.kind]],
    radius: !isFrame && object.kind === 'rectangle' ? object.cornerRadius : 0,
    sides: isFrame ? 0 : object.sides,
    outlineWidth: isFilled ? 0 : (stroke?.width ?? 0),
    outlineOutside: isFilled ? 0 : strokeOutsideFraction(object.strokeAlign),
    outset: isFilled ? strokeOutsetOf(stroke, object.strokeAlign) : 0,
  };
}

/**
 * Writes an object's shadow record ({@link writeShadowRecord}) when it draws one
 * ({@link drawnShadowOf}); leaves the record clear otherwise.
 *
 * @param record - The record, zero-filled.
 * @param object - The shape or frame.
 * @param transform - Its frame to the world.
 * @param layer - Which of its drawn layers, the first lowest; default the first.
 */
export function writeObjectShadowRecord(
  record: Float32Array,
  object: BoardObject,
  transform: WorldTransform,
  layer = 0,
): void {
  const shadow = drawnShadowsOf(object)[layer];
  const silhouette = shadowSilhouetteOf(object);
  if (shadow === undefined || silhouette === undefined) return;
  writeShadowRecord(record, shadow, silhouette, transform);
}
