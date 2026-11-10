import { BOARD_BOUND } from '../fields/board-bound.js';
import type { FrameCornerRadius } from '../fields/frame-radius.js';
import { isImagePaint, type Paint } from '../fields/paint.js';
import { fittedImageRect } from '../geometry/image-fit.js';
import type { BoardObject } from '../objects/board-object.js';

/** A value of an object that is not a position, past the limit it has on every way in. */
export interface ValueLimitIssue {
  /** The field, as a path within the object. */
  readonly path: readonly (string | number)[];
  /** How large it is: the magnitude compared with the limit and with the stored value's. */
  readonly magnitude: number;
  /** Its limit. */
  readonly limit: number;
  /** What is wrong, naming the value. */
  readonly message: string;
}

/** A value and its limit, before it is judged. */
interface LimitedValue {
  /** The field. */
  readonly path: readonly (string | number)[];
  /** Its magnitude. */
  readonly magnitude: number;
  /** What it is, for the message. */
  readonly what: string;
}

/**
 * The values of an object that are not positions but have a limit: its
 * rotation, a shape's or frame's corner radius (each corner of a frame's), an image's natural size and the size of its whole source
 * image behind the crop (the box over the crop's fractions), and the offset of a comment pinned
 * to an object.
 *
 * @param object - The object.
 * @returns Each value with its field.
 */
function limitedValuesOf(object: BoardObject): LimitedValue[] {
  const values: LimitedValue[] = [
    { path: ['rotation'], magnitude: Math.abs(object.rotation), what: 'the rotation' },
  ];
  switch (object.type) {
    case 'shape':
      values.push({ path: ['cornerRadius'], magnitude: object.cornerRadius, what: 'the radius' });
      values.push(...imagePaintValues(object.fill, object, 'fill'));
      break;
    case 'frame':
      values.push(...frameRadiusValues(object.cornerRadius));
      values.push(...imagePaintValues(object.background, object, 'background'));
      break;
    case 'image': {
      const drawn = fittedImageRect(object);
      values.push(
        { path: ['naturalSize', 'width'], magnitude: object.naturalSize.width, what: 'the width' },
        {
          path: ['naturalSize', 'height'],
          magnitude: object.naturalSize.height,
          what: 'the height',
        },
        {
          path: ['crop', 'width'],
          magnitude: drawn.width / object.crop.width,
          what: 'the whole image behind the crop',
        },
        {
          path: ['crop', 'height'],
          magnitude: drawn.height / object.crop.height,
          what: 'the whole image behind the crop',
        },
      );
      break;
    }
    case 'comment':
      if (object.anchor.kind === 'object') {
        const { offset } = object.anchor;
        values.push(
          { path: ['anchor', 'offset', 'x'], magnitude: Math.abs(offset.x), what: 'the pin' },
          { path: ['anchor', 'offset', 'y'], magnitude: Math.abs(offset.y), what: 'the pin' },
        );
      }
      break;
    default:
      break;
  }
  return values;
}

/**
 * The limited values of a frame's corner rounding, as a shape's radius: the one radius,
 * or each of the four corners by its index.
 *
 * @param radius - The frame's `cornerRadius`, or undefined for none.
 * @returns Its values; none when absent.
 */
function frameRadiusValues(radius: FrameCornerRadius | undefined): LimitedValue[] {
  if (radius === undefined) return [];
  if (typeof radius === 'number') {
    return [{ path: ['cornerRadius'], magnitude: radius, what: 'the radius' }];
  }
  return radius.map((magnitude, corner) => ({
    path: ['cornerRadius', corner],
    magnitude,
    what: 'the radius',
  }));
}

/**
 * The limited values of an image paint, as an image object's: its natural size, and the
 * whole image behind its crop, which at most spans the box's longer side over the crop's extent
 * whatever the fit.
 *
 * @param paint - The fill or background.
 * @param box - The object's box.
 * @param box.width - Its width.
 * @param box.height - Its height.
 * @param field - The field holding the paint.
 * @returns Its values; none for any other paint.
 */
function imagePaintValues(
  paint: Paint | null,
  box: { readonly width: number; readonly height: number },
  field: 'fill' | 'background',
): LimitedValue[] {
  if (!isImagePaint(paint)) return [];
  const side = Math.max(Math.abs(box.width), Math.abs(box.height));
  return [
    {
      path: [field, 'naturalSize', 'width'],
      magnitude: paint.naturalSize.width,
      what: 'the width',
    },
    {
      path: [field, 'naturalSize', 'height'],
      magnitude: paint.naturalSize.height,
      what: 'the height',
    },
    {
      path: [field, 'crop', 'width'],
      magnitude: side / paint.crop.width,
      what: 'the whole image behind the crop',
    },
    {
      path: [field, 'crop', 'height'],
      magnitude: side / paint.crop.height,
      what: 'the whole image behind the crop',
    },
  ];
}

/**
 * Finds the values of an object that are not positions and are past their limit (rule
 * 3 of the board's bound): a rotation, a shape's or frame's corner radius, an image's natural size or the
 * whole source image behind its crop, and a comment pin's offset from the object it is pinned
 * to, each at most `BOARD_BOUND`. Every way in judges them alike: a command (`createObject`,
 * `createObjects` and so paste and duplicate, and any command that changes one, which may keep or
 * lower a value already past its limit and never raise it) and `importBoard`. A value that is not
 * finite is past every limit.
 *
 * @param object - A valid object.
 * @returns One issue per value past its limit.
 */
export function findValueLimitIssues(object: BoardObject): ValueLimitIssue[] {
  return limitedValuesOf(object)
    .filter(({ magnitude }) => !(magnitude <= BOARD_BOUND))
    .map(({ path, magnitude, what }) => ({
      path,
      magnitude,
      limit: BOARD_BOUND,
      message: `${what} is ${String(magnitude)}, past its limit of ${String(BOARD_BOUND)}`,
    }));
}
