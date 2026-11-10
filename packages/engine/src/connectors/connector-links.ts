import type { BoardObject, ObjectId } from '@canvas/schema';

const NONE: ReadonlySet<ObjectId> = new Set();

/**
 * Which connectors are attached to which objects, so a change to an object re-routes only the
 * connectors on it (a camera-only frame, or a move of an object
 * nothing is attached to, does no connector work). Fed each listed object of every change set;
 * rendering thread only.
 */
export class ConnectorLinks {
  private readonly connectorsByTarget = new Map<ObjectId, Set<ObjectId>>();
  private readonly targetsByConnector = new Map<ObjectId, readonly ObjectId[]>();

  /**
   * How many connectors have an attached end.
   *
   * @returns The count.
   */
  get size(): number {
    return this.targetsByConnector.size;
  }

  /**
   * Records an object as the document holds it now: a connector's attached ends replace what was
   * recorded for it; anything else (or nothing, for a removed object) records none.
   *
   * @param id - The object's id.
   * @param object - The object now, or `undefined` when it is gone.
   */
  observe(id: ObjectId, object: BoardObject | undefined): void {
    const targets =
      object?.type === 'connector'
        ? [object.from, object.to].flatMap((end) => (end.kind === 'object' ? [end.objectId] : []))
        : [];
    const previous = this.targetsByConnector.get(id);
    if (previous === undefined && targets.length === 0) return;
    if (
      previous?.length === targets.length &&
      previous.every((target, index) => target === targets[index])
    )
      return;
    for (const target of previous ?? []) {
      const connectors = this.connectorsByTarget.get(target);
      connectors?.delete(id);
      if (connectors?.size === 0) this.connectorsByTarget.delete(target);
    }
    if (targets.length === 0) {
      this.targetsByConnector.delete(id);
      return;
    }
    this.targetsByConnector.set(id, targets);
    for (const target of targets) {
      let connectors = this.connectorsByTarget.get(target);
      if (!connectors) {
        connectors = new Set();
        this.connectorsByTarget.set(target, connectors);
      }
      connectors.add(id);
    }
  }

  /**
   * Whether an object is a connector with an attached end, whose route follows where it is.
   *
   * @param id - The object.
   * @returns True for such a connector.
   */
  hasAttachedEnds(id: ObjectId): boolean {
    return this.targetsByConnector.has(id);
  }

  /**
   * The connectors with an end on an object.
   *
   * @param target - The object.
   * @returns Their ids; empty for none.
   */
  connectorsOn(target: ObjectId): ReadonlySet<ObjectId> {
    return this.connectorsByTarget.get(target) ?? NONE;
  }
}
