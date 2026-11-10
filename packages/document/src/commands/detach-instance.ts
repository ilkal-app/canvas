import { z } from 'zod';

import {
  compareSiblings,
  objectIdSchema,
  resolveInstance,
  type BoardObject,
  type FrameObject,
  type InstanceObject,
  type ObjectId,
  type AutoLayout,
} from '@canvas/schema';

import { generateObjectKeys } from '../z-order/object-keys.js';

import { checkObject, lookUpNamed } from './command-checks.js';
import { commandError, type CommandError } from './command-error.js';
import { accept, reject, type Command, type CommandContext } from './command.js';
import { splitInstanceDetach } from './component-command-parts.js';
import { bakedCopy, scaledLayout, type DetachClamp } from './detach-bake.js';
import { SubBoard } from './sub-board.js';

/**
 * The fields only an instance has, which a frame made from one does not keep (its
 * variant selection; a slot's swap options; its content scale, which
 * the frame's content and layout take on instead: `bakedCopy`, `scaledLayout`).
 */
const INSTANCE_ONLY_FIELDS: ReadonlySet<string> = new Set([
  'mainId',
  'overrides',
  'isWidthFixed',
  'isHeightFixed',
  'variant',
  'swapOptions',
  'scale',
]);

/**
 * The auto-layout a frame made from an instance takes: its main's, with each axis the
 * instance had fixed (`isWidthFixed`, `isHeightFixed`) fixed in the frame, so the frame keeps
 * the instance's size and its children the same stack. A scaled instance's gap and padding are
 * stored as it drew them, times its scale.
 *
 * @param main - The instance's main, if any.
 * @param instance - The instance.
 * @returns `{ autoLayout }` to spread into the frame, or nothing.
 */
function detachedAutoLayout(
  main: BoardObject | undefined,
  instance: Pick<InstanceObject, 'isWidthFixed' | 'isHeightFixed' | 'scale'>,
): { autoLayout?: AutoLayout } {
  const layout = main?.type === 'component' ? main.autoLayout : undefined;
  if (layout === undefined) return {};
  return {
    autoLayout: {
      ...scaledLayout(layout, instance.scale ?? 1),
      ...(instance.isWidthFixed === true ? { width: 'fixed' as const } : {}),
      ...(instance.isHeightFixed === true ? { height: 'fixed' as const } : {}),
    },
  };
}

/** The fields only a main has, which a frame made from one does not keep. */
const MAIN_ONLY_FIELDS: ReadonlySet<string> = new Set(['retired', 'variantAxes', 'variantPresets']);
/** The stored instance to materialize. */
export const detachInstanceInputSchema = z.strictObject({
  /** The identity retained as a frame. */
  id: objectIdSchema.describe('The instance identity retained as an ordinary frame.'),
});

/** The same-id frame and new ordinary children of a detached instance. */
export interface DetachInstancePlan {
  /** Replaces the instance without changing attachments. */
  readonly frame: FrameObject;
  /** Materialized content; a nested instance stays a reference unless its main retires too. */
  readonly children: readonly BoardObject[];
  /** Each materialized child's source path (as an override path is written) to its new id. */
  readonly idMap: Readonly<Record<string, ObjectId>>;
  /** The values a scaled instance drew past their stored ranges, clamped. */
  readonly clamped: readonly DetachClamp[];
}

/** Identities affected by a detach. */
export interface DetachInstanceResult {
  /** Former instance identity, now a frame. */
  readonly frameId: ObjectId;
  /** Newly created children. */
  readonly createdIds: readonly ObjectId[];
  /**
   * Each new child's source path (the main child's id, or nested instance ids and the child's,
   * slash-separated, as override paths are written) to its new id.
   */
  readonly idMap: Readonly<Record<string, ObjectId>>;
  /**
   * Each value a scaled instance drew past what may be stored, clamped into its range:
   * the new child, the field's dotted path, the drawn value and the stored one. Empty for an
   * unscaled instance.
   */
  readonly clamped: readonly DetachClamp[];
}

/**
 * Replaces virtual identities and internal attachments with fresh stored identities.
 *
 * @param object - One resolved child.
 * @param ids - Virtual to stored identity mapping.
 * @param context - Creator and fixed time.
 * @param flattened - Mains whose nested instances become plain frames.
 * @returns A storable child with remapped internal references.
 */
