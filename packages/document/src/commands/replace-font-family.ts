import { z } from 'zod';

import {
  isSameTextStyle,
  objectIdSchema,
  textStyleSchema,
  type BoardObject,
  type ObjectId,
  type StyleId,
  type StyleRun,
  type TextStyleEntry,
} from '@canvas/schema';

import type { DocumentTransaction, ObjectPatch } from '../store/document-store.js';

import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command, type CommandContext } from './command.js';
import { inFamily } from './font-family-move.js';
import { hasMeasuredBody, measuredSizeSchema } from './measured-size.js';
import { runsOf, stylesOf, type BoundRange } from './styles/style-support.js';

// `replaceFontFamily`: a board's missing font replaced everywhere it is named, in one
// transaction and one undo step: every text run of texts, stickies and shape and connector labels,
// instance override records (a text style override's family and override runs), a main's variant
// presets and the board's text styles. Only the family changes; weight, slant and every other
// field stay, and a run keeps its text style (the style is rewritten with it). A locked object is
// left as it is and reported, as restyling skips it; so is a text style an agent did not create,
// or one a left object names (rewritten, peers' binding repair would change that object), and
// the runs naming such a style are rewritten without it (they would no longer match its value).
// The new family may change texts' sizes: the caller measures them (`measured`), as
// `setTextStyle` takes them.

/** One measured box the replacement writes (the caller measured the text in the new family). */
const measuredBoxSchema = z.strictObject({
  /** The text or sticky. */
  id: objectIdSchema,
  /** Its measured width, world px. */
  width: measuredSizeSchema.shape.width,
  /** Its measured height, world px. */
  height: measuredSizeSchema.shape.height,
});

/** Validates the input of {@link replaceFontFamilyCommand}. */
export const replaceFontFamilyInputSchema = z
  .strictObject({
    /** The family to replace, as the board stores it. */
    from: textStyleSchema.shape.fontFamily.describe('The family to replace, as stored.'),
    /** The family to write instead. */
    to: textStyleSchema.shape.fontFamily.describe('The family to write instead.'),
    /** Boxes measured in the new family, written in the same step. */
    measured: z
      .array(measuredBoxSchema)
      .optional()
      .describe("Texts' and stickies' boxes measured in the new family, written in the same step."),
  })
  .describe('Replaces a font family everywhere the board names it.');

/** The input of {@link replaceFontFamilyCommand}. */
export type ReplaceFontFamilyInput = z.output<typeof replaceFontFamilyInputSchema>;

/** Why an object or a text style naming the family was left as it was. */
export interface SkippedFontUse {
  /** The object or text style id. */
  readonly id: string;
  /**
   * `locked` for a locked object; for an agent, `not-own-main` for an object that is or sits in
   * a main it did not create, and `not-own-style` for a text style it did not create;
   * `bound-by-left-object` for a text style an object left as it was names (rewriting it would
   * have peers' binding repair change that object).
   */
  readonly reason: 'locked' | 'not-own-main' | 'not-own-style' | 'bound-by-left-object';
}

/** Everything {@link replaceFontFamilyCommand} writes. */
export interface ReplaceFontFamilyPlan {
  /**
   * The run ranges to set to the new family; `isDetached` for a run naming a text style the
   * replacement leaves (an agent's not-own style), whose value the run would no longer match.
   */
  readonly ranges: readonly (BoundRange & {
    /** Whether the run's text style is detached (`textStyleId: null`). */
    readonly isDetached: boolean;
  })[];
  /** The objects whose override records or presets change, with the new records. */
  readonly records: readonly {
    /** The object. */
    readonly id: ObjectId;
    /** Its new override records or variant presets. */
    readonly patch: ObjectPatch;
  }[];
  /** The text styles to rewrite. */
  readonly styles: readonly TextStyleEntry[];
  /** The measured boxes to write. */
  readonly measured: readonly z.output<typeof measuredBoxSchema>[];
  /** What was left as it was. */
  readonly skipped: readonly SkippedFontUse[];
  /** The objects the replacement changes, sorted. */
  readonly objectIds: readonly ObjectId[];
}

/** What {@link replaceFontFamilyCommand} reports. */
export interface ReplaceFontFamilyResult {
  /** The objects it changed, sorted. */
  readonly objectIds: readonly ObjectId[];
  /** The text styles it rewrote, sorted. */
  readonly textStyleIds: readonly StyleId[];
  /** What it left as it was, objects then text styles. */
  readonly skipped: readonly SkippedFontUse[];
}

/**
 * Runs with the family replaced, neighbours left with equal styles merged, or `undefined` when
 * none names it.
 *
 * @param runs - The runs.
 * @param from - The family to replace.
 * @param to - The new family.
 * @returns The new runs, or `undefined`.
 */
