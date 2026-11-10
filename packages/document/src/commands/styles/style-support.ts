import {
  MAX_EFFECT_STYLES,
  MAX_TEXT_STYLES,
  styleNameKey,
  type BoardObject,
  type ObjectId,
  type StyleId,
  type StyleRun,
  type TextStyleValue,
} from '@canvas/schema';

import type { TextStylePatch } from '../../codec/style-attributes.js';
import type { StyleEntry, StyleKind, StyleTable } from '../../styles/style-map.js';
import { commandError, type CommandError } from '../command-error.js';
import type { BoardReader, CommandContext } from '../command.js';

// What the named style commands share: reading a kind's table, the
// refusals (as the colour tokens'), and finding the runs and objects that name a
// style, which an update rewrites and a delete detaches.

/** Each kind's word in messages. */
const KIND_WORD: Readonly<Record<StyleKind, string>> = { text: 'text', effect: 'effect' };

/** Each kind's limit. */
const LIMITS: Readonly<Record<StyleKind, number>> = {
  text: MAX_TEXT_STYLES,
  effect: MAX_EFFECT_STYLES,
};

/**
 * A kind's style table as the board holds it; empty for a reader without it.
 *
 * @param board - The board.
 * @param kind - Text or effect styles.
 * @returns The entries by id.
 */
export function stylesOf<Kind extends StyleKind>(board: BoardReader, kind: Kind): StyleTable<Kind> {
  const table = kind === 'text' ? board.readTextStyles?.() : board.readEffectStyles?.();
  return (table ?? new Map()) as StyleTable<Kind>;
}

/**
 * The entry of an existing style, or a `missing-style` refusal.
 *
 * @param board - The board.
 * @param kind - Text or effect styles.
 * @param id - The style.
 * @param path - Where the id is in the input.
 * @param errors - Where to add the refusal.
 * @returns The entry, or `undefined`.
 */
export function existingStyle<Kind extends StyleKind>(
  board: BoardReader,
  kind: Kind,
  id: StyleId,
  path: readonly (string | number)[],
  errors: CommandError[],
): StyleEntry<Kind> | undefined {
  const entry = stylesOf(board, kind).get(id) as StyleEntry<Kind> | undefined;
  if (entry === undefined) {
    const message = `there is no ${KIND_WORD[kind]} style "${id}"`;
    errors.push(commandError('missing-style', null, path, message));
  }
  return entry;
}

/**
 * The refusal of an agent changing a style it did not create (`not-own-style`, kind permission),
 * as an agent may change only its own colour tokens. A person may change any.
 *
 * @param context - The command's context.
 * @param kind - Text or effect styles.
 * @param entry - The style.
 * @returns The refusal, or `undefined` when allowed.
 */
export function agentStyleError(
  context: CommandContext,
  kind: StyleKind,
  entry: StyleEntry<StyleKind>,
): CommandError | undefined {
  if (context.origin.kind !== 'agent') return undefined;
  if (entry.createdBy === context.origin.principalId) return undefined;
  const message = `an agent may change only the ${KIND_WORD[kind]} styles it created, not "${entry.id}"`;
  return commandError('not-own-style', null, ['id'], message);
}

/**
 * The refusal of a creation on a board already holding a kind's limit of styles
 * (`too-many-styles`).
 *
 * @param board - The board.
 * @param kind - Text or effect styles.
 * @returns The refusal, or `undefined`.
 */
export function styleLimitError(board: BoardReader, kind: StyleKind): CommandError | undefined {
  const count = stylesOf(board, kind).size;
  if (count < LIMITS[kind]) return undefined;
  const message = `This board has ${String(count)} ${KIND_WORD[kind]} styles; the limit is ${String(LIMITS[kind])}`;
  return commandError('too-many-styles', null, [], message);
}

/**
 * The refusal of a name another style of the kind has, ignoring case (`duplicate-style-name`).
 *
 * @param board - The board.
 * @param kind - Text or effect styles.
 * @param name - The name.
 * @param ownId - The style being renamed, whose own name does not count; `undefined` for a new one.
 * @returns The refusal, or `undefined`.
 */
export function duplicateStyleNameError(
  board: BoardReader,
  kind: StyleKind,
  name: string,
  ownId: StyleId | undefined,
): CommandError | undefined {
  const key = styleNameKey(name);
  const isTaken = [...stylesOf(board, kind).values()].some(
    (entry) => entry.id !== ownId && styleNameKey(entry.name) === key,
  );
  if (!isTaken) return undefined;
  const message = `another ${KIND_WORD[kind]} style of this board is named "${name}"`;
  return commandError('duplicate-style-name', null, ['name'], message);
}

/**
 * The text patch that sets a text style's every field on a range, with its id (or without, for
 * `textStyleId: null`): a letter-spacing, line-height or variable-font coordinates the style
 * leaves out are set to none, auto and none, which the codec stores as no attribute.
 *
 * @param value - The style's value.
 * @param textStyleId - The style's id, or `null` to set the values without one.
 * @returns The patch.
 */
export function textStylePatchOf(
  value: TextStyleValue,
  textStyleId: StyleId | null,
): TextStylePatch {
  return {
    fontFamily: value.fontFamily,
    fontSize: value.fontSize,
    weight: value.weight,
    italic: value.italic,
    letterSpacing: value.letterSpacing ?? { value: 0, unit: 'px' },
    lineHeight: value.lineHeight ?? 'auto',
    fontVariations: value.fontVariations ?? null,
    fontFeatures: value.fontFeatures ?? null,
    postScriptName: value.postScriptName ?? null,
    textStyleId,
  };
}

/** A range of an object's text whose runs name one text style. */
export interface BoundRange {
  /** The object. */
  readonly id: ObjectId;
  /** The first code unit. */
  readonly index: number;
  /** How many code units. */
  readonly length: number;
}

/**
 * An object's runs: its own (a text's or sticky's), or its label's (a shape's or connector's).
 *
 * @param object - The object.
 * @returns The runs; none for an object without text.
 */
export function runsOf(object: BoardObject): readonly StyleRun[] {
  if ('runs' in object) return object.runs;
  if ('label' in object && object.label !== null) return object.label.runs;
  return [];
}

/**
 * Every range of the board's texts whose runs name a text style: one per run (a zero-length run,
 * the style of empty text, included), across every page and main.
 *
 * @param board - The board.
 * @param styleId - The text style.
 * @returns The ranges, by object id then index.
 */
export function rangesBoundTo(board: BoardReader, styleId: StyleId): BoundRange[] {
  const ranges: BoundRange[] = [];
  const objects = [...(board.read?.().objects.values() ?? [])].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
  for (const object of objects) {
    let index = 0;
    for (const run of runsOf(object)) {
      if (run.style.textStyleId === styleId) {
        ranges.push({ id: object.id, index, length: run.length });
      }
      index += run.length;
    }
  }
  return ranges;
}

/**
 * Every shape and frame of the board naming an effect style.
 *
 * @param board - The board.
 * @param styleId - The effect style.
 * @returns Their ids, sorted.
 */
export function objectsBoundTo(board: BoardReader, styleId: StyleId): ObjectId[] {
  const ids: ObjectId[] = [];
  for (const object of board.read?.().objects.values() ?? []) {
    if ((object.type === 'shape' || object.type === 'frame') && object.effectStyleId === styleId) {
      ids.push(object.id);
    }
  }
  return ids.sort();
}
