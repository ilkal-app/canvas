import {
  resolveInstanceChild,
  type BoardObject,
  type InstanceObject,
  type ObjectId,
  type ResolvedInstanceChild,
} from '@canvas/schema';

import type { DefinitionSource } from './definition-source.js';

/**
 * Reads an edited child and its ancestors once per change set, for patching every instance.
 */
export class ChildReads {
  private readonly objects = new Map<ObjectId, BoardObject>();
  private readonly read = new Set<ObjectId>();
  /** The objects read, with every auto-layout set aside. */
  private readonly unlaid = new Map<ObjectId, BoardObject>();

  /**
   * Creates reads over whole-board definitions.
   *
   * @param definitions - Whole-board indexed access.
   */
  constructor(private readonly definitions: DefinitionSource) {}

  /**
   * Patches the copies of edited leaf children in one instance without resolving it in full.
   *
   * @param instance - The shown real instance.
   * @param childIds - Edited ids that the instance depends on.
   * @param current - The instance's current virtual objects by id.
   * @param isLayoutNeutral - Whether an edit to a child changed nothing a layout reads of it:
   * a child of an auto-layout container then keeps the place it has.
   * @returns The patched copies by virtual id, or undefined when only a full resolution can
   *   answer (a structural edit, a copy appearing, disappearing or changing parent, or an edit a
   *   layout reads).
   */
  patch(
    instance: InstanceObject,
    childIds: ReadonlySet<ObjectId>,
    current: ReadonlyMap<ObjectId, BoardObject>,
    isLayoutNeutral: (childId: ObjectId) => boolean = () => false,
  ): Map<ObjectId, BoardObject> | undefined {
    this.load(instance.mainId);
    const patched = new Map<ObjectId, BoardObject>();
    for (const childId of childIds) {
      this.loadChain(childId, instance.mainId);
      const virtualId = `${instance.id}/${childId}` as ObjectId;
      const before = current.get(virtualId);
      const result =
        resolveInstanceChild({ objects: this.objects }, instance, childId) ??
        (before !== undefined && isLayoutNeutral(childId)
          ? this.inPlace(instance, childId, before)
          : undefined);
      if (result === undefined) return undefined;
      if (result.kind === 'hidden') {
        if (before !== undefined) return undefined;
        continue;
      }
      if (before?.parentId !== result.object.parentId) return undefined;
      patched.set(virtualId, result.object);
    }
    return patched;
  }

  /**
   * A child of an auto-layout container whose edit no layout reads: its copy as if
   * nothing were laid out, at the place the layout gave it before. A layout places a box child
   * by what it reads alone, and that is unchanged, so the place is too.
   *
   * @param instance - The shown real instance.
   * @param childId - The edited child, already loaded with its ancestors.
   * @param before - Its current copy.
   * @returns The patched copy, or undefined when the child is not a laid-out box.
   */
  private inPlace(
    instance: InstanceObject,
    childId: ObjectId,
    before: BoardObject,
  ): ResolvedInstanceChild | undefined {
    const child = this.objects.get(childId);
    const parent = child?.parentId == null ? undefined : this.objects.get(child.parentId);
    if (child === undefined || !isBox(child) || !isBox(before) || !isLaidOut(parent)) {
      return undefined;
    }
    for (const [id, object] of this.objects) {
      if (!this.unlaid.has(id)) {
        this.unlaid.set(id, unlaid(object));
      }
    }
    const result = resolveInstanceChild({ objects: this.unlaid }, instance, childId);
    if (result?.kind !== 'shown' || !isBox(result.object)) return undefined;
    const { x, y, width, height } = before;
    return { kind: 'shown', object: { ...result.object, x, y, width, height } };
  }

  private loadChain(childId: ObjectId, mainId: ObjectId): void {
    let at: ObjectId | null = childId;
    const seen = new Set<ObjectId>();
    while (at !== null && at !== mainId && !seen.has(at)) {
      seen.add(at);
      at = this.load(at)?.parentId ?? null;
    }
  }

  private load(id: ObjectId): BoardObject | undefined {
    if (!this.read.has(id)) {
      this.read.add(id);
      const object = this.definitions.get(id);
      if (object !== undefined) this.objects.set(id, object);
    }
    return this.objects.get(id);
  }
}

/** A board object with a stored width and height: the only kind a stack places. */
type Box = Extract<BoardObject, { width: number; height: number }>;

/**
 * Whether an object is a box.
 *
 * @param object - The object.
 * @returns True when it has a stored width and height.
 */
function isBox(object: BoardObject): object is Box {
  return 'width' in object && 'height' in object;
}

/**
 * Whether an object is a frame or main with a live auto-layout.
 *
 * @param object - The object, if any.
 * @returns True when it lays out its children.
 */
function isLaidOut(object: BoardObject | undefined): boolean {
  return (
    (object?.type === 'frame' || object?.type === 'component') && object.autoLayout !== undefined
  );
}

/**
 * An object with its auto-layout set aside, so a constraint places its children.
 *
 * @param object - The object.
 * @returns The object without `autoLayout`; the object itself when it has none.
 */
function unlaid(object: BoardObject): BoardObject {
  if ((object.type !== 'frame' && object.type !== 'component') || !isLaidOut(object)) return object;
  const copy = { ...object };
  delete copy.autoLayout;
  return copy;
}
