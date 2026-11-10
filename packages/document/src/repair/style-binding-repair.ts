import {
  isSameTextStyle,
  isSameValue,
  shadowLayersOf,
  type BoardObject,
  type ObjectId,
  type StyleId,
  type TextStyle,
} from '@canvas/schema';

import type { TextStylePatch } from '../codec/style-attributes.js';
import { runsOf, textStylePatchOf } from '../commands/styles/style-support.js';
import { SYSTEM_ORIGIN } from '../origin/transaction-origin.js';
import type { DocumentStore, DocumentTransaction } from '../store/document-store.js';

// The style binding repair: a run's typography fields and its
// `textStyleId` are separate attributes, and an object's `shadow` and `effectStyleId` separate
// fields, so two concurrent edits (two updates of one style, or an update beside a direct restyle)
// can merge into a run or object still naming a style whose values it no longer holds. After
// every applied update and every undo or redo, each writer rewrites what the change touched to
// its style's current value: the style wins, as a command applying it would write. Every writer
// computes the same writes from the same merged board, so they converge; a pass over a consistent
// board writes nothing. A style the board lacks is left alone (its users keep their values,
// `unknown-text-style`).

/** One range to rewrite to its text style's value. */
interface RangeRepair {
  readonly id: ObjectId;
  readonly index: number;
  readonly length: number;
  readonly patch: TextStylePatch;
}

/**
 * Tells whether a run's style holds its text style's value (the colour is the run's own).
 *
 * @param style - The run's style.
 * @param patch - The style's value as a patch.
 * @returns True when every governed field matches.
 */
function holdsStyle(style: TextStyle, patch: TextStylePatch): boolean {
  const { textStyleId, fontVariations, fontFeatures, postScriptName, ...values } = patch;
  // A board text style never governs the run's language or link: the run's
  // own are kept.
  return isSameTextStyle(style, {
    ...style,
    ...values,
    lang: style.lang,
    link: style.link,
    fontVariations: fontVariations ?? undefined,
    fontFeatures: fontFeatures ?? undefined,
    postScriptName: postScriptName ?? undefined,
    textStyleId: textStyleId ?? undefined,
  });
}

/**
 * The ranges of an object's runs that name a text style without holding its value.
 *
 * @param store - The store.
 * @param object - The object.
 * @returns The ranges to rewrite.
 */
function staleRanges(store: DocumentStore, object: BoardObject): RangeRepair[] {
  const table = store.readTextStyles();
  const repairs: RangeRepair[] = [];
  let index = 0;
  for (const run of runsOf(object)) {
    const styleId = run.style.textStyleId;
    const entry = styleId === undefined ? undefined : table.get(styleId);
    if (entry !== undefined) {
      const patch = textStylePatchOf(entry.value, entry.id);
      if (!holdsStyle(run.style, patch))
        repairs.push({ id: object.id, index, length: run.length, patch });
    }
    index += run.length;
  }
  return repairs;
}

/**
 * The layers a shape or frame should hold for its effect style, when it holds others.
 *
 * @param store - The store.
 * @param object - The object.
 * @returns The layers to write, or `undefined` when it holds its style's or names none.
 */
function staleLayers(
  store: DocumentStore,
  object: BoardObject,
): ReturnType<typeof shadowLayersOf> | undefined {
  if (object.type !== 'shape' && object.type !== 'frame') return undefined;
  const styleId = object.effectStyleId;
  const entry = styleId === undefined ? undefined : store.readEffectStyles().get(styleId);
  if (entry === undefined) return undefined;
  const layers = entry.value.shadows;
  return isSameValue(shadowLayersOf(object.shadow), layers) ? undefined : layers;
}

/**
 * Tells whether an object names one of some styles: a run's text style or its effect style.
 *
 * @param object - The object.
 * @param styleIds - The styles.
 * @returns True when it names one.
 */
function namesAny(object: BoardObject, styleIds: ReadonlySet<StyleId>): boolean {
  if ((object.type === 'shape' || object.type === 'frame') && object.effectStyleId !== undefined) {
    if (styleIds.has(object.effectStyleId)) return true;
  }
  return runsOf(object).some(
    (run) => run.style.textStyleId !== undefined && styleIds.has(run.style.textStyleId),
  );
}

/**
 * Rewrites what a change touched to its named styles' current values, in one system
 * transaction when anything is stale.
 *
 * @param store - The writable store.
 * @param touched - What the change created, changed or removed.
 * @param changedStyles - The named styles changed since the last pass: every object naming one
 *   is checked too, since a change of the table alone touches no object (a concurrent bind).
 * @param allowsWrite - Whether repair may write an object (an agent writes no component content).
 * @returns The ids rewritten, sorted.
 */
export function repairStyleBindings(
  store: DocumentStore,
  touched: ReadonlySet<ObjectId>,
  changedStyles: ReadonlySet<StyleId>,
  allowsWrite: (previous: BoardObject | undefined, next: BoardObject | undefined) => boolean,
): ObjectId[] {
  const scope = new Set(touched);
  if (changedStyles.size > 0) {
    for (const object of store.read().objects.values()) {
      if (namesAny(object, changedStyles)) scope.add(object.id);
    }
  }
  const ranges: RangeRepair[] = [];
  const layers = new Map<ObjectId, ReturnType<typeof shadowLayersOf>>();
  for (const id of scope) {
    const object = store.get(id);
    if (object === undefined || !allowsWrite(object, object)) continue;
    ranges.push(...staleRanges(store, object));
    const stale = staleLayers(store, object);
    if (stale !== undefined) layers.set(id, stale);
  }
  if (ranges.length === 0 && layers.size === 0) return [];
  store.transact(SYSTEM_ORIGIN, (transaction: DocumentTransaction) => {
    for (const { id, index, length, patch } of ranges)
      transaction.formatText(id, index, length, patch);
    for (const [id, shadow] of layers) transaction.patchObject(id, { shadow: [...shadow] });
  });
  return [...new Set([...ranges.map(({ id }) => id), ...layers.keys()])].sort();
}
