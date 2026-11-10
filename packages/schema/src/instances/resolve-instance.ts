import type { Board } from '../board/board.js';
import { buildChildIndex, type ChildIndex } from '../board/child-index.js';
import { isStoredHidden, withoutStoredHidden } from '../fields/visibility.js';
import { scaledObject } from '../geometry/scaled-object.js';
import type { ObjectId } from '../ids/object-id.js';
import type { BoardObject } from '../objects/board-object.js';
import type { ConnectorEnd } from '../objects/connector-object.js';
import type { InstanceObject } from '../objects/instance-object.js';

import { constrainChildren } from './constrain-children.js';
import { definitionContent } from './definition-content.js';
import { effectiveOverrides, effectiveOverridesOf } from './effective-overrides.js';
import { layOutInstanceContent, unscaledInstance } from './instance-layout.js';
import { MAX_INSTANCE_DEPTH } from './instance-limits.js';
import type { InstanceOverrides } from './instance-overrides.js';
import type { InstanceReferenceIssue } from './instance-references.js';
import { applyInstanceOverride } from './override-content.js';
import { withRecordGeometry } from './preset-geometry.js';
import { recordAt, slotExpansion } from './slot-expansion.js';

/** An instance's transient render tree; none of these virtual objects is stored. */
export interface ResolvedInstance {
  /** Expanded descendants in their virtual parent's coordinate frame. */
  readonly objects: readonly BoardObject[];
  /** Why expansion stopped, if some reference could not be followed. */
  readonly issue?: InstanceReferenceIssue;
  /** Whether the root main was retired but retained for this instance. */
  readonly isMainRetired: boolean;
}

/**
 * Forms a transient address. The slash deliberately keeps this outside stored ObjectId syntax.
 *
 * @param instanceId - The real instance selected by tools and presence.
 * @param path - Nested source instance ids followed by a source child id.
 * @returns A virtual id, never a valid stored object id.
 */
export function virtualObjectId(instanceId: ObjectId, path: string): string {
  return `${instanceId}/${path}`;
}

/** State shared across one bounded expansion. */
interface ResolveWalk {
  readonly board: Board;
  readonly children: ChildIndex;
  readonly rootId: ObjectId;
  readonly objects: BoardObject[];
  issue: InstanceReferenceIssue | undefined;
}

/**
 * Remaps an attached end to the sibling's virtual address when the target is definition content.
 *
 * @param end - The source end.
 * @param ids - Source ids in this definition.
 * @param virtualId - The source-to-virtual address mapping.
 * @returns The remapped end, preserving a free or external end.
 */
function remapEnd(
  end: ConnectorEnd,
  ids: ReadonlySet<ObjectId>,
  virtualId: (id: ObjectId) => ObjectId,
): ConnectorEnd {
  return end.kind === 'object' && ids.has(end.objectId)
    ? { ...end, objectId: virtualId(end.objectId) }
    : end;
}

/**
 * Places a main's content in an instance: constraints map it to the instance's size, then every
 * auto-layout container lays its children out with the instance's records.
 *
 * @param walk - The source board and its child index.
 * @param main - The main being expanded.
 * @param instance - The instance, with its effective overrides.
 * @param content - The main's definition content.
 * @returns Each content object as placed in the instance, by id.
 */
function placedContent(
  walk: ResolveWalk,
  main: BoardObject,
  instance: InstanceObject,
  content: readonly BoardObject[],
): Map<ObjectId, BoardObject> {
  const constrained = constrainChildren(walk.board, main, instance, walk.children);
  return layOutInstanceContent(
    walk.board,
    walk.children,
    main,
    instance,
    content,
    new Map(constrained.map((object) => [object.id, object])),
  );
}

/**
 * Expands a valid main into a virtual parent, preserving ordinary container ancestry. A scaled
 * instance places its content in main units, in its box divided by its `scale`, and
 * each copy is drawn larger by its `scale` times the enclosing instances' (`outer`).
 *
 * @param walk - The source board and accumulated output.
 * @param scaled - The real source instance with its effective overrides.
 * @param prefix - Nested source-instance path, with a trailing slash when nonempty.
 * @param virtualParent - The parent of this definition's direct children.
 * @param mains - Mains already traversed; bounds reference cycles and nesting.
 * @param outer - The scale the enclosing instances draw this one's frame at; 1 at the root.
 */
