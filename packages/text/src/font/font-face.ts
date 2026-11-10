import type { FontWeight, TextStyle } from '@canvas/schema';

import { fallbackFamily } from './fallback-family.js';

/**
 * Identifies one font face: a family in one weight and slant, and for a face that differs beyond
 * them (a condensed or display face) its PostScript name. The schema's `TextStyle`
 * allows the nine CSS weights, an italic flag and a face name, so these are the faces a
 * run can ask for.
 */
export interface FontFaceKey {
  /** The family name, for example `Liberation Sans`. */
  readonly family: string;
  /** 100 to 900 in steps of 100 (400 regular, 700 bold). */
  readonly weight: FontWeight;
  /** Whether this is the italic face. */
  readonly isItalic: boolean;
  /** The face's PostScript name; absent for a family's plain face. */
  readonly postScriptName?: string;
}

/**
 * The string id of a face, used as a map key in the font library, the layout job's metrics and
 * the glyph atlas: `weight|slant|family`, for example `700|i|Liberation Sans`. The family comes
 * last, so a family name containing `|` cannot collide with another face. A named face
 * marks its slant in capitals, which no nameless id has, and adds its name, length-prefixed,
 * before the family: `700|N|19:Inter-CondensedBold|Inter`. A face without one keeps the id it
 * always had, and no family name can make a nameless id equal a named one.
 *
 * @param face - The face.
 * @returns Its id.
 */
export function fontFaceId(face: FontFaceKey): string {
  const weight = String(face.weight);
  const name = face.postScriptName;
  if (name === undefined) return `${weight}|${face.isItalic ? 'i' : 'n'}|${face.family}`;
  return `${weight}|${face.isItalic ? 'I' : 'N'}|${String(name.length)}:${name}|${face.family}`;
}

/**
 * The face a text style asks for (the prototype's `fontKeyOf`, `src/text/style.ts`).
 *
 * @param style - A run's style.
 * @returns Its family, weight and slant, and its face name when it names one.
 */
export function fontFaceOf(style: TextStyle): FontFaceKey {
  const face = { family: style.fontFamily, weight: style.weight, isItalic: style.italic };
  const name = style.postScriptName;
  return name === undefined ? face : { ...face, postScriptName: name };
}

/**
 * The weights to try for a desired one, nearest first, as CSS matches font weights
 * (CSS Fonts 4 §5.2): from 400 to 500, the weights up to 500 ascending, then those below
 * descending, then those above 500 ascending; below 400, those at or below descending, then those
 * above ascending; above 500, those at or above ascending, then those below descending. Pure.
 *
 * @param desired - The weight asked for.
 * @param available - The weights there are.
 * @returns The available weights, in the order to try them.
 */
export function nearestWeights(
  desired: FontWeight,
  available: readonly FontWeight[],
): FontWeight[] {
  const ascending = [...new Set(available)].sort((first, second) => first - second);
  const below = ascending.filter((weight) => weight < desired).reverse();
  const atOrAbove = ascending.filter((weight) => weight >= desired);
  if (desired >= 400 && desired <= 500) {
    const upTo500 = atOrAbove.filter((weight) => weight <= 500);
    return [...upTo500, ...below, ...atOrAbove.filter((weight) => weight > 500)];
  }
  if (desired < 400) {
    const atOrBelow = ascending.filter((weight) => weight <= desired).reverse();
    return [...atOrBelow, ...ascending.filter((weight) => weight > desired)];
  }
  return [...atOrAbove, ...below];
}

function isSameFace(first: FontFaceKey, second: FontFaceKey): boolean {
  return (
    first.family === second.family &&
    first.weight === second.weight &&
    first.isItalic === second.isItalic &&
    first.postScriptName === second.postScriptName
  );
}

/**
 * Picks the face to draw a requested face with, from the faces that are loaded, as CSS matches
 * fonts (CSS Fonts 4, §5.2: style before weight): the exact face; else the same family's
 * nearest weight in the requested slant, then upright, then in any slant ({@link nearestWeights},
 * A medium draws regular, a semibold bold, a bold italic without its face the italic);
 * else the first loaded face, the default family, so text always renders. The prototype never substituted a bold or italic
 * (`src/fonts/catalog.ts`, `pickFace`); here a missing face degrades rather than disappears.
 * A face name picks that face of the family first, whatever its weight and slant; a
 * name the family lacks, or no name, matches among the family's plain (unnamed) faces, and only
 * a family with no plain face matches among its named ones.
 *
 * @param available - The loaded faces; the first is the default.
 * @param wanted - The face a run asks for.
 * @returns The face to use, or `undefined` when nothing is loaded.
 */
export function resolveFontFace(
  available: readonly FontFaceKey[],
  wanted: FontFaceKey,
): FontFaceKey | undefined {
  const name = wanted.postScriptName;
  if (name !== undefined) {
    const named = available.find(
      (face) => face.family === wanted.family && face.postScriptName === name,
    );
    if (named !== undefined) return named;
  }
  const plainWanted = withoutName(wanted);
  const exact = available.find((face) => isSameFace(face, plainWanted));
  if (exact !== undefined) return exact;
  const inFamily = available.filter((face) => face.family === wanted.family);
  const plain = inFamily.filter((face) => face.postScriptName === undefined);
  const family = plain.length > 0 ? plain : inFamily;
  for (const slanted of [
    family.filter((face) => face.isItalic === wanted.isItalic),
    family.filter((face) => !face.isItalic),
    family,
  ]) {
    const [weight] = nearestWeights(
      wanted.weight,
      slanted.map((face) => face.weight),
    );
    const match = slanted.find((face) => face.weight === weight);
    if (match !== undefined) return match;
  }
  const fallback = fallbackFamily(wanted.family);
  if (fallback !== wanted.family && available.some((face) => face.family === fallback))
    return resolveFontFace(available, { ...plainWanted, family: fallback });
  return available[0];
}

/**
 * A face key without its name: the plain face of the same family, weight and slant.
 *
 * @param face - The key.
 * @returns It without `postScriptName`.
 */
function withoutName(face: FontFaceKey): FontFaceKey {
  return { family: face.family, weight: face.weight, isItalic: face.isItalic };
}
