import type { z } from 'zod';

import type { Board } from '../../board/board.js';
import type { Rgba } from '../../fields/color.js';
import type { AssetId } from '../../ids/asset-id.js';
import type { ObjectId } from '../../ids/object-id.js';
import * as schema from '../../index.js';
import type { BaseObject } from '../../objects/base-object.js';
import type { BoardObject } from '../../objects/board-object.js';
import type { Crop } from '../../objects/image-object.js';

// Acceptance: the tests reach the future
// exports by name through this fixture, so they compile and lint on the base and fail red with
// `missing export: <name>` until the export lands. The types below restate the
// contract's signatures; the real exports replace them when they exist.

/** How a child follows its parent's resize on one axis (the owner's pin/stretch constraints). */
export type ConstraintMode = 'start' | 'center' | 'end' | 'stretch';

/** A child's constraints, one mode per axis; absent on a stored object means `start`/`start`. */
export interface Constraints {
  /** The mode along the parent's width. */
  readonly x: ConstraintMode;
  /** The mode along the parent's height. */
  readonly y: ConstraintMode;
}

/** The shared fields of a boxed object that may carry constraints. */
interface ConstrainedBox extends Omit<BaseObject, 'type'> {
  /** Box width in world units, at least 0. */
  readonly width: number;
  /** Box height in world units, at least 0. */
  readonly height: number;
  /** How the object follows its parent's resize; absent for the default `start`/`start`. */
  readonly constraints?: Constraints;
}

/**
 * A component: a named, sized container whose real children stay ordinary board objects.
 * `retired` records a deletion that keeps the definition for late instances (the field is
 * typed through `Record` because the naming rule reserves plain boolean properties for
 * predicate names, and the contract names it `retired`).
 */
export interface ComponentObject extends ConstrainedBox, Record<'retired', boolean> {
  /** Always `'component'`. */
  readonly type: 'component';
  /** The component name, up to 200 characters. */
  readonly name: string;
}

/**
 * One replacement record for a descendant of an instance's main; at least one field is set. The
 * ticket allows only content, colours, the image, visibility and the instance's own size: text
 * styles, stroke widths and structure stay the main's, so a later main edit of them reaches every
 * instance.
 */
export interface OverrideRecord {
  /** Replacement characters of a text object, a sticky, or a shape's or connector's label. */
  readonly text?: string;
  /** Replacement fill colour of a shape or path. */
  readonly fill?: Rgba;
  /** Replacement stroke colour of a shape, path, line or connector; the width stays the main's. */
  readonly strokeColor?: Rgba;
  /** Replacement background colour of a sticky. */
  readonly color?: Rgba;
  /** Replacement asset of an image. */
  readonly assetId?: AssetId;
  /** Replacement natural size of an image. */
  readonly naturalSize?: {
    /** Source image width in pixels. */
    readonly width: number;
    /** Source image height in pixels. */
    readonly height: number;
  };
  /** Replacement crop of an image. */
  readonly crop?: Crop;
  /** Whether the descendant and its subtree are left out of the instance. */
  readonly isHidden?: boolean;
}

/** An instance's overrides: one record per descendant path (`child` or `nested/child`). */
export type InstanceOverrides = Readonly<Record<string, OverrideRecord>>;

/** An instance: a leaf with an immutable main id, its own size and its overrides. */
export interface InstanceObject extends ConstrainedBox {
  /** Always `'instance'`. */
  readonly type: 'instance';
  /** The component this instance renders. */
  readonly mainId: ObjectId;
  /** The overrides, keyed by descendant path. */
  readonly overrides: InstanceOverrides;
}

/** Why a resolver could not expand an instance fully. */
export type ResolveIssue = 'missing-main' | 'invalid-main' | 'instance-cycle' | 'instance-depth';

/** What `resolveInstance` answers: the virtual objects, the issue if any, and the main's state. */
export interface ResolvedInstance {
  /** The virtual objects, ids `<instanceId>/<path>`, in no particular order. */
  readonly objects: readonly BoardObject[];
  /** Why the expansion is incomplete, when it is. */
  readonly issue?: ResolveIssue;
  /** Whether the main was retired (deleted but retained). */
  readonly isMainRetired: boolean;
}