function replacedRuns(runs: unknown, from: string, to: string): StyleRun[] | undefined {
  if (!Array.isArray(runs)) return undefined;
  const list = runs as StyleRun[];
  if (!list.some((run) => run.style.fontFamily === from)) return undefined;
  // A replaced run may now equal its neighbour; stored runs never repeat a style, so they merge.
  const merged: StyleRun[] = [];
  for (const run of list) {
    const style =
      run.style.fontFamily === from ? (inFamily(run.style, to) as typeof run.style) : run.style;
    const last = merged.at(-1);
    if (last !== undefined && isSameTextStyle(last.style, style)) {
      merged[merged.length - 1] = { ...last, length: last.length + run.length };
    } else {
      merged.push({ ...run, style });
    }
  }
  return merged;
}

/**
 * Override records with the family replaced in each record's text style override and runs, or
 * `undefined` when none names it.
 *
 * @param records - The records by path.
 * @param from - The family to replace.
 * @param to - The new family.
 * @returns The new records, or `undefined`.
 */
function replacedRecords(
  records: Readonly<Record<string, unknown>>,
  from: string,
  to: string,
): Record<string, unknown> | undefined {
  let isChanged = false;
  const next: Record<string, unknown> = {};
  for (const [key, record] of Object.entries(records)) {
    // The store reads only valid objects, so every record is an object.
    const fields = record as Readonly<Record<string, unknown>>;
    const style = fields.textStyle as Readonly<Record<string, unknown>> | undefined;
    const runs = replacedRuns(fields.runs, from, to);
    const isStyleNamed = style?.fontFamily === from;
    if (!isStyleNamed && runs === undefined) {
      next[key] = record;
      continue;
    }
    isChanged = true;
    next[key] = {
      ...fields,
      ...(isStyleNamed ? { textStyle: inFamily(style, to) } : {}),
      ...(runs === undefined ? {} : { runs }),
    };
  }
  return isChanged ? next : undefined;
}

/**
 * The record patch of an instance or a main naming the family, or `undefined`.
 *
 * @param object - The object.
 * @param from - The family to replace.
 * @param to - The new family.
 * @returns The patch, or `undefined`.
 */
function recordPatch(object: BoardObject, from: string, to: string): ObjectPatch | undefined {
  if (object.type === 'instance') {
    const overrides = replacedRecords(object.overrides, from, to);
    return overrides === undefined ? undefined : ({ overrides } as ObjectPatch);
  }
  if (object.type === 'component' && object.variantPresets !== undefined) {
    let isChanged = false;
    const variantPresets: Record<string, unknown> = {};
    for (const [key, records] of Object.entries(object.variantPresets)) {
      const next = replacedRecords(records, from, to);
      if (next !== undefined) isChanged = true;
      variantPresets[key] = next ?? records;
    }
    return isChanged ? ({ variantPresets } as ObjectPatch) : undefined;
  }
  return undefined;
}

/**
 * Whether an agent may not write an object: it is, or sits in, a main another principal created
 * (the command layer refuses such a write as `not-own-main`).
 *
 * @param context - The command's context.
 * @param object - The object.
 * @returns True when the object is under a foreign main for an agent.
 */
function isUnderForeignMain(context: CommandContext, object: BoardObject): boolean {
  if (context.origin.kind !== 'agent') return false;
  const seen = new Set<ObjectId>();
  let current: BoardObject | undefined = object;
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === 'component' && current.createdBy !== context.origin.principalId) {
      return true;
    }
    current = current.parentId === null ? undefined : context.board.get(current.parentId);
  }
  return false;
}

/**
 * The text styles naming the family: rewritten, or left (one a left object names, or for an agent
 * one it did not create).
 *
 * @param context - The command's context.
 * @param from - The family to replace.
 * @param to - The new family.
 * @param held - The styles the runs of left objects name.
 * @returns The styles to rewrite and those left.
 */
function planStyles(
  context: CommandContext,
  from: string,
  to: string,
  held: ReadonlySet<string>,
): { styles: TextStyleEntry[]; skippedStyles: SkippedFontUse[] } {
  const skippedStyles: SkippedFontUse[] = [];
  const styles: TextStyleEntry[] = [];
  const isAgent = context.origin.kind === 'agent';
  for (const entry of [...stylesOf(context.board, 'text').values()].sort((first, second) =>
    first.id < second.id ? -1 : 1,
  )) {
    if (entry.value.fontFamily !== from) continue;
    if (held.has(entry.id)) {
      skippedStyles.push({ id: entry.id, reason: 'bound-by-left-object' });
    } else if (isAgent && entry.createdBy !== context.origin.principalId) {
      skippedStyles.push({ id: entry.id, reason: 'not-own-style' });
    } else {
      styles.push({ ...entry, value: inFamily(entry.value, to) });
    }
  }
  return { styles, skippedStyles };
}

/**
 * Plans the replacement over the board's objects and text styles.
 *
 * @param context - The command's context.
 * @param input - The input.
 * @returns The plan, or the refusals.
 */
