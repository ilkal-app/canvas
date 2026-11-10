import type { Board } from '../board/board.js';
import type { StyleRun } from '../fields/text-style.js';
import type { BoardObject } from '../objects/board-object.js';
import type { BoardIssue } from '../rules/board-issue.js';

// Where an object names a board style: each run's `textStyleId` (text,
// sticky, shape and connector labels, an instance override's runs) and a shape's or frame's
// `effectStyleId`. A style the board lacks is a notice (`unknown-text-style`,
// `unknown-effect-style`): the values stored beside the id still draw, and deleting a style
// detaches its users, so only a concurrent delete leaves one behind.

/** One place an object names a board style. */
export interface StyleUse {
  /** The style's id. */
  readonly styleId: string;
  /** The path of the id within the object (`['runs', 1, 'style', 'textStyleId']`, `['effectStyleId']`). */
  readonly path: readonly (string | number)[];
}

/**
 * Collects the text style ids of a list of runs.
 *
 * @param runs - The runs, or undefined.
 * @param path - The runs' path.
 * @param found - Where to add them.
 */
function runStyleUses(
  runs: readonly StyleRun[] | undefined,
  path: readonly (string | number)[],
  found: StyleUse[],
): void {
  if (!Array.isArray(runs)) return;
  for (const [index, run] of (runs as readonly StyleRun[]).entries()) {
    const styleId = run.style.textStyleId;
    if (styleId !== undefined) {
      found.push({ styleId, path: [...path, index, 'style', 'textStyleId'] });
    }
  }
}

/**
 * Every place an object names a board text style, in field order. Pure.
 *
 * @param object - The object.
 * @returns The uses; empty when it names none.
 */
export function textStyleUsesOf(object: BoardObject): StyleUse[] {
  const found: StyleUse[] = [];
  if ('runs' in object) runStyleUses(object.runs, ['runs'], found);
  if ('label' in object && object.label !== null) {
    runStyleUses(object.label.runs, ['label', 'runs'], found);
  }
  if (object.type === 'instance') {
    for (const [key, record] of Object.entries(object.overrides)) {
      const runs = (record as { readonly runs?: readonly StyleRun[] } | null)?.runs;
      runStyleUses(runs, ['overrides', key, 'runs'], found);
    }
  }
  return found;
}

/**
 * The board effect style a shape or frame names, if any. Pure.
 *
 * @param object - The object.
 * @returns The use, or `undefined`.
 */
export function effectStyleUseOf(object: BoardObject): StyleUse | undefined {
  if (object.type !== 'shape' && object.type !== 'frame') return undefined;
  const styleId = object.effectStyleId;
  return styleId === undefined ? undefined : { styleId, path: ['effectStyleId'] };
}

/**
 * The `unknown-text-style` and `unknown-effect-style` notices of one object: each style id the
 * board's tables lack. Pure.
 *
 * @param board - The board's style tables.
 * @param object - The object.
 * @returns The notices, in field order.
 */
export function unknownStyleIssues(
  board: Pick<Board, 'textStyles' | 'effectStyles'>,
  object: BoardObject,
): BoardIssue[] {
  const issues: BoardIssue[] = [];
  for (const { styleId, path } of textStyleUsesOf(object)) {
    if (board.textStyles?.has(styleId) === true) continue;
    issues.push({
      code: 'unknown-text-style',
      objectId: object.id,
      relatedId: styleId,
      path,
      message: `"${object.id}" names the text style "${styleId}", which this board does not have; its stored values still draw`,
      severity: 'notice',
    });
  }
  const effect = effectStyleUseOf(object);
  if (effect !== undefined && board.effectStyles?.has(effect.styleId) !== true) {
    issues.push({
      code: 'unknown-effect-style',
      objectId: object.id,
      relatedId: effect.styleId,
      path: effect.path,
      message: `"${object.id}" names the effect style "${effect.styleId}", which this board does not have; its stored shadow still draws`,
      severity: 'notice',
    });
  }
  return issues;
}
