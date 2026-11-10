import * as Y from 'yjs';

import {
  fontVariationAxesSchema,
  isCharacterBoundary,
  isSameFontVariations,
  MAX_FONT_VARIATION_AXES,
  mergeFontVariations,
  restyledFace,
  textStyleSchema,
  type BoardObject,
  type TextStyle,
} from '@canvas/schema';

import { EMPTY_TEXT_STYLE_KEY, readRichText, TEXT_KEY } from '../codec/rich-text-codec.js';
import {
  copyTextStyle,
  styleFromAttributes,
  stylePatchToAttributes,
  type TextStylePatch,
  styleToAttributes,
} from '../codec/style-attributes.js';
import { sliceRuns } from '../codec/text-runs.js';

import { DocumentWriteError } from './document-write-error.js';

/** Validates the style fields of a restyle: any subset of a text style. */
const textStylePatchSchema = textStyleSchema.partial().extend({
  textStyleId: textStyleSchema.shape.textStyleId.unwrap().nullable().optional(),
  // `null` removes a range's variable-font coordinates.
  fontVariations: textStyleSchema.shape.fontVariations.unwrap().nullable().optional(),
  lang: textStyleSchema.shape.lang.unwrap().nullable().optional(),
  // `null` removes a range's OpenType features.
  fontFeatures: textStyleSchema.shape.fontFeatures.unwrap().nullable().optional(),
  postScriptName: textStyleSchema.shape.postScriptName.unwrap().nullable().optional(),
  // `null` removes a range's link.
  link: textStyleSchema.shape.link.unwrap().nullable().optional(),
  // Some axes merged into each run's coordinates; `null` removes one.
  fontVariationsAxes: fontVariationAxesSchema.optional(),
});

/** The rich text of one object, ready to edit. */
export interface TextTarget {
  /** The map holding the `Y.Text` and the style of empty text. */
  readonly host: Y.Map<unknown>;
  /** The `Y.Text`. */
  readonly text: Y.Text;
  /** The characters as they are now. */
  readonly characters: string;
  /** The object id, for error reports. */
  readonly objectId: string;
}

/**
 * Finds the rich text of an object: the body of a text or sticky, or the label of a shape or
 * connector.
 *
 * @param map - The object's map.
 * @param object - The object as it is now.
 * @returns The text to edit.
 * @throws {RangeError} When the object has no text (another type, or a `null` label).
 */
export function findTextTarget(map: Y.Map<unknown>, object: BoardObject): TextTarget {
  const hasLabel = object.type === 'shape' || object.type === 'connector';
  const host = hasLabel ? map.get('label') : map;
  const text = host instanceof Y.Map ? (host as Y.Map<unknown>).get(TEXT_KEY) : undefined;
  if (!(host instanceof Y.Map) || !(text instanceof Y.Text)) {
    throw new RangeError(`Object "${object.id}" (${object.type}) has no text to edit`);
  }
  return { host: host as Y.Map<unknown>, text, characters: text.toJSON(), objectId: object.id };
}

/**
 * Checks that `[index, index + length)` lies within the text and cuts no surrogate pair.
 *
 * @param target - The text.
 * @param index - The first code unit.
 * @param length - The number of code units.
 * @throws {RangeError} When the range is out of bounds, not made of integers, or cuts a pair.
 */
function checkRange(target: TextTarget, index: number, length: number): void {
  const { characters } = target;
  const end = index + length;
  if (!Number.isInteger(index) || !Number.isInteger(length) || index < 0 || length < 0) {
    throw new RangeError(`Text range ${String(index)}+${String(length)} is not a valid range`);
  }
  if (end > characters.length) {
    throw new RangeError(
      `Text range ${String(index)}..${String(end)} is past the end (${String(characters.length)})`,
    );
  }
  if (!isCharacterBoundary(characters, index) || !isCharacterBoundary(characters, end)) {
    throw new RangeError(`Text range ${String(index)}..${String(end)} cuts a surrogate pair`);
  }
}

/**
 * Inserts characters in one style.
 *
 * @param target - The text.
 * @param index - Where to insert, in UTF-16 code units.
 * @param characters - The characters; nothing happens when empty.
 * @param style - Their style.
 * @throws {DocumentWriteError} When the style is invalid.
 * @throws {RangeError} When the index is out of range or inside a surrogate pair.
 */
export function insertText(
  target: TextTarget,
  index: number,
  characters: string,
  style: TextStyle,
): void {
  const parsed = textStyleSchema.safeParse(style);
  if (!parsed.success) throw new DocumentWriteError(target.objectId, parsed.error.issues);
  checkRange(target, index, 0);
  if (characters.length === 0) return;
  target.text.insert(index, characters, { ...styleToAttributes(parsed.data) });
}

