import type { BoardObject, ConnectorObject, ObjectId } from '@canvas/schema';

import type { SceneSource } from '../scene/scene-source.js';

/**
 * An object's chain of ancestors, the object first, up to the root; a missing parent or a cycle
 * ends it.
 *
 * @param object - The object.
 * @param source - The document.
 * @returns The chain.
 */
function chainOf(object: BoardObject, source: SceneSource): BoardObject[] {
  const chain = [object];
  for (let parentId = object.parentId; parentId !== null;) {
    // Chains are a few objects deep: a scan beats a set, and a cycle ends here.
    const id: ObjectId = parentId;
    if (chain.some((ancestor) => ancestor.id === id)) break;
    const parent = source.get(id);
    if (parent === undefined) break;
    chain.push(parent);
    parentId = parent.parentId;
  }
  return chain;
}

/**
 * Adds the part of a chain below what it shares with another: the objects whose placement moves
 * one end relative to the other.
 *
 * @param key - Where they go.
 * @param chain - One chain, its object first.
 * @param other - The other chain.
 */
function addBelow(
  key: BoardObject[],
  chain: readonly BoardObject[],
  other: readonly BoardObject[],
) {
  for (const object of chain) {
    if (other.some((shared) => shared.id === object.id)) return;
    key.push(object);
  }
}

/**
 * What a connector's shape depends on, as object values: the connector, each attached
 * end's target, and every ancestor of either below the ancestor they share. Values are immutable,
 * so when every value is the same object as last time the shape is the same, and the router keeps
 * the placed value without placing again: a drag of a frame holding a connector and its targets
 * moves them rigidly and changes none of them. Undefined (always place again) when a target is
 * missing or is a group, whose bounds follow its children. Pure.
 *
 * @param connector - The connector.
 * @param source - The document.
 * @returns The values, in a fixed order, or undefined.
 */
export function connectorPlacementKey(
  connector: ConnectorObject,
  source: SceneSource,
): readonly BoardObject[] | undefined {
  const own = chainOf(connector, source);
  const key: BoardObject[] = [];
  for (const end of [connector.from, connector.to]) {
    if (end.kind !== 'object') continue;
    const target = source.get(end.objectId);
    if (target === undefined || target.type === 'group') return undefined;
    const chain = chainOf(target, source);
    addBelow(key, own, chain);
    addBelow(key, chain, own);
  }
  return key.length === 0 ? [connector] : key;
}

/**
 * Whether two keys hold the same values in the same order.
 *
 * @param a - One key.
 * @param b - The other.
 * @returns True when every value is the same object.
 */
export function isSamePlacementKey(
  a: readonly BoardObject[] | undefined,
  b: readonly BoardObject[] | undefined,
): boolean {
  if (a === undefined || a.length !== b?.length) return false;
  return a.every((object, index) => object === b[index]);
}