function materialize(
  object: BoardObject,
  ids: ReadonlyMap<string, ObjectId>,
  context: CommandContext,
  flattened: ReadonlySet<ObjectId>,
): BoardObject {
  const remap = (id: ObjectId): ObjectId => ids.get(id) ?? id;
  const next = {
    ...object,
    id: remap(object.id),
    parentId: object.parentId === null ? null : remap(object.parentId),
    pageId: null,
    createdBy: context.origin.principalId,
    createdAt: context.now,
    updatedAt: context.now,
  };
  if (next.type === 'component') {
    // A frame has no retirement and no variants: the main's are dropped.
    const fields = Object.fromEntries(
      Object.entries(next).filter(([key]) => !MAIN_ONLY_FIELDS.has(key)),
    ) as Omit<typeof next, 'retired' | 'variantAxes' | 'variantPresets'>;
    return { ...fields, type: 'frame', clip: false, background: null };
  }
  if (next.type === 'instance' && flattened.has(next.mainId)) {
    const main = context.board.get(next.mainId);
    const fields = Object.fromEntries(
      Object.entries(next).filter(([key]) => !INSTANCE_ONLY_FIELDS.has(key)),
    ) as Omit<
      typeof next,
      | 'mainId'
      | 'overrides'
      | 'isWidthFixed'
      | 'isHeightFixed'
      | 'variant'
      | 'swapOptions'
      | 'scale'
    >;
    return {
      ...fields,
      type: 'frame',
      name: main?.type === 'component' ? main.name : '',
      clip: false,
      background: null,
      ...detachedAutoLayout(main, next),
    };
  }
  if (next.type !== 'connector') return next;
  const end = (value: typeof next.from): typeof next.from =>
    value.kind === 'object' ? { ...value, objectId: remap(value.objectId) } : value;
  return { ...next, from: end(next.from), to: end(next.to) };
}

/**
 * The stored object a detach copies a resolved child from: the last step of its path, the child's
 * id in the main (or nested main) that holds it (`resolveInstance` ids content as
 * `<instance>/<path>`).
 *
 * @param resolvedId - The resolved child's id.
 * @returns The source object's id.
 */
function sourceIdOf(resolvedId: string): ObjectId {
  return (resolvedId.split('/').at(-1) ?? resolvedId) as ObjectId;
}

/**
 * Gives a detach's copies stacking keys of their own, each parent's in the order its sources
 * stacked in: no command copies another object's key, since two people detaching one
 * instance at once would otherwise merge two sets of copies pairwise on one key, and nothing could
 * be placed between two tied siblings (`unorderable-neighbours`).
 *
 * @param baked - The copies, in the order of their sources.
 * @param sources - The resolved objects they copy, one per copy.
 * @returns The copies with new keys.
 */
function ownKeys(
  baked: readonly { readonly object: BoardObject }[],
  sources: readonly BoardObject[],
): BoardObject[] {
  const copies = baked.map(({ object }) => object);
  const pairs = copies.map((copy, index) => ({ copy, source: sources[index] ?? copy, index }));
  const byParent = new Map<ObjectId | null, (typeof pairs)[number][]>();
  for (const pair of pairs)
    byParent.set(pair.copy.parentId, [...(byParent.get(pair.copy.parentId) ?? []), pair]);
  const keyed = [...copies];
  for (const siblings of byParent.values()) {
    siblings.sort((first, second) => compareSiblings(first.source, second.source));
    const keys = generateObjectKeys(
      null,
      null,
      siblings.map(({ copy }) => copy.id),
    );
    for (const [order, { copy, index }] of siblings.entries()) {
      keyed[index] = { ...copy, z: keys[order] ?? copy.z };
    }
  }
  return keyed;
}

/**
 * Plans a detach for the command and for main retirement, without performing writes.
 *
 * @param context - Current document and identity generator.
 * @param instance - Stored instance to detach.
 * @param errors - Validation refusals to append.
 * @param flattened - Mains retired by the same command: a nested instance of one is
 *   materialised as a plain frame holding its resolved content, as if detached too, since a new
 *   instance of a retired main is refused (`retired-main`). Empty for `detachInstance`.
 * @returns The materialization, or undefined when the main cannot be resolved.
 */
