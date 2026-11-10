import { z } from 'zod';

import { objectIdSchema, type BoardObject, type ObjectId } from '@canvas/schema';

import type { TextStylePatch } from '../codec/style-attributes.js';
import type { ObjectPatch } from '../store/document-store.js';
import { findUnscalableSizeIssues } from '../store/door-values.js';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError, errorsFromIssues, type CommandError } from './command-error.js';
import { accept, reject, type BoardReader, type Command } from './command.js';
import { croppedImageBox } from './image-crop-box.js';
import { hasMeasuredBody, measuredSizeSchema, type MeasuredSize } from './measured-size.js';
import {
  definedFields,
  STYLE_FIELDS_BY_TYPE,
  stylePatchSchema,
  type StylePatch,
} from './style-fields.js';
import { planEffectRestyle, planTextRestyle } from './styles/restyle-named.js';
import type { BoundRange } from './styles/style-support.js';

/** Validates the input of {@link setStyleCommand}. */
export const setStyleInputSchema = z
  .strictObject({
    /** One style patch per object. */
    changes: z
      .array(
        z.strictObject({
          /** The object to restyle. */
          id: objectIdSchema,
          /** The fields to set. */
          style: stylePatchSchema,
          /**
           * A text's or sticky's measured size after the restyle, written in the same
           * transaction, so the stored bounds follow the new style in one undo step.
           */
          size: measuredSizeSchema
            .optional()
            .describe("A text's or sticky's measured size after the restyle, world units."),
        }),
      )
      .min(1)
      .describe('One style patch per object.'),
  })
  .describe(
    "Sets appearance fields of objects (fills, strokes, an image's border, text style), each object type taking its own fields.",
  );

/** What {@link setStyleCommand} returns. */
export interface SetStyleResult {
  /** The objects restyled, in input order. */
  readonly styledIds: readonly ObjectId[];
}

/** One object's planned restyle. */
export interface PlannedRestyle {
  /** The object id. */
  readonly id: ObjectId;
  /** The appearance fields to write, and the measured size when given. */
  readonly patch: ObjectPatch;
  /** Text style fields to set on the whole text, or `null`. */
  readonly textStyle: TextStylePatch | null;
  /** The text's length in UTF-16 code units, the range `textStyle` covers. */
  readonly textLength: number;
  /** The runs whose board text style the restyle detaches, after `textStyle`. */
  readonly detach: readonly BoundRange[];
}

/**
 * The length of the text `textStyle` would restyle, or `null` when the object has none.
 *
 * @param object - The object.
 * @returns The length in UTF-16 code units, or `null`.
 */
function styledTextLength(object: BoardObject): number | null {
  if (object.type === 'shape' || object.type === 'connector') {
    return object.label?.text.length ?? null;
  }
  return 'text' in object ? object.text.length : null;
}

/**
 * Plans one object's restyle, reporting fields its type does not take, and a measured size for
 * an object without a body of its own (a shape's or connector's label has none).
 *
 * @param board - The board before the command.
 * @param object - The object as it is.
 * @param change - The entry.
 * @param change.style - The style patch.
 * @param change.size - The measured size, for a text or sticky.
 * @param path - The input path of the entry.
 * @param errors - Where to add the problems.
 * @returns The plan, or `undefined` when the restyle is refused.
 */
function planRestyle(
  board: BoardReader,
  object: BoardObject,
  change: { readonly style: StylePatch; readonly size?: MeasuredSize | undefined },
  path: readonly (string | number)[],
  errors: CommandError[],
): PlannedRestyle | undefined {
  const { style, size } = change;
  if (size !== undefined && !hasMeasuredBody(object.type)) {
    const message = `a ${object.type} has no measured size of its own`;
    errors.push(commandError('unsupported-type', object.id, [...path, 'size'], message));
    return undefined;
  }
  const allowed: readonly string[] = STYLE_FIELDS_BY_TYPE[object.type];
  const refused = Object.keys(style).filter((field) => !allowed.includes(field));
  for (const field of refused) {
    const message = `a ${object.type} has no style field "${field}"`;
    errors.push(commandError('unsupported-type', object.id, [...path, 'style', field], message));
  }
  if (refused.length > 0) return undefined;
  const { textStyle, ...fields } = style;
  const textLength = textStyle === undefined ? 0 : styledTextLength(object);
  if (textLength === null) {
    const message = `${object.type} "${object.id}" has no label to restyle`;
    const textPath = [...path, 'style', 'textStyle'];
    errors.push(commandError('unsupported-type', object.id, textPath, message));
    return undefined;
  }
  // A crop moves and resizes the image's box with it, so the part still shown stays in place.
  // The box is derived from the image's size, and from one that is not finite (a
  // peer's) no place at all; the crop is refused naming the size, which it derives from, rather
  // than the place it would derive. A finite size past the door's range derives a finite box,
  // which the door and the board's bound judge as any other.
  const unplaced =
    object.type === 'image' && fields.crop !== undefined ? findUnscalableSizeIssues(object) : [];
  if (unplaced.length > 0) {
    errors.push(...errorsFromIssues('invalid-object', object.id, unplaced));
    return undefined;
  }
  const box =
    object.type === 'image' && fields.crop !== undefined
      ? croppedImageBox(object, fields.crop)
      : undefined;
  const { colorMode, effectStyleId, shadow, ...rest } = fields;
  const stylePath = [...path, 'style'];
  // A named effect style's layers and id, or a detach.
  const effectPatch = planEffectRestyle(
    board,
    object,
    { effectStyleId, shadow },
    stylePath,
    errors,
  );
  const text =
    textStyle === undefined
      ? undefined
      : planTextRestyle(board, object, textStyle, [...stylePath, 'textStyle'], errors);
  if (effectPatch === undefined || (textStyle !== undefined && text === undefined)) {
    return undefined;
  }
  const cleared = clearedFields(object, colorMode, rest);
  const patch = { ...definedFields(rest), ...cleared, ...effectPatch, ...size, ...box };
  if (checkObject(board, { ...object, ...patch }, errors) === undefined) return undefined;
  return {
    id: object.id,
    patch,
    textStyle: text?.patch ?? null,
    textLength,
    detach: text?.detach ?? [],
  };
}

