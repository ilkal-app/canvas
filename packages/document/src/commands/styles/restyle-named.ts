import {
  INK,
  MAX_FONT_VARIATION_AXES,
  mergeFontVariations,
  isSameTextStyle,
  isSameValue,
  shadowLayersOf,
  type BoardObject,
  type FontVariationAxes,
  type ShadowValue,
  type StyleId,
  type TextStyle,
} from '@canvas/schema';

import type { TextStylePatch } from '../../codec/style-attributes.js';
import type { ObjectPatch } from '../../store/document-store.js';
import { commandError, type CommandError } from '../command-error.js';
import type { BoardReader } from '../command.js';

import { existingStyle, runsOf, textStylePatchOf, type BoundRange } from './style-support.js';

// `setStyle`'s side of the named styles. A text style is applied with
// `textStyle: { textStyleId }`: its values and its id are set on every run, the run's colour
// kept; fields given beside the id win, and one that differs from the style's value leaves the
// runs without the id. A field the style governs written without an id detaches each run whose
// value it changes, and `textStyleId: null` detaches them all. An effect style is applied with
// `effectStyleId`: its layers are written to `shadow` with the id; a `shadow` written without one
// detaches the object when its layers change, and `effectStyleId: null` detaches it.

/** A text style patch as `setStyle` takes it: some fields, and optionally a style id or `null`. */
export type RestyleTextPatch = {
  readonly [
    Field in Exclude<
      keyof TextStyle,
      'textStyleId' | 'fontVariations' | 'fontFeatures' | 'lang' | 'postScriptName' | 'link'
    >
  ]?: TextStyle[Field] | undefined;
} & {
  readonly textStyleId?: StyleId | null | undefined;
  /** Variable-font coordinates; `null` removes them, as empty does. */
  readonly fontVariations?: TextStyle['fontVariations'] | null | undefined;
  /** Some axes merged into each run's coordinates; `null` removes one. */
  readonly fontVariationsAxes?: FontVariationAxes | undefined;
  /** OpenType features; `null` removes them, as empty does. */
  readonly fontFeatures?: TextStyle['fontFeatures'] | null | undefined;
  /** The text's language, or `null` to remove it; no board text style governs it. */
  readonly lang?: string | null | undefined;
  /**
   * The face's PostScript name, or `null` to remove it. A family given without one
   * clears the run's face, which belongs to its old family.
   */
  readonly postScriptName?: string | null | undefined;
  /** A link on every character, or `null` to remove every run's; no board text style governs it. */
  readonly link?: string | null | undefined;
};

/** What a restyle writes on an object's text. */
export interface PlannedTextRestyle {
  /** The fields to set on the whole text. */
  readonly patch: TextStylePatch;
  /** The runs whose style id the restyle removes, after the patch. */
  readonly detach: readonly BoundRange[];
}

/**
 * Tells whether setting some fields on a run changes a value its text style governs (anything
 * but its colour).
 *
 * @param style - The run's style.
 * @param fields - The fields set.
 * @param face - The face name set: `null` removes it, `undefined` keeps the run's.
 * @returns True when a governed value changes.
 */
function changesGovernedValue(
  style: TextStyle,
  fields: Partial<TextStyle>,
  face?: string | null,
): boolean {
  const color = style.color;
  const { postScriptName: kept, ...rest } = { ...style, ...fields, color };
  const name = face === undefined ? kept : (face ?? undefined);
  const next: TextStyle = { ...rest, textStyleId: style.textStyleId };
  return !isSameTextStyle(style, name === undefined ? next : { ...next, postScriptName: name });
}

/**
 * Plans the text side of a restyle.
 *
 * @param board - The board before the command.
 * @param object - The object.
 * @param textStyle - The `textStyle` patch.
 * @param path - The input path of `textStyle`.
 * @param errors - Where to add refusals.
 * @returns The plan, or `undefined` when refused.
 */