export function planInstanceDetach(
  context: CommandContext,
  instance: InstanceObject,
  errors: CommandError[],
  flattened: ReadonlySet<ObjectId> = new Set(),
): DetachInstancePlan | undefined {
  const subBoard = new SubBoard(context.board);
  subBoard.addInstanceDefinitions(instance.id);
  const resolved = resolveInstance(subBoard.toBoard(), instance);
  if (resolved.issue !== undefined) {
    errors.push(
      commandError(
        resolved.issue,
        instance.id,
        ['mainId'],
        'The main cannot be resolved for detachment.',
      ),
    );
    return undefined;
  }
  const main = context.board.get(instance.mainId);
  const base = Object.fromEntries(
    Object.entries(instance).filter(([key]) => !INSTANCE_ONLY_FIELDS.has(key)),
  ) as Omit<
    InstanceObject,
    'mainId' | 'overrides' | 'isWidthFixed' | 'isHeightFixed' | 'variant' | 'swapOptions' | 'scale'
  >;
  const frame: FrameObject = {
    ...base,
    type: 'frame',
    name: main?.type === 'component' ? main.name : '',
    clip: false,
    background: null,
    ...detachedAutoLayout(main, instance),
  };
  const nested = resolved.objects
    .filter((object) => object.type === 'instance' && !flattened.has(object.mainId))
    .map((object) => `${object.id}/`);
  const selected = resolved.objects.filter(
    (object) => !nested.some((prefix) => object.id.startsWith(prefix)),
  );
  const ids = new Map<string, ObjectId>(selected.map((object) => [object.id, context.createId()]));
  ids.set(instance.id, instance.id);
  const isScaled = (instance.scale ?? 1) !== 1;
  const baked = selected.map((object) =>
    bakedCopy(materialize(object, ids, context, flattened), isScaled),
  );
  const clamped: DetachClamp[] = baked.flatMap((copy) => copy.clamped);
  const children = ownKeys(baked, selected);
  const seen = new Set<ObjectId>();
  for (const [index, child] of children.entries()) {
    if (context.board.get(child.id) !== undefined || seen.has(child.id))
      errors.push(
        commandError('duplicate-id', child.id, [], 'A generated child id is already in use.'),
      );
    seen.add(child.id);
    // A copy is a new object, judged whole: one refused for a value a peer left invalid in the
    // main is named as its source there, as `duplicatePage` names one, never by an id that was
    // never stored.
    const copyErrors: CommandError[] = [];
    checkObject(context.board, child, copyErrors);
    const source = sourceIdOf(selected[index]?.id ?? child.id);
    errors.push(...copyErrors.map((error) => ({ ...error, objectId: source })));
  }
  // The frame's own layout, the main's at the instance's scale, may pass its limits too.
  const bakedFrame = bakedCopy(frame, false);
  clamped.push(...bakedFrame.clamped);
  checkObject(context.board, bakedFrame.object, errors);
  const prefix = `${instance.id}/`;
  const idMap = Object.fromEntries(
    selected.flatMap((object) => {
      const id = ids.get(object.id);
      return id === undefined || !object.id.startsWith(prefix)
        ? []
        : [[object.id.slice(prefix.length), id] as const];
    }),
  );
  return { frame: bakedFrame.object as FrameObject, children, idMap, clamped };
}

/** Turns an instance into a same-id frame with materialized, independently editable content. */
export const detachInstanceCommand: Command<
  typeof detachInstanceInputSchema,
  DetachInstancePlan,
  DetachInstanceResult
> = {
  split: splitInstanceDetach,
  name: 'detachInstance',
  description:
    'Detaches an instance into an editable frame while keeping its identity and attachments.',
  input: detachInstanceInputSchema,
  isPlacePreserving: true,
  validate(context, input) {
    const { named, errors } = lookUpNamed(
      context.board,
      [input.id],
      (id) => id,
      () => ['id'],
    );
    const instance = named[0]?.object;
    if (instance === undefined) return reject(errors);
    if (instance.type !== 'instance')
      return reject([
        commandError('unsupported-type', instance.id, ['id'], 'An instance is required.'),
      ]);
    const plan = planInstanceDetach(context, instance, errors);
    return plan === undefined || errors.length > 0 ? reject(errors) : accept(plan);
  },
  apply(transaction, input, plan) {
    if (transaction.get(plan.frame.id)?.type === 'instance') transaction.setObject(plan.frame);
    for (const child of plan.children) transaction.setObject(child);
    return {
      frameId: plan.frame.id,
      createdIds: plan.children.map((child) => child.id),
      idMap: plan.idMap,
      clamped: plan.clamped,
    };
  },
};
