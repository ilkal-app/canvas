import {
  instanceOverrideFields,
  type BoardObject,
  type ComponentObject,
  type InstanceObject,
  type ObjectId,
  type OverrideRecord,
} from '@canvas/schema';

import { lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import type { BoardReader } from './command.js';
import { instanceOverrideError, overridePathTarget } from './instance-override-target.js';
import { resolveOverridePath, type OverridePathResolution } from './override-path-names.js';

// Checks the variant commands share: the main they edit, an axis value it lists,
// and a preset record checked against the main's own content as an instance's would be.

/**
 * An id no stored object can have (it fails the object-id pattern), for the stand-in instance a
 * preset is checked through.
 */
const PRESET_TARGET_ID = '~preset' as ObjectId;

/**
 * Looks up the main a variant command edits.
 *
 * @param board - The board before the command.
 * @param componentId - The main's id.
 * @param path - Where an error points in the input.
 * @returns The main, or the refusal: `missing-object`, or `unsupported-type` for another type.
 */
export function lookUpMain(
  board: BoardReader,
  componentId: ObjectId,
  path: readonly (string | number)[],
): { readonly main: ComponentObject } | { readonly errors: CommandError[] } {
  const { named, errors } = lookUpNamed(
    board,
    [componentId],
    (id) => id,
    () => path,
  );
  const object = named[0]?.object;
  if (object === undefined) return { errors };
  if (object.type !== 'component') {
    return { errors: [commandError('unsupported-type', object.id, path, 'A main is required.')] };
  }
  return { main: object };
}

/**
 * Refuses an axis value the main does not list.
 *
 * @param main - The main.
 * @param axis - The axis name.
 * @param value - The value name.
 * @param path - Where the error points in the input.
 * @returns `unknown-variant`, or `undefined` when the main lists the value.
 */
export function unknownVariantError(
  main: ComponentObject,
  axis: string,
  value: string,
  path: readonly (string | number)[],
): CommandError | undefined {
  const isKnown = main.variantAxes?.find(({ name }) => name === axis)?.values.includes(value);
  return isKnown === true
    ? undefined
    : commandError(
        'unknown-variant',
        main.id,
        path,
        `${axis}=${value} is not a value of this main.`,
      );
}

/** The axis value whose preset a variant command edits. */
export interface PresetValue {
  /** The axis. */
  readonly axis: string;
  /** The value. */
  readonly value: string;
}

/**
 * A stand-in instance of the main, through which a preset path is checked as an instance's path.
 * It selects the edited value, so the walk follows a swap the preset itself makes.
 *
 * @param main - The main, with the preset as the command leaves it.
 * @param selected - The value whose preset is edited.
 * @returns An unstored instance of it with no overrides of its own.
 */
function standInOf(main: ComponentObject, selected: PresetValue): InstanceObject {
  return {
    id: PRESET_TARGET_ID,
    type: 'instance',
    parentId: null,
    pageId: null,
    x: 0,
    y: 0,
    width: main.width,
    height: main.height,
    rotation: 0,
    z: 'a0',
    locked: false,
    createdBy: main.createdBy,
    createdAt: 0,
    updatedAt: 0,
    mainId: main.id,
    overrides: {},
    variant: { [selected.axis]: selected.value },
  };
}

/**
 * Resolves a preset path: an id path as stored, or the layers' names below the main,
 * read through an instance selecting the edited value; the main's own name or id addresses the
 * root record.
 *
 * @param board - The board before the command.
 * @param main - The main whose preset it is, as the command leaves it.
 * @param selected - The value whose preset it is.
 * @param path - The path as given.
 * @param overlay - Other objects as the command writes them (a new main's children).
 * @returns The id path, or why it cannot be read.
 */
export function resolvePresetPath(
  board: BoardReader,
  main: ComponentObject,
  selected: PresetValue,
  path: string,
  overlay: readonly BoardObject[] = [],
): OverridePathResolution {
  return resolveOverridePath(board, standInOf(main, selected), path, [main, ...overlay], {
    id: main.id,
    name: main.name,
  });
}

/** The fields a preset's root record (at the main's own id) takes: the variant's size and layout. */
const ROOT_RECORD_FIELDS: readonly string[] = ['width', 'height', 'autoLayout'];

/**
 * Checks the fields of a preset's root record, the record at the main's own id: only the
 * variant's `width`, `height` and, for a main with auto-layout, an `autoLayout` patch.
 *
 * @param main - The main, as the command leaves it.
 * @param fields - The record's fields, or the fields a reset clears.
 * @param where - Where an error points in the input.
 * @returns `invalid-override`, or `undefined` when the fields fit.
 */
function rootRecordError(
  main: ComponentObject,
  fields: readonly string[],
  where: readonly (string | number)[],
): CommandError | undefined {
  if (fields.some((field) => !ROOT_RECORD_FIELDS.includes(field))) {
    return commandError(
      'invalid-override',
      main.id,
      where,
      "A variant's own record takes only width, height and autoLayout.",
    );
  }
  return fields.includes('autoLayout') && main.autoLayout === undefined
    ? commandError('invalid-override', main.id, where, 'The main has no auto-layout to patch.')
    : undefined;
}

/**
 * Checks a preset record as an instance's record at the same path would be checked: the path
 * must address a child of the main, each field must be one that child takes, and a swapped-in
 * `mainId` must be one the slot may show. The check reads the main as the command
 * leaves it, through an instance selecting the edited value. A record at the main's own id is the
 * variant's own size and layout, checked by its own rule.
 *
 * @param board - The board before the command.
 * @param main - The main whose preset it is, with the edited preset.
 * @param selected - The value whose preset it is.
 * @param path - The record's path, relative to the main.
 * @param record - The record given.
 * @param overlay - Other objects as the command writes them that the main's content reads (a new
 *   main's children, placed in it); none by default.
 * @returns `invalid-override-path`, `invalid-override`, `instance-cycle` or `instance-depth`, or
 *   `undefined` when it may be stored.
 */
export function presetRecordError(
  board: BoardReader,
  main: ComponentObject,
  selected: PresetValue,
  path: string,
  record: OverrideRecord,
  overlay: readonly BoardObject[] = [],
): CommandError | undefined {
  if (path === main.id) return rootRecordError(main, Object.keys(record), ['override']);
  const where = { path: ['path'], override: ['override'] };
  const error = instanceOverrideError(board, standInOf(main, selected), path, record, where, [
    main,
    ...overlay,
  ]);
  return error === undefined ? undefined : { ...error, objectId: main.id };
}

/**
 * Checks a preset reset's path and fields: the path must address a child of the main, and each
 * field must be one that child takes.
 *
 * @param board - The board before the command.
 * @param main - The main whose preset it is.
 * @param selected - The value whose preset it is; the path follows its swaps.
 * @param path - The path, relative to the main.
 * @param fields - The fields to clear, if given.
 * @returns `invalid-override-path` or `invalid-override`, or `undefined` when the reset may run.
 */
export function presetResetError(
  board: BoardReader,
  main: ComponentObject,
  selected: PresetValue,
  path: string,
  fields: readonly string[] | undefined,
): CommandError | undefined {
  if (path === main.id) return rootRecordError(main, fields ?? [], ['fields']);
  const target = overridePathTarget(board, standInOf(main, selected), path)?.target;
  if (target === undefined) {
    return commandError(
      'invalid-override-path',
      main.id,
      ['path'],
      'The path does not address a child of this main.',
    );
  }
  const allowed: readonly string[] = instanceOverrideFields(target);
  return fields?.some((field) => !allowed.includes(field)) === true
    ? commandError(
        'invalid-override',
        main.id,
        ['fields'],
        "The child's type does not take a field.",
      )
    : undefined;
}
