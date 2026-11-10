import type { Board } from '../board/board.js';
import { isBuiltinToken } from '../fields/color-tokens.js';
import type { StyleRun } from '../fields/text-style.js';
import { isTokenRef, type TokenId } from '../fields/token-ref.js';
import type { BoardObject } from '../objects/board-object.js';
import type { BoardIssue } from '../rules/board-issue.js';

// Where an object names colour tokens: its stroke, an image's border,
// fill or background, a sticky's colour, every text run's colour (text, sticky, shape
// and connector labels) and an instance's override records. An object naming a token its board does not have draws it as ink
// and is reported (`unknown-color-token`, a notice: deleting a token never rewrites objects).

/** One place an object names a colour token. */
export interface ColorTokenUse {
  /** The token's id. */
  readonly token: TokenId;
  /** The path of the colour within the object (`['stroke', 'color']`, `['runs', 2, 'style', 'color']`). */
  readonly path: readonly (string | number)[];
}

/**
 * Collects the token references of a list of runs.
 *
 * @param runs - The runs, or undefined.
 * @param path - The runs' path.
 * @param found - Where to add them.
 */
function runUses(
  runs: readonly StyleRun[] | undefined,
  path: readonly (string | number)[],
  found: ColorTokenUse[],
): void {
  if (!Array.isArray(runs)) return;
  for (const [index, run] of (runs as readonly StyleRun[]).entries()) {
    const color: unknown = run.style.color;
    if (isTokenRef(color))
      found.push({ token: color.token, path: [...path, index, 'style', 'color'] });
  }
}

/**
 * Adds a use when a value is a token reference.
 *
 * @param value - The colour.
 * @param path - Its path.
 * @param found - Where to add it.
 */
function valueUse(
  value: unknown,
  path: readonly (string | number)[],
  found: ColorTokenUse[],
): void {
  if (isTokenRef(value)) found.push({ token: value.token, path });
}

/**
 * Collects the token references of an instance's override records.
 *
 * @param overrides - The records by path.
 * @param found - Where to add them.
 */
function overrideUses(overrides: Readonly<Record<string, unknown>>, found: ColorTokenUse[]): void {
  for (const [key, record] of Object.entries(overrides)) {
    if (typeof record !== 'object' || record === null) continue;
    const fields = record as Readonly<Record<string, unknown>>;
    for (const name of ['fill', 'strokeColor', 'color'] as const) {
      valueUse(fields[name], ['overrides', key, name], found);
    }
    const style = fields.textStyle as { readonly color?: unknown } | undefined;
    valueUse(style?.color, ['overrides', key, 'textStyle', 'color'], found);
    runUses(fields.runs as readonly StyleRun[] | undefined, ['overrides', key, 'runs'], found);
  }
}

/**
 * Every place an object names a colour token, in field order. Pure.
 *
 * @param object - The object.
 * @returns The uses; empty when it names none.
 */
export function colorTokenUsesOf(object: BoardObject): ColorTokenUse[] {
  const found: ColorTokenUse[] = [];
  if ('stroke' in object && object.stroke !== null && object.stroke !== undefined) {
    valueUse(object.stroke.color, ['stroke', 'color'], found);
  }
  if (object.type === 'image' && object.border !== null && object.border !== undefined) {
    valueUse(object.border.color, ['border', 'color'], found);
  }
  if ('fill' in object) valueUse(object.fill, ['fill'], found);
  if (object.type === 'frame') valueUse(object.background, ['background'], found);
  if (object.type === 'sticky') valueUse(object.color, ['color'], found);
  if ('runs' in object) runUses(object.runs, ['runs'], found);
  if ('label' in object && object.label !== null)
    runUses(object.label.runs, ['label', 'runs'], found);
  if (object.type === 'instance') overrideUses(object.overrides, found);
  return found;
}

/**
 * Tells whether a board has a token: a built-in, or an entry of its table.
 *
 * @param board - The board.
 * @param id - The token id.
 * @returns True when the board resolves it.
 */
export function hasColorToken(board: Pick<Board, 'tokens'>, id: string): boolean {
  return isBuiltinToken(id) || board.tokens?.has(id) === true;
}

/**
 * The `unknown-color-token` notices of one object: each colour naming a token the board does not
 * have (it draws as ink). `relatedId` is the token's id.
 *
 * @param board - The board.
 * @param object - The object.
 * @returns The notices, in field order.
 */
export function unknownColorTokenIssues(
  board: Pick<Board, 'tokens'>,
  object: BoardObject,
): BoardIssue[] {
  return colorTokenUsesOf(object)
    .filter(({ token }) => !hasColorToken(board, token))
    .map(({ token, path }) => ({
      code: 'unknown-color-token',
      objectId: object.id,
      relatedId: token,
      path,
      message: `"${object.id}" names the colour token "${token}", which this board does not have; it draws as ink`,
      severity: 'notice',
    }));
}
