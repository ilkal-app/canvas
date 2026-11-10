// A board as a client with an editor token can leave it by writing raw values past the command
// layer: one hostile object of each kind the issue names, beside honest objects of every
// drawn type, each at its own place so a query or a hit finds exactly one of them.
import type { AssetId, BoardObject, ObjectId } from '@canvas/schema';

import { imageObject } from '../../images/__fixtures__/image-objects.js';
import { frameObject, shapeObject } from '../../scene/__fixtures__/scene-objects.js';
import {
  lineObject,
  pathObject,
  stickyObject,
} from '../../spatial/__fixtures__/spatial-objects.js';
import { STYLE, textObject } from '../../text/scene/__fixtures__/text-objects.js';
import type { UndrawableReason } from '../drawable-extent.js';

/** The asset every image on the board shows, as the fixture asset source names it. */
export const HOSTILE_BOARD_ASSET = 'photo';

/** Where the polygon with a billion sides sits, away from everything else. */
export const BILLION_SIDES_AT = { x: 900, y: 900 } as const;

/** An honest object and a world point inside it that hits it and nothing else. */
export interface HonestObject {
  readonly object: BoardObject;
  readonly inside: { readonly x: number; readonly y: number };
}

/** The board: honest objects, hostile ones with the reason each is refused, and all of them. */
export interface HostileBoard {
  readonly honest: readonly HonestObject[];
  /** Every object that must not draw, with its reason; children of a hostile frame included. */
  readonly undrawable: ReadonlyMap<ObjectId, UndrawableReason>;
  /** Every object, parents before children. */
  readonly objects: readonly BoardObject[];
}

/**
 * Builds the board. Honest objects lie in the square (0, 0)–(700, 500); the frame at NaN holds
 * two honest-looking children whose world place cannot be worked out.
 *
 * @returns The board.
 */
export function hostileBoard(): HostileBoard {
  const honest = honestObjects();
  const hostile = hostileObjects();
  return {
    honest,
    undrawable: new Map(hostile.map(([object, reason]) => [object.id, reason])),
    objects: [...honest.map(({ object }) => object), ...hostile.map(([object]) => object)],
  };
}

/**
 * The honest objects, one of every drawn type, each with a point inside it.
 *
 * @returns The objects.
 */
function honestObjects(): HonestObject[] {
  return [
    { object: shapeObject('honest-shape', { x: 0, y: 0 }), inside: { x: 5, y: 5 } },
    { object: stickyObject('honest-sticky', { x: 100, y: 0 }), inside: { x: 150, y: 50 } },
    { object: lineObject('honest-line', { x: 0, y: 150 }), inside: { x: 50, y: 150 } },
    {
      object: pathObject(
        'honest-path',
        [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
          { x: 80, y: 80 },
        ],
        { isFilled: true, isClosed: true },
        { x: 250, y: 150 },
      ),
      inside: { x: 250 + 60, y: 150 + 20 },
    },
    { object: textObject('honest-text', 'Hi', { x: 300, y: 0 }), inside: { x: 305, y: 5 } },
    {
      object: imageObject({
        id: 'honest-image' as ObjectId,
        x: 0,
        y: 250,
        width: 200,
        height: 150,
        assetId: HOSTILE_BOARD_ASSET as AssetId,
      }),
      inside: { x: 100, y: 300 },
    },
    { object: frameObject('honest-frame', { x: 500, y: 250 }), inside: { x: 505, y: 255 } },
    {
      object: shapeObject('honest-child', { parentId: 'honest-frame', x: 50, y: 50 }),
      inside: { x: 555, y: 305 },
    },
  ];
}

/**
 * The hostile objects, each with the reason it is refused.
 *
 * @returns The objects and reasons.
 */
function hostileObjects(): [BoardObject, UndrawableReason][] {
  return [
    [shapeObject('far-shape', { x: 1e308 }), 'past-extent'],
    [shapeObject('nan-x-shape', { x: Number.NaN }), 'not-finite'],
    [shapeObject('infinite-width-shape', { width: Number.POSITIVE_INFINITY }), 'not-finite'],
    [shapeObject('negative-shape', { width: -50 }), 'negative-size'],
    [
      lineObject('nan-point-line', {
        points: [
          { x: Number.NaN, y: 0 },
          { x: 100, y: 0 },
        ],
      }),
      'not-finite',
    ],
    [
      pathObject('infinite-vertex-path', [
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 10 },
      ]),
      'not-finite',
    ],
    [textObject('far-text', 'Far', { x: -1e308 }), 'past-extent'],
    [
      imageObject({
        id: 'nan-crop-image' as ObjectId,
        crop: { x: Number.NaN, y: 0, width: 1, height: 1 },
      }),
      'not-finite',
    ],
    [frameObject('nan-frame', { x: Number.NaN }), 'not-finite'],
    [shapeObject('orphan-shape', { parentId: 'nan-frame', x: 10, y: 10 }), 'undrawable-parent'],
    [stickyObject('orphan-sticky', { parentId: 'nan-frame', x: 20, y: 20 }), 'undrawable-parent'],
    [stickyObject('nan-rotation-sticky', { rotation: Number.NaN }), 'not-finite'],
    // Finite in float64, infinite in a float32 buffer, or a loop count past any honest one.
    [shapeObject('huge-fill-shape', { fill: [1e39, 0, 0, 1] }), 'out-of-range'],
    [imageObject({ id: 'huge-opacity-image' as ObjectId, opacity: 1e39 }), 'out-of-range'],
    [
      imageObject({
        id: 'tiny-natural-image' as ObjectId,
        naturalSize: { width: 1e-200, height: 1e-200 },
        crop: { x: 0, y: 0, width: 1e-200, height: 1e-200 },
      }),
      'out-of-range',
    ],
    [textObject('runless-text', '', { runs: [] }), 'out-of-range'],
    [
      // A crop so small the whole image behind it is infinite: its scale overflows to Infinity.
      imageObject({
        id: 'subnormal-crop-image' as ObjectId,
        width: 100,
        height: 100,
        naturalSize: { width: 1, height: 1 },
        crop: { x: 0, y: 0, width: 1e-310, height: 1e-310 },
      }),
      'past-extent',
    ],
    [
      shapeObject('no-sides-polygon', {
        kind: 'polygon',
        sides: 0,
        label: { text: 'P', runs: [{ length: 1, style: STYLE }] },
      }),
      'out-of-range',
    ],
    [
      shapeObject('billion-sides-polygon', {
        x: BILLION_SIDES_AT.x,
        y: BILLION_SIDES_AT.y,
        kind: 'polygon',
        sides: 1e9,
      }),
      'out-of-range',
    ],
  ];
}
