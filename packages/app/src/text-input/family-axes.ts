// A family's variable-font axes and named instances, for the style panel: read from the
// family's upright 400 face once the page has loaded it, and cached per family and font revision.

import { useEffect, useSyncExternalStore } from 'react';

import { fontFaceId, readVariationAxes, type VariationAxes } from '@canvas/text';

import { isVariableFamily } from './curated-variable.js';
import {
  ensurePageFont,
  pageFontRevision,
  pageTextFonts,
  subscribePageFonts,
} from './page-fonts.js';

/** A family's axes and named instances: both empty for a static family. */
export type FamilyAxes = VariationAxes;

/** Where a family's face bytes come from, and a number that changes when more load. */
export interface FamilyFontSource {
  /**
   * The family's upright 400 face, once loaded.
   *
   * @param family - The family.
   * @returns Its bytes, or undefined until the face has loaded.
   */
  bytesOf(family: string): Uint8Array | undefined;
  /**
   * A number that changes whenever a face loads.
   *
   * @returns The revision.
   */
  revision(): number;
}

/** A static family's axes. */
const STATIC: FamilyAxes = Object.freeze({ axes: [], instances: [] });

/** What was read for each family, and at which revision: one small entry per family asked for. */
const cache = new Map<string, { readonly revision: number; readonly axes?: FamilyAxes }>();

/**
 * Each face's axes by its bytes' buffer, so a revision that loads other faces re-reads none: a
 * face's buffer is kept for as long as its face is, and its entry goes with it.
 */
const byBuffer = new WeakMap<ArrayBufferLike, FamilyAxes>();

/**
 * A face's axes, read once per buffer.
 *
 * @param bytes - The face's bytes.
 * @returns Its axes, empty for a static face.
 */
function axesOfBytes(bytes: Uint8Array): FamilyAxes {
  const known = byBuffer.get(bytes.buffer);
  if (known !== undefined) return known;
  const axes = readVariationAxes(bytes) ?? STATIC;
  byBuffer.set(bytes.buffer, axes);
  return axes;
}

/**
 * A family's axes and named instances: those of its upright 400 face's `fvar` (hidden axes kept,
 * flagged), empty lists for a static family, and undefined until the face has loaded. The face
 * is looked up once per family at each revision of the source, and parsed once per bytes.
 *
 * @param family - The family.
 * @param source - Where its face bytes come from.
 * @returns Its axes, or undefined while its face is not loaded.
 */
export function familyAxesOf(family: string, source: FamilyFontSource): FamilyAxes | undefined {
  const revision = source.revision();
  const known = cache.get(family);
  if (known?.revision === revision) return known.axes;
  const bytes = source.bytesOf(family);
  const axes = bytes === undefined ? undefined : axesOfBytes(bytes);
  cache.set(family, axes === undefined ? { revision } : { revision, axes });
  return axes;
}

/** The page's fonts as a family font source. */
const PAGE_SOURCE: FamilyFontSource = {
  bytesOf: (family) => {
    const face = pageTextFonts().get(fontFaceId({ family, weight: 400, isItalic: false }));
    return face === undefined ? undefined : new Uint8Array(face.jobResource.bytes);
  },
  revision: pageFontRevision,
};

/**
 * A family's axes and named instances on the page, for the style panel: for a bundled variable
 * family, loads its faces when it has not and renders again when they arrive; any other family is
 * static, with no axes and nothing loaded.
 *
 * @param family - The family, or undefined for none (a mixed selection).
 * @returns Its axes; undefined for none, or while its face is not loaded.
 */
export function useFamilyAxes(family: string | undefined): FamilyAxes | undefined {
  // Renders again when a face loads; familyAxesOf reads the revision itself.
  useSyncExternalStore(subscribePageFonts, pageFontRevision);
  const isVariable = family !== undefined && isVariableFamily(family);
  useEffect(() => {
    if (isVariable) void ensurePageFont(family);
  }, [family, isVariable]);
  if (family === undefined) return undefined;
  // Only the bundled variable families have axes: every other family (the static library, the
  // importer's catalogue, local fonts) is static, read without loading anything.
  return isVariable ? familyAxesOf(family, PAGE_SOURCE) : STATIC;
}