/** A box's size in world units. */
export interface BoxSize {
  /** Width, at least 0. */
  readonly width: number;
  /** Height, at least 0. */
  readonly height: number;
}

/** `constrainChildren(board, parent, to)`: every descendant of `parent` after its resize. */
export type ConstrainChildren = (
  board: Board,
  parent: BoardObject,
  to: BoxSize,
) => readonly BoardObject[];

/** `resolveInstance(board, instance)`: the instance expanded into virtual objects. */
export type ResolveInstance = (board: Board, instance: InstanceObject) => ResolvedInstance;

/** `effectiveConstraints(object)`: the stored constraints, or the default. */
export type EffectiveConstraints = (object: BoardObject) => Constraints;

/** `virtualObjectId(instanceId, path)`: the id of a virtual object. */
export type VirtualObjectId = (instanceId: ObjectId, path: string) => string;

/** The `@canvas/schema` exports adds, by name. */
export type ExpectedExportName =
  | 'CONSTRAINT_MODES'
  | 'constraintsSchema'
  | 'DEFAULT_CONSTRAINTS'
  | 'effectiveConstraints'
  | 'componentObjectSchema'
  | 'instanceObjectSchema'
  | 'overridePathSchema'
  | 'overrideRecordSchema'
  | 'instanceOverridesSchema'
  | 'MAX_INSTANCES'
  | 'MAX_INSTANCE_DEPTH'
  | 'constrainChildren'
  | 'resolveInstance'
  | 'virtualObjectId';

/** The type of each expected export, as the contract declares it. */
export type ExpectedExport<Name extends ExpectedExportName> = Name extends 'CONSTRAINT_MODES'
  ? readonly ConstraintMode[]
  : Name extends 'constraintsSchema'
    ? z.ZodType<Constraints>
    : Name extends 'DEFAULT_CONSTRAINTS'
      ? Constraints
      : Name extends 'effectiveConstraints'
        ? EffectiveConstraints
        : Name extends 'componentObjectSchema'
          ? z.ZodType<ComponentObject>
          : Name extends 'instanceObjectSchema'
            ? z.ZodType<InstanceObject>
            : Name extends 'overridePathSchema'
              ? z.ZodType<string>
              : Name extends 'overrideRecordSchema'
                ? z.ZodType<OverrideRecord>
                : Name extends 'instanceOverridesSchema'
                  ? z.ZodType<InstanceOverrides>
                  : Name extends 'MAX_INSTANCES' | 'MAX_INSTANCE_DEPTH'
                    ? number
                    : Name extends 'constrainChildren'
                      ? ConstrainChildren
                      : Name extends 'resolveInstance'
                        ? ResolveInstance
                        : VirtualObjectId;

/** The `typeof` each expected export has: a schema is an object, a limit a number. */
const EXPECTED_KINDS: Readonly<Record<ExpectedExportName, 'function' | 'number' | 'object'>> = {
  CONSTRAINT_MODES: 'object',
  constraintsSchema: 'object',
  DEFAULT_CONSTRAINTS: 'object',
  effectiveConstraints: 'function',
  componentObjectSchema: 'object',
  instanceObjectSchema: 'object',
  overridePathSchema: 'object',
  overrideRecordSchema: 'object',
  instanceOverridesSchema: 'object',
  MAX_INSTANCES: 'number',
  MAX_INSTANCE_DEPTH: 'number',
  constrainChildren: 'function',
  resolveInstance: 'function',
  virtualObjectId: 'function',
};

/**
 * Reads one of the exports adds to `@canvas/schema` from the package namespace, typed as
 * the contract declares it.
 *
 * @param name - The export's name.
 * @returns The export.
 * @throws {Error} `missing export: <name>` when the package does not export it yet, or
 *   exports something of another kind under that name.
 */
export function expectedExport<Name extends ExpectedExportName>(name: Name): ExpectedExport<Name> {
  const value = (schema as Readonly<Record<string, unknown>>)[name];
  if (value === undefined || typeof value !== EXPECTED_KINDS[name]) {
    throw new Error(`missing export: ${name}`);
  }
  return value as ExpectedExport<Name>;
}
