import * as Y from 'yjs';

import type { ScannedItem } from '../assets/update-scan.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import type { Landing } from './held-structs.js';

// Where in a board object a value an update writes lands (part 1): the relay's door check
// judges the values of an object's fields, and the stamp check's replay (`update-integration.ts`)
// says only which type each item lands in. An object's fields sit one level under `objects` (the
// object's map), a path network's members two (the object's map, then the network's); the type is
// named by identity, either a type the document holds (`Y.AbstractType`, placed through its
// `_item`) or an item of the same update (placed through its own landing). Package-internal.

/** Where a value lands in an object. */
export interface ObjectFieldLanding {
  /** The object's id: its key in `objects`. */
  readonly objectId: string;
  /** The key in the object's map: a group, an own key, or a network's key. */
  readonly key: string;
  /** For a member of a network (`vertices`, `segments`): its id, its key in the network's map. */
  readonly memberId?: string;
}

/** Where a type sits: its parent's top-level name or identity, and its key there. */
interface TypePlace {
  /** The parent's top-level name, or undefined for a nested parent. */
  readonly parentName: string | undefined;
  /** The type's key in its parent, or undefined. */
  readonly parentSub: string | undefined;
  /** The parent, as {@link Landing.parent} names it. */
  readonly parent: unknown;
}

/**
 * Resolves landings to object fields, for one update replayed into one document.
 */
export class FieldLandings {
  readonly #doc: Y.Doc;
  readonly #landings: ReadonlyMap<ScannedItem, Landing>;
  #names: Map<unknown, string> | undefined;
  /** Each nested type's top-level type as walked so far, so every type is walked once. */
  readonly #roots = new Map<unknown, string | undefined>();

  /**
   * Prepares the resolution.
   *
   * @param doc - The document the update is bound for; read, never changed.
   * @param landings - Where the replay put each item of the update (`replayIntegration`).
   */
  constructor(doc: Y.Doc, landings: ReadonlyMap<ScannedItem, Landing>) {
    this.#doc = doc;
    this.#landings = landings;
  }

  /**
   * Finds the object field a map value lands in: an object's own key (its map one level under
   * `objects`), or a member of one of its networks (two levels under). The walk takes at most two
   * steps up, far within the nesting bound (128) of the scan: no field the door judges sits
   * deeper, so a value deeper is in none.
   *
   * @param landing - Where the value landed.
   * @returns The field, or undefined when the value lands in no object's map or network.
   */
  resolve(landing: Landing): ObjectFieldLanding | undefined {
    const key = landing.parentSub;
    if (landing.isCollected || landing.parentName !== undefined || key === undefined) {
      return undefined;
    }
    const container = this.#placeOf(landing.parent);
    if (container?.parentSub === undefined) return undefined;
    if (container.parentName === OBJECTS_MAP_NAME) return { objectId: container.parentSub, key };
    if (container.parentName !== undefined) return undefined;
    const object = this.#placeOf(container.parent);
    if (object?.parentName !== OBJECTS_MAP_NAME || object.parentSub === undefined) return undefined;
    return { objectId: object.parentSub, key: container.parentSub, memberId: key };
  }

  /**
   * The top-level type a value lands under, however deep (the door refuses any value
   * nested under the facilitation map). Yjs types form a tree, so the walk up ends; each type's
   * root is remembered, so an update's values cost one step per type, however deep the chain
   * (a legacy board may hold types nested far deeper than any plain value).
   *
   * @param landing - Where the value landed.
   * @returns The top-level type's name, or undefined when collected or not placed in one.
   */
  rootNameOf(landing: Landing): string | undefined {
    if (landing.isCollected) return undefined;
    if (landing.parentName !== undefined) return landing.parentName;
    const walked = new Set<unknown>();
    let type: unknown = landing.parent;
    let root: string | undefined;
    for (;;) {
      if (this.#roots.has(type)) {
        root = this.#roots.get(type);
        break;
      }
      const place = this.#placeOf(type);
      // A type met twice (no Yjs tree has one) ends the walk with no root.
      if (place === undefined || walked.has(type)) break;
      walked.add(type);
      if (place.parentName !== undefined) {
        root = place.parentName;
        break;
      }
      type = place.parent;
    }
    for (const visited of walked) this.#roots.set(visited, root);
    return root;
  }

  /**
   * Places a nested type: an item of the update by its landing, a type of the document by its
   * item.
   *
   * @param type - The type, as a landing names its parent.
   * @returns Where it sits, or undefined when it sits nowhere (collected) or is not nested.
   */
  #placeOf(type: unknown): TypePlace | undefined {
    const landing = this.#landings.get(type as ScannedItem);
    if (landing !== undefined) return landing.isCollected ? undefined : landing;
    if (!(type instanceof Y.AbstractType)) return undefined;
    const item = (type as Y.AbstractType<unknown>)._item;
    if (item === null) return undefined;
    const parentName = this.#nameOf(item.parent);
    return {
      parentName,
      parentSub: item.parentSub ?? undefined,
      parent: parentName ?? item.parent,
    };
  }

  /**
   * Names a top-level type of the document.
   *
   * @param type - A parent type.
   * @returns Its name, or undefined for a nested type.
   */
  #nameOf(type: unknown): string | undefined {
    this.#names ??= new Map([...this.#doc.share].map(([name, shared]) => [shared, name]));
    return this.#names.get(type);
  }
}
