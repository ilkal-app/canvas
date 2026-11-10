import { mergeFontVariations, type StyleRun, type TextStyle } from '@canvas/schema';

import { normalizeRuns } from './normalize-runs.js';
import { sliceRuns, splitRunsAt } from './splice-runs.js';
import { styleAt } from './style-at.js';
import { isSameStyleField, shownTextStyle, TEXT_STYLE_FIELDS } from './style-fields.js';
import type { TextStylePatch } from './text-style-patch.js';

/**
 * Sets style fields on every run covering a range, splitting runs at its ends (the prototype's
 * `applyStyle`). An empty range restyles empty text's one run and leaves other text unchanged.
 * Pure; returns new, normalised runs.
 *
 * @param runs - The runs.
 * @param start - Where the range starts, UTF-16 code units, between characters.
 * @param end - Where it ends (exclusive).
 * @param patch - The fields to set.
 * @returns The restyled runs.
 */
export function applyStyle(
  runs: readonly StyleRun[],
  start: number,
  end: number,
  patch: TextStylePatch,
): StyleRun[] {
  const [only] = runs;
  if (start >= end) {
    if (runs.length === 1 && only?.length === 0)
      return [{ length: 0, style: mergeStyle(only.style, patch) }];
    return [...runs];
  }
  const [before, rest] = splitRunsAt(runs, start);
  const [middle, after] = splitRunsAt(rest, end - start);
  const restyled = middle.map((run) => ({
    length: run.length,
    style: mergeStyle(run.style, patch),
  }));
  return normalizeRuns([...before, ...restyled, ...after]);
}

/**
 * A style with some fields replaced; a `lang` of `null` removes the language, and a
 * `postScriptName` of `null` the face name, which a new family without one drops too,
 * `fontFeatures` of `null` the feature settings, and `link` of `null` the link;
 * an underline or strikethrough of `false` removes it.
 *
 * @param style - The style.
 * @param patch - The fields to set.
 * @returns The new style.
 */
export function mergeStyle(style: TextStyle, patch: TextStylePatch): TextStyle {
  const { lang, postScriptName, fontVariationsAxes, fontFeatures, link, ...fields } = patch;
  const {
    lang: current,
    postScriptName: currentFace,
    fontFeatures: currentFeatures,
    link: currentLink,
    fontVariations: wholeCoordinates,
    underline: isUnderlined,
    strikethrough: isStruckThrough,
    ...rest
  } = { ...style, ...fields };
  // Some axes merge into the run's own coordinates; the whole record wins.
  const coordinates =
    fontVariationsAxes === undefined || fields.fontVariations !== undefined
      ? wholeCoordinates
      : mergeFontVariations(wholeCoordinates, fontVariationsAxes);
  // `null` removes the language; absent keeps the run's.
  const next = lang === undefined ? current : (lang ?? undefined);
  // A face belongs to its family: a new family without a face drops the old one.
  const isNewFamily = fields.fontFamily !== undefined && fields.fontFamily !== style.fontFamily;
  const keptFace = isNewFamily ? undefined : currentFace;
  const face = postScriptName === undefined ? keptFace : (postScriptName ?? undefined);
  // `null` removes the feature settings; none set is none stored.
  const features = fontFeatures === undefined ? currentFeatures : (fontFeatures ?? undefined);
  const hasFeatures = features !== undefined && Object.keys(features).length > 0;
  // `null` removes the link; absent keeps the run's.
  const nextLink = link === undefined ? currentLink : (link ?? undefined);
  return {
    ...rest,
    ...(coordinates === undefined ? {} : { fontVariations: coordinates }),
    ...(next === undefined ? {} : { lang: next }),
    ...(face === undefined ? {} : { postScriptName: face }),
    ...(hasFeatures ? { fontFeatures: features } : {}),
    ...(nextLink === undefined ? {} : { link: nextLink }),
    // `false` is no decoration, stored as none so the run merges with plain text.
    ...(isUnderlined === true ? { underline: true } : {}),
    ...(isStruckThrough === true ? { strikethrough: true } : {}),
  };
}

/**
 * The style fields every character of a range shares (the prototype's `commonStyle`): a field
 * that differs anywhere in the range is left out, which the style panel shows as mixed. An
 * empty range gives the whole style typing at `start` would continue (`styleAt`). No
 * letter-spacing, an auto line-height and no variable-font coordinates (`{}`)
 * are spelt out (`shownTextStyle`), so they are told apart from mixed. Pure.
 *
 * @param runs - The runs.
 * @param start - Where the range starts, UTF-16 code units.
 * @param end - Where it ends (exclusive).
 * @returns The shared fields.
 */
export function commonStyle(runs: readonly StyleRun[], start: number, end: number): TextStylePatch {
  if (start >= end) return shownTextStyle(styleAt(runs, start));
  const [first, ...others] = sliceRuns(runs, start, end).map(({ style }) => shownTextStyle(style));
  if (first === undefined) return shownTextStyle(styleAt(runs, start));
  const shared = TEXT_STYLE_FIELDS.filter((field) =>
    others.every((style) => isSameStyleField(field, first[field], style[field])),
  );
  return Object.fromEntries(shared.map((field) => [field, first[field]]));
}