function planReplacement(
  context: CommandContext,
  input: ReplaceFontFamilyInput,
): ReplaceFontFamilyPlan | CommandError[] {
  const { from, to } = input;
  const errors: CommandError[] = [];
  if (from === to) {
    errors.push(commandError('invalid-input', null, ['to'], 'the new family is the family itself'));
  }
  const measured = input.measured ?? [];
  for (const [index, { id }] of measured.entries()) {
    const object = context.board.get(id);
    if (object === undefined) {
      errors.push(
        commandError('missing-object', id, ['measured', index, 'id'], `no object "${id}"`),
      );
    } else if (!hasMeasuredBody(object.type)) {
      const message = `a ${object.type} has no measured size of its own`;
      errors.push(commandError('unsupported-type', id, ['measured', index, 'id'], message));
    }
  }
  if (errors.length > 0) return errors;
  const objects = [...(context.board.read?.().objects.values() ?? [])].sort((first, second) =>
    first.id < second.id ? -1 : 1,
  );
  // First, the objects naming the family, and those left as they are.
  const skipped: SkippedFontUse[] = [];
  const naming: BoardObject[] = [];
  const held = new Set<string>();
  for (const object of objects) {
    const runs = runsOf(object);
    const isNaming =
      runs.some((run) => run.style.fontFamily === from) ||
      recordPatch(object, from, to) !== undefined;
    if (!isNaming) continue;
    const reason = object.locked
      ? 'locked'
      : isUnderForeignMain(context, object)
        ? 'not-own-main'
        : undefined;
    if (reason === undefined) {
      naming.push(object);
      continue;
    }
    skipped.push({ id: object.id, reason });
    // A text style a left object's runs name stays as it is: rewritten, a peer's binding repair
    // would format that object's runs to the new value (`repairStyleBindings`).
    for (const run of runs)
      if (run.style.textStyleId !== undefined) held.add(run.style.textStyleId);
  }
  const { styles, skippedStyles } = planStyles(context, from, to, held);
  // Then what the replacement writes: a run naming a style it leaves is rewritten without it.
  const left = new Set<string>(skippedStyles.map(({ id }) => id));
  const ranges: (BoundRange & { isDetached: boolean })[] = [];
  const records: ReplaceFontFamilyPlan['records'][number][] = [];
  for (const object of naming) {
    let index = 0;
    for (const run of runsOf(object)) {
      if (run.style.fontFamily === from) {
        const isDetached = run.style.textStyleId !== undefined && left.has(run.style.textStyleId);
        ranges.push({ id: object.id, index, length: run.length, isDetached });
      }
      index += run.length;
    }
    const patch = recordPatch(object, from, to);
    if (patch !== undefined) records.push({ id: object.id, patch });
  }
  // An object left as it was keeps its size too.
  const leftIds = new Set<string>(skipped.map(({ id }) => id));
  const kept = measured.filter(({ id }) => !leftIds.has(id));
  skipped.push(...skippedStyles);
  const objectIds = naming.map(({ id }) => id);
  return { ranges, records, styles, measured: kept, skipped, objectIds };
}

/**
 * Writes a planned replacement.
 *
 * @param transaction - The transaction.
 * @param plan - The plan.
 * @param to - The new family.
 * @returns The result.
 */
function applyReplacement(
  transaction: DocumentTransaction,
  plan: ReplaceFontFamilyPlan,
  to: string,
): ReplaceFontFamilyResult {
  for (const style of plan.styles) {
    transaction.setNamedStyle(
      'text',
      { id: style.id, name: style.name, value: style.value },
      // The entry exists, so its identity is kept; a creation is recorded only for a new one.
      { createdBy: transaction.origin.principalId, createdAt: style.createdAt },
    );
  }
  for (const { id, index, length, isDetached } of plan.ranges) {
    transaction.formatText(id, index, length, {
      fontFamily: to,
      postScriptName: null, // the old family's face
      ...(isDetached ? { textStyleId: null } : {}),
    });
  }
  for (const { id, patch } of plan.records) transaction.patchObject(id, patch);
  for (const { id, width, height } of plan.measured) transaction.patchObject(id, { width, height });
  return {
    objectIds: plan.objectIds,
    textStyleIds: plan.styles.map(({ id }) => id),
    skipped: plan.skipped,
  };
}

/**
 * `replaceFontFamily`: replaces a font family everywhere a board names it (runs of
 * texts, stickies and labels, instance override records, variant presets, text styles), only the
 * family changing, with the caller's `measured` boxes, in one transaction and one undo step.
 * Locked objects, and for an agent objects in mains and text styles it did not create, are left
 * and reported under `skipped`. Refused: the same family as both (`invalid-input`), and a measured id the board
 * lacks or whose type has no measured size.
 */
export const replaceFontFamilyCommand: Command<
  typeof replaceFontFamilyInputSchema,
  ReplaceFontFamilyPlan,
  ReplaceFontFamilyResult
> = {
  name: 'replaceFontFamily',
  description:
    'Replaces a font family everywhere the board names it, in one undo step; locked objects are left.',
  input: replaceFontFamilyInputSchema,
  validate(context, input) {
    const planned = planReplacement(context, input);
    return Array.isArray(planned) ? reject(planned) : accept(planned);
  },
  apply(transaction, input, plan) {
    return applyReplacement(transaction, plan, input.to);
  },
};
