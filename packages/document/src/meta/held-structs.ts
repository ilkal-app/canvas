import * as Y from 'yjs';

// The structs a document already holds, read as the relay's stamp check replays Yjs's
// integration of an update into it (`update-integration.ts`, fix round 2): where each
// sits, and the type it holds as a parent. Package-internal.

/** Where an integrated struct lands, as `Item.getMissing` resolves its parent. */
export interface Landing {
  /**
   * Yjs keeps it only as a collected struct, sitting nowhere: it was one, a neighbour was one,
   * or its parent is gone.
   */
  readonly isCollected: boolean;
  /** Its parent's top-level name, or undefined for a nested parent (or none). */
  readonly parentName: string | undefined;
  /** Its map key, or undefined. */
  readonly parentSub: string | undefined;
  /**
   * Its parent, compared by identity: a top-level type's name, the document's nested type, or
   * the update's item holding the type; undefined when collected.
   */
  readonly parent: unknown;
}

/** A struct found by id: where it landed, and the type it holds as a parent, if any. */
export interface FoundStruct {
  readonly landing: Landing;
  /** The type as {@link Landing.parent} names it, or undefined when it holds none. */
  readonly type: unknown;
}

/** The landing of every collected struct. */
export const COLLECTED: Landing = Object.freeze({
  isCollected: true,
  parentName: undefined,
  parentSub: undefined,
  parent: undefined,
});

/**
 * Looks up the structs a document held before an update, by id.
 */
export class HeldStructs {
  readonly #doc: Y.Doc;
  #names: Map<unknown, string> | undefined;

  /**
   * Reads one document.
   *
   * @param doc - The document; read, never changed.
   */
  constructor(doc: Y.Doc) {
    this.#doc = doc;
  }

  /**
   * Finds the struct holding an id the document holds.
   *
   * @param client - The id's client.
   * @param clock - A clock inside it, below the document's state for that client.
   * @returns Where it sits and the type it holds, if any.
   */
  find(client: number, clock: number): FoundStruct {
    const structs = this.#doc.store.clients.get(client) ?? [];
    const struct = structs[Y.findIndexSS(structs, clock)];
    if (!(struct instanceof Y.Item)) return { landing: COLLECTED, type: undefined };
    const parentName = this.#nameOf(struct.parent);
    return {
      landing: {
        isCollected: false,
        parentName,
        parentSub: struct.parentSub ?? undefined,
        parent: parentName ?? struct.parent,
      },
      type: struct.content instanceof Y.ContentType ? struct.content.type : undefined,
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