function expand(
  walk: ResolveWalk,
  scaled: InstanceObject,
  prefix: string,
  virtualParent: ObjectId,
  mains: readonly ObjectId[],
  outer = 1,
): void {
  const instance = unscaledInstance(scaled);
  const factor = outer * (scaled.scale ?? 1);
  const main = walk.board.objects.get(instance.mainId);
  let issue: InstanceReferenceIssue | undefined;
  if (main === undefined) issue = 'missing-main';
  else if (main.type !== 'component') issue = 'invalid-main';
  else if (mains.includes(main.id)) issue = 'instance-cycle';
  else if (mains.length >= MAX_INSTANCE_DEPTH) issue = 'instance-depth';
  if (issue !== undefined || main?.type !== 'component') {
    walk.issue ??= issue;
    return;
  }
  const content = definitionContent(walk.board, main.id, walk.children);
  const ids = new Set(content.map(({ id }) => id));
  // The main as the records draw it: a variant's size, its children's boxes and its
  // containers' layout, before constraints and auto-layout place the content.
  const drawn = withRecordGeometry(walk.board, main, content, instance.overrides, walk.children);
  const mapped = placedContent(
    { ...walk, board: drawn.board },
    drawn.main,
    instance,
    content.map((object) => drawn.board.objects.get(object.id) ?? object),
  );
  const hidden = new Set<ObjectId>();
  // The main's chosen presets alone, which a swapped slot carries over by layer name.
  let presets: InstanceOverrides | undefined;
  const virtualId = (id: ObjectId): ObjectId =>
    virtualObjectId(walk.rootId, `${prefix}${id}`) as ObjectId;
  for (const source of content) {
    const record = recordAt(instance.overrides, source.id);
    // A record says either way; else the stored visibility.
    const isOwnHidden = record?.isHidden ?? isStoredHidden(source);
    if (isOwnHidden || (source.parentId !== null && hidden.has(source.parentId))) {
      hidden.add(source.id);
      continue;
    }
    let object = mapped.get(source.id) ?? source;
    if (object.type === 'instance')
      object = slotExpansion(
        walk.board,
        object,
        instance.overrides,
        [...mains, main.id],
        walk.children,
        (presets ??= effectiveOverrides({ ...instance, overrides: {} }, main)),
      );
    else if (record !== undefined) object = applyInstanceOverride(object, record);
    let virtual: BoardObject = {
      ...withoutStoredHidden(object),
      id: virtualId(source.id),
      parentId:
        source.parentId === main.id || source.parentId === null
          ? virtualParent
          : virtualId(source.parentId),
      pageId: null,
    };
    if (virtual.type === 'connector') {
      virtual = {
        ...virtual,
        from: remapEnd(virtual.from, ids, virtualId),
        to: remapEnd(virtual.to, ids, virtualId),
      };
    }
    walk.objects.push(scaledObject(virtual, factor));
    if (object.type === 'instance')
      expand(walk, object, `${prefix}${source.id}/`, virtual.id, [...mains, main.id], factor);
  }
}

/**
 * Resolves an instance from its retained or live main without copying document children.
 * Overrides replace only their allowed properties; reference failures preserve already
 * resolved content and report an issue instead of silently claiming an empty valid instance.
 *
 * Overrides are the instance's effective ones by default: its variant presets composed under its
 * own records (`effectiveOverridesOf`).
 *
 * @param board - The immutable source board.
 * @param instance - The real instance placement and overrides.
 * @param children - Optional caller-maintained whole-board child index.
 * @param overrides - The records to resolve with; its effective overrides when omitted.
 * @returns Its virtual descendants, retirement status and any reference issue.
 */
export function resolveInstance(
  board: Board,
  instance: InstanceObject,
  children: ChildIndex = buildChildIndex(board),
  overrides: InstanceOverrides = effectiveOverridesOf(instance, board),
): ResolvedInstance {
  const walk: ResolveWalk = {
    board,
    children,
    rootId: instance.id,
    objects: [],
    issue: undefined,
  };
  expand(
    walk,
    overrides === instance.overrides ? instance : { ...instance, overrides },
    '',
    instance.id,
    [],
  );
  const main = board.objects.get(instance.mainId);
  return {
    objects: walk.objects,
    isMainRetired: main?.type === 'component' && main.retired,
    ...(walk.issue === undefined ? {} : { issue: walk.issue }),
  };
}
