import { isStoredHidden, type BoardObject, type ObjectId } from '@canvas/schema';

/** Current page objects and their real ancestry, including hidden retained mains and layers. */
export class ShownObjects {
  readonly objects = new Map<ObjectId, BoardObject>();
  private readonly children = new Map<ObjectId, Set<ObjectId>>();

  /**
   * Updates ancestry before evaluating visibility for the whole change batch.
   *
   * @param id - Real object id.
   * @param object - Current object, or undefined when it left the page.
   */
  set(id: ObjectId, object: BoardObject | undefined): void {
    const old = this.objects.get(id);
    if (old?.parentId != null) {
      const siblings = this.children.get(old.parentId);
      siblings?.delete(id);
      if (siblings?.size === 0) this.children.delete(old.parentId);
    }
    if (object === undefined) this.objects.delete(id);
    else {
      this.objects.set(id, object);
      if (object.parentId !== null) {
        let children = this.children.get(object.parentId);
        if (children === undefined) this.children.set(object.parentId, (children = new Set()));
        children.add(id);
      }
    }
  }

  /**
   * Includes descendants when a parent's retirement, visibility or ancestry changes.
   *
   * @param ids - Changed roots.
   * @returns Roots and descendants, once each.
   */
  descendants(ids: Iterable<ObjectId>): Set<ObjectId> {
    const result = new Set(ids);
    for (const id of result) for (const child of this.children.get(id) ?? []) result.add(child);
    return result;
  }

  /**
   * Hides retained definitions, hidden layers and their real descendants.
   *
   * @param id - A real object on the page.
   * @returns Its renderable value, if neither it nor an ancestor is retired or hidden.
   */
  get(id: ObjectId): BoardObject | undefined {
    const object = this.objects.get(id);
    const seen = new Set<ObjectId>();
    let at = object;
    while (at !== undefined && !seen.has(at.id)) {
      seen.add(at.id);
      if ((at.type === 'component' && at.retired) || isStoredHidden(at)) return undefined;
      at = at.parentId === null ? undefined : this.objects.get(at.parentId);
    }
    return object;
  }
}