/**
 * Deletes characters; emptying the text keeps the style of the first deleted character as the
 * style of empty text (the prototype's `spliceRuns`, `src/text/runs.ts`).
 *
 * @param target - The text.
 * @param index - The first code unit to delete.
 * @param length - How many code units; nothing happens when 0.
 * @throws {RangeError} When the range is out of bounds or cuts a surrogate pair.
 */
export function deleteText(target: TextTarget, index: number, length: number): void {
  checkRange(target, index, length);
  if (length === 0) return;
  if (length === target.characters.length) {
    const content = readRichText(target.host);
    const firstStyle =
      typeof content === 'string' ? undefined : sliceRuns(content.runs, 0, 1)[0]?.style;
    if (firstStyle !== undefined) {
      target.host.set(EMPTY_TEXT_STYLE_KEY, copyTextStyle(firstStyle));
    }
  }
  target.text.delete(index, length);
}

/**
 * Sets some style fields on a range; on empty text, an empty range restyles the style of empty
 * text instead.
 *
 * @param target - The text.
 * @param index - The first code unit.
 * @param length - How many code units.
 * @param patch - The style fields to set.
 * @throws {DocumentWriteError} When the patch is invalid.
 * @throws {RangeError} When the range is out of bounds or cuts a surrogate pair.
 */
export function formatText(
  target: TextTarget,
  index: number,
  length: number,
  patch: TextStylePatch,
): void {
  const parsed = textStylePatchSchema.safeParse(patch);
  if (!parsed.success) throw new DocumentWriteError(target.objectId, parsed.error.issues);
  checkRange(target, index, length);
  const fields = Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  ) as TextStylePatch;
  if (length > 0) {
    const moved = movedFaceRanges(target.text, index, length, fields);
    const merged = mergedAxisRanges(target, index, length, fields);
    target.text.format(index, length, { ...stylePatchToAttributes(fields) });
    for (const [start, size] of moved) target.text.format(start, size, { postScriptName: null });
    for (const [start, size, coordinates] of merged) {
      target.text.format(start, size, { fontVariations: coordinates ?? null });
    }
    return;
  }
  const content = readRichText(target.host);
  if (target.characters.length === 0 && typeof content !== 'string') {
    const emptyStyle = content.runs[0]?.style;
    if (emptyStyle !== undefined) {
      target.host.set(
        EMPTY_TEXT_STYLE_KEY,
        copyTextStyle(restyledEmptyStyle(target, emptyStyle, fields)),
      );
    }
  }
}

/**
 * The style of empty text after a patch: the patch's fields over the stored one, where `null`
 * removes an optional field, empty coordinates or features are none, some axes merge into the
 * coordinates, and a move to another family without a face drops the face.
 *
 * @param target - The text.
 * @param emptyStyle - The style empty text has now.
 * @param fields - The patch's fields, none `undefined`.
 * @returns The new style.
 */
function restyledEmptyStyle(
  target: TextTarget,
  emptyStyle: TextStyle,
  fields: TextStylePatch,
): TextStyle {
  const {
    textStyleId,
    fontVariations,
    fontVariationsAxes,
    fontFeatures,
    lang,
    postScriptName,
    link,
    ...values
  } = fields;
  const {
    textStyleId: previousId,
    fontVariations: previous,
    fontFeatures: previousFeatures,
    lang: previousLang,
    postScriptName: previousFace,
    link: previousLink,
    ...rest
  } = {
    ...emptyStyle,
    ...values,
  };
  const nextId = textStyleId === undefined ? previousId : (textStyleId ?? undefined);
  // `null` and empty coordinates remove them, as on a range; some axes merge.
  const coordinates =
    fontVariations !== undefined
      ? (fontVariations ?? undefined)
      : fontVariationsAxes === undefined
        ? previous
        : cappedMerge(target, previous, fontVariationsAxes);
  // `null` and empty features remove them, as on a range.
  const features = fontFeatures === undefined ? previousFeatures : (fontFeatures ?? undefined);
  // `null` removes the language.
  const nextLang = lang === undefined ? previousLang : (lang ?? undefined);
  // `null` removes the link.
  const nextLink = link === undefined ? previousLink : (link ?? undefined);
  // `null` removes the face name.
  // A face belongs to its family: a move to another family without one drops it.
  const nextFace = restyledFace(
    { fontFamily: emptyStyle.fontFamily, postScriptName: previousFace },
    { fontFamily: values.fontFamily, postScriptName },
  );
  return {
    ...rest,
    ...(coordinates === undefined || Object.keys(coordinates).length === 0
      ? {}
      : { fontVariations: coordinates }),
    ...(features === undefined || Object.keys(features).length === 0
      ? {}
      : { fontFeatures: features }),
    ...(nextId === undefined ? {} : { textStyleId: nextId }),
    ...(nextLang === undefined ? {} : { lang: nextLang }),
    ...(nextFace === undefined ? {} : { postScriptName: nextFace }),
    ...(nextLink === undefined ? {} : { link: nextLink }),
  };
}