export function planTextRestyle(
  board: BoardReader,
  object: BoardObject,
  textStyle: RestyleTextPatch,
  path: readonly (string | number)[],
  errors: CommandError[],
): PlannedTextRestyle | undefined {
  if (exceedsAxes(object, textStyle)) {
    const message = `a run may set at most ${String(MAX_FONT_VARIATION_AXES)} axes`;
    errors.push(commandError('invalid-input', object.id, [...path, 'fontVariationsAxes'], message));
    return undefined;
  }
  const { textStyleId, fontVariations, fontFeatures, lang, postScriptName, link, ...given } =
    textStyle;
  // A face belongs to its family: a new family without a face clears the old one.
  const face =
    postScriptName !== undefined
      ? postScriptName
      : given.fontFamily === undefined
        ? undefined
        : null;
  const fields = Object.fromEntries(
    Object.entries({
      ...given,
      // No coordinates is the font's defaults: `null` is written as empty, which is never stored.
      fontVariations: fontVariations === null ? {} : fontVariations,
      // No features is the defaults: `null` is written as empty, never stored.
      fontFeatures: fontFeatures === null ? {} : fontFeatures,
    }).filter(([, value]) => value !== undefined),
  ) as Partial<Omit<TextStyle, 'textStyleId' | 'lang' | 'postScriptName' | 'link'>>;
  const facePatch: { readonly postScriptName?: string | null } =
    face === undefined ? {} : { postScriptName: face };
  // The language is the run's own, never a board text style's: it rides along with any plan.
  const language = lang === undefined ? {} : { lang };
  // So is the link: a board text style never sets or clears it.
  const runLink = link === undefined ? {} : { link };
  if (typeof textStyleId === 'string') {
    const entry = existingStyle(board, 'text', textStyleId, [...path, 'textStyleId'], errors);
    if (entry === undefined) return undefined;
    const applied = textStylePatchOf(entry.value, textStyleId);
    // The style's values as a run's style (the colour is not the style's; any one compares). A
    // style with no face has none, not a `null` one: a family given beside it without a face,
    // as the MCP inlines the style's values, then changes nothing (it was detached).
    const { postScriptName: styleFace, ...appliedRest } = applied;
    const valueStyle = {
      ...appliedRest,
      ...(styleFace === null ? {} : { postScriptName: styleFace }),
      textStyleId,
      color: INK,
    } as TextStyle;
    const isOverridden = changesGovernedValue(valueStyle, fields, face);
    return {
      patch: {
        ...applied,
        ...fields,
        ...facePatch,
        ...language,
        ...runLink,
        textStyleId: isOverridden ? null : textStyleId,
      },
      detach: [],
    };
  }
  if (textStyleId === null) {
    return {
      patch: { ...fields, ...facePatch, ...language, ...runLink, textStyleId: null },
      detach: [],
    };
  }
  const detach: BoundRange[] = [];
  let index = 0;
  for (const run of runsOf(object)) {
    if (run.style.textStyleId !== undefined && changesGovernedValue(run.style, fields, face)) {
      detach.push({ id: object.id, index, length: run.length });
    }
    index += run.length;
  }
  return { patch: { ...fields, ...facePatch, ...language, ...runLink }, detach };
}

/**
 * Plans the effect side of a restyle: the `shadow` and `effectStyleId` fields to write.
 *
 * @param board - The board before the command.
 * @param object - The object (a shape or frame).
 * @param style - The given `effectStyleId` and `shadow`, either absent.
 * @param style.effectStyleId - The style to apply, `null` to detach, or absent.
 * @param style.shadow - The shadow to write, or absent.
 * @param path - The input path of the style patch.
 * @param errors - Where to add refusals.
 * @returns The fields to patch, or `undefined` when refused.
 */
export function planEffectRestyle(
  board: BoardReader,
  object: BoardObject,
  style: {
    readonly effectStyleId?: StyleId | null | undefined;
    readonly shadow?: ShadowValue | null | undefined;
  },
  path: readonly (string | number)[],
  errors: CommandError[],
): ObjectPatch | undefined {
  const { effectStyleId, shadow } = style;
  const current =
    object.type === 'shape' || object.type === 'frame' ? object.effectStyleId : undefined;
  if (typeof effectStyleId === 'string') {
    const entry = existingStyle(board, 'effect', effectStyleId, [...path, 'effectStyleId'], errors);
    if (entry === undefined) return undefined;
    const layers = [...entry.value.shadows];
    if (shadow !== undefined && !isSameValue(shadowLayersOf(shadow), layers)) {
      return { shadow, effectStyleId: undefined } as ObjectPatch;
    }
    return { shadow: layers, effectStyleId };
  }
  if (effectStyleId === null) {
    return { ...(shadow === undefined ? {} : { shadow }), effectStyleId: undefined } as ObjectPatch;
  }
  if (shadow === undefined) return {};
  const isDetached =
    current !== undefined &&
    !isSameValue(
      shadowLayersOf(shadow),
      shadowLayersOf((object as { readonly shadow?: ShadowValue | null }).shadow),
    );
  return (isDetached ? { shadow, effectStyleId: undefined } : { shadow }) as ObjectPatch;
}

/**
 * Whether merging a restyle's axes into the object's runs would leave a run with more axes than a
 * text style may have, which the store refuses: the command refuses it first.
 *
 * @param object - The object.
 * @param textStyle - The restyle.
 * @returns True when some run would exceed the cap.
 */
function exceedsAxes(object: BoardObject, textStyle: RestyleTextPatch): boolean {
  const axes = textStyle.fontVariationsAxes;
  if (axes === undefined || textStyle.fontVariations !== undefined) return false;
  return runsOf(object).some(
    ({ style }) =>
      Object.keys(mergeFontVariations(style.fontVariations, axes) ?? {}).length >
      MAX_FONT_VARIATION_AXES,
  );
}
