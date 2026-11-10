import type { Board } from '../board/board.js';
import type { StyleId } from '../fields/style-id.js';
import type { StyleRun } from '../fields/text-style.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';

// Where a board names font families: every text run's family (text, sticky, shape and
// connector labels), an instance's override records (a text style override's family and
// override runs), a main's variant presets (the same records per axis value) and the board's
// text style table. A document stores only the family name, weight and slant, so the
// name is all a reader can check: whether a face for it is bundled, local or loaded is the
// renderer's question, not the document's.

/** One place an object names a font family. */
export interface FontFamilyUse {
  /** The family name, as stored. */
  readonly family: string;
  /** The path of the name within the object (`['runs', 2, 'style', 'fontFamily']`). */
  readonly path: readonly (string | number)[];
}

/** A family a board names, and where. */
export interface BoardFontFamily {
  /** The family name, as stored. */
  readonly family: string;
  /** The objects naming it, in ascending id order, each once. */
  readonly objectIds: readonly ObjectId[];
  /** The board text styles naming it, in ascending id order. */
  readonly textStyleIds: readonly StyleId[];
}

/**
 * Collects the families of a list of runs.
 *
 * @param runs - The runs, or undefined.
 * @param path - The runs' path.
 * @param found - Where to add them.
 */
function runUses(
  runs: readonly StyleRun[] | undefined,
  path: readonly (string | number)[],
  found: FontFamilyUse[],
): void {
  if (!Array.isArray(runs)) return;
  for (const [index, run] of (runs as readonly StyleRun[]).entries()) {
    const family: unknown = run.style.fontFamily;
    if (typeof family === 'string')
      found.push({ family, path: [...path, index, 'style', 'fontFamily'] });
  }
}

/**
 * Collects the families of override records by path: each record's text style override and
 * its runs.
 *
 * @param overrides - The records by path.
 * @param path - The records' path (`['overrides']`, `['variantPresets', 'size=large']`).
 * @param found - Where to add them.
 */
function overrideUses(
  overrides: Readonly<Record<string, unknown>>,
  path: readonly (string | number)[],
  found: FontFamilyUse[],
): void {
  for (const [key, record] of Object.entries(overrides)) {
    if (typeof record !== 'object' || record === null) continue;
    const fields = record as Readonly<Record<string, unknown>>;
    const style = fields.textStyle as { readonly fontFamily?: unknown } | undefined;
    if (typeof style?.fontFamily === 'string') {
      found.push({ family: style.fontFamily, path: [...path, key, 'textStyle', 'fontFamily'] });
    }
    runUses(fields.runs as readonly StyleRun[] | undefined, [...path, key, 'runs'], found);
  }
}

/**
 * Every place an object names a font family, in field order. Pure.
 *
 * @param object - The object.
 * @returns The uses; empty when it names none.
 */
export function fontFamilyUsesOf(object: BoardObject): FontFamilyUse[] {
  const found: FontFamilyUse[] = [];
  if ('runs' in object) runUses(object.runs, ['runs'], found);
  if ('label' in object && object.label !== null) {
    runUses(object.label.runs, ['label', 'runs'], found);
  }
  if (object.type === 'instance') overrideUses(object.overrides, ['overrides'], found);
  if (object.type === 'component' && object.variantPresets !== undefined) {
    for (const [key, records] of Object.entries(object.variantPresets)) {
      overrideUses(records, ['variantPresets', key], found);
    }
  }
  return found;
}

/**
 * Every family a board names, with the objects and text styles naming it, in ascending family
 * order (plain string order). A family named only by a text style that no run follows is
 * listed too. Pure.
 *
 * @param board - The board.
 * @returns The families; empty when the board names none.
 */
export function boardFontFamilies(board: Board): BoardFontFamily[] {
  const byFamily = new Map<string, { objects: Set<ObjectId>; styles: Set<StyleId> }>();
  const entry = (family: string) => {
    let found = byFamily.get(family);
    if (found === undefined) {
      found = { objects: new Set(), styles: new Set() };
      byFamily.set(family, found);
    }
    return found;
  };
  for (const object of board.objects.values()) {
    for (const { family } of fontFamilyUsesOf(object)) entry(family).objects.add(object.id);
  }
  for (const style of board.textStyles?.values() ?? []) {
    entry(style.value.fontFamily).styles.add(style.id);
  }
  return (
    [...byFamily.entries()]
      // Families are distinct map keys, so no two compare equal.
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([family, { objects, styles }]) => ({
        family,
        objectIds: [...objects].sort(),
        textStyleIds: [...styles].sort(),
      }))
  );
}