/**
 * The ranges whose face a family patch leaves stale: a face belongs to its family, so
 * characters the patch moves to another family without naming a face lose theirs. Characters
 * already in that family keep it. Read before the patch is applied.
 *
 * @param text - The text, before the patch.
 * @param index - The first code unit patched.
 * @param length - How many code units.
 * @param fields - The patch's fields.
 * @returns The `[start, length]` ranges to clear.
 */
function movedFaceRanges(
  text: Y.Text,
  index: number,
  length: number,
  fields: TextStylePatch,
): readonly (readonly [number, number])[] {
  const family = fields.fontFamily;
  if (family === undefined || fields.postScriptName !== undefined) return [];
  const ranges: [number, number][] = [];
  let offset = 0;
  for (const op of text.toDelta() as readonly DeltaOp[]) {
    const size = typeof op.insert === 'string' ? op.insert.length : 1;
    const start = Math.max(offset, index);
    const end = Math.min(offset + size, index + length);
    const style = styleFromAttributes(op.attributes);
    if (start < end && restyledFace(style, { fontFamily: family }) !== style.postScriptName) {
      ranges.push([start, end - start]);
    }
    offset += size;
    if (offset >= index + length) break;
  }
  return ranges;
}

/**
 * The ranges of a restyle whose coordinates change by axis: each stretch of the range
 * in one run, with that run's coordinates and the patch's axes merged. None when the patch sets
 * no axes, or sets the whole record, which wins. Read before the patch is applied.
 *
 * @param target - The text, before the patch.
 * @param index - The first code unit patched.
 * @param length - How many code units.
 * @param fields - The patch's fields.
 * @returns The `[start, length, coordinates]` writes; undefined coordinates for none left.
 * @throws {DocumentWriteError} When a run would be left with more axes than a style may have.
 */
function mergedAxisRanges(
  target: TextTarget,
  index: number,
  length: number,
  fields: TextStylePatch,
): readonly (readonly [number, number, Readonly<Record<string, number>> | undefined])[] {
  const axes = fields.fontVariationsAxes;
  if (axes === undefined || fields.fontVariations !== undefined) return [];
  const writes: [number, number, Readonly<Record<string, number>> | undefined][] = [];
  let offset = 0;
  for (const op of target.text.toDelta() as readonly DeltaOp[]) {
    const size = typeof op.insert === 'string' ? op.insert.length : 1;
    const start = Math.max(offset, index);
    const end = Math.min(offset + size, index + length);
    if (start < end) {
      const current = styleFromAttributes(op.attributes).fontVariations;
      const merged = cappedMerge(target, current, axes);
      // A run the axes leave as it is is not written.
      if (!isSameFontVariations(current, merged)) writes.push([start, end - start, merged]);
    }
    offset += size;
    if (offset >= index + length) break;
  }
  return writes;
}

/**
 * A run's coordinates with some axes changed, refused when that leaves more axes than a text style
 * may have (the reader would drop the whole record).
 *
 * @param target - The text, for the error's object id.
 * @param current - The run's coordinates.
 * @param axes - The axes to change.
 * @returns The merged coordinates; undefined for none left.
 * @throws {DocumentWriteError} When the merge has more than `MAX_FONT_VARIATION_AXES` axes.
 */
function cappedMerge(
  target: TextTarget,
  current: Readonly<Record<string, number>> | undefined,
  axes: Readonly<Record<string, number | null>>,
): Readonly<Record<string, number>> | undefined {
  const merged = mergeFontVariations(current, axes);
  if (Object.keys(merged ?? {}).length > MAX_FONT_VARIATION_AXES) {
    throw new DocumentWriteError(target.objectId, [
      {
        path: ['fontVariationsAxes'],
        message: `A run may set at most ${String(MAX_FONT_VARIATION_AXES)} axes.`,
      },
    ]);
  }
  return merged;
}

/** One op of a text's delta: inserted characters and their attributes. */
interface DeltaOp {
  readonly insert: unknown;
  readonly attributes?: unknown;
}