/** The optional style fields an explicit `undefined` removes: absent is their default. */
const REMOVABLE_FIELDS = [
  'cornerRadius',
  'opacity',
  'isHidden',
  'aspect',
  'link',
  'elbowMiddle',
  'curvePoint',
] as const;

/**
 * The optional style fields a restyle clears, each as an explicit `undefined` that leaves it out
 * of the style group the codec writes: `colorMode: null` clears the mode, an explicit
 * `cornerRadius: undefined` removes a frame's radius, absent being sharp, and an
 * explicit `opacity: undefined` a layer's opacity, absent being opaque, and an explicit
 * `isHidden: undefined` a layer's visibility, absent being shown, and an explicit
 * `aspect: undefined` a sticky's aspect, absent being square, and an explicit
 * `link: undefined` a text's, sticky's or image's link, and an explicit `elbowMiddle:
 * undefined` or `curvePoint: undefined` a connector's moved route handle, absent being automatic.
 * An image's
 * opacity is required, so its removal changes nothing.
 *
 * @param object - The object restyled.
 * @param colorMode - The patch's colour mode.
 * @param rest - The patch's other fields.
 * @returns The cleared fields, and a set colour mode.
 */
function clearedFields(
  object: BoardObject,
  colorMode: StylePatch['colorMode'],
  rest: Readonly<Record<string, unknown>>,
): ObjectPatch {
  const cleared: Record<string, unknown> =
    colorMode === undefined ? {} : { colorMode: colorMode ?? undefined };
  for (const field of REMOVABLE_FIELDS) {
    const isRequired = field === 'opacity' && object.type === 'image';
    if (field in rest && rest[field] === undefined && !isRequired) cleared[field] = undefined;
  }
  return cleared;
}

/**
 * `setStyle`: sets appearance fields on objects, each type taking its
 * own ({@link STYLE_FIELDS_BY_TYPE}): colours (a tuple, `'ink'` where a stroke or text takes it,
 * or a colour token `{ token }`), strokes and their dash, join and cap,
 * fills, caps, routes, shape kind, a frame's, main's or instance's `colorMode` (`null` to
 * inherit),
 * alignment, a frame's background, clipping and name display, a shape's or frame's drop shadow,
 * any layer's opacity, an image's crop (with the box that
 * keeps what stays shown in place: `croppedImageBox`). `textStyle` sets text style fields (font,
 * size, colour, weight, italic) on the whole text of a text, sticky or labelled shape or
 * connector, field by field, so a concurrent restyle of other fields survives. Only the given
 * fields are written. A field the object's type does not take is refused, not ignored. A text's
 * or sticky's change may carry its measured `size` after the restyle (validated as
 * `setTextRuns` validates it: positive; refused for a shape or connector, whose label has no box
 * of its own), written in the same transaction: restyling many texts is one command, one change
 * set and one undo step, with every box's bounds following.
 */
export const setStyleCommand: Command<
  typeof setStyleInputSchema,
  readonly PlannedRestyle[],
  SetStyleResult
> = {
  name: 'setStyle',
  description:
    "Sets appearance fields of objects (fills, strokes, an image's border, text style), each object type taking its own fields.",
  input: setStyleInputSchema,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      input.changes,
      (change) => change.id,
      (index) => ['changes', index],
    );
    const plan = named.flatMap(
      ({ object, entry, path }) => planRestyle(context.board, object, entry, path, errors) ?? [],
    );
    return errors.length > 0 ? reject(errors) : accept(plan);
  },
  apply(transaction, input, plan) {
    for (const { id, patch, textStyle, textLength, detach } of plan) {
      transaction.patchObject(id, patch);
      if (textStyle !== null) transaction.formatText(id, 0, textLength, textStyle);
      for (const range of detach) {
        transaction.formatText(range.id, range.index, range.length, { textStyleId: null });
      }
    }
    return { styledIds: plan.map(({ id }) => id) };
  },
};
