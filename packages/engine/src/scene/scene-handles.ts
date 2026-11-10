// Dense object handles and the per-pass tables they index. The visible-set passes read
// each changed object's slots and slot revision on every camera frame that changes what is
// visible; by id that costs a pass-name scan and two map lookups per object and pass. A handle is
// a small integer an object takes when it first holds slots and keeps for the scene's life,
// through deletion and recreation of the same id, so a reader can still find what a deleted object
// held; recreation always takes a fresh slot revision, which is what tells a reader its slots
// changed.
import type { ObjectId } from '@canvas/schema';

import { setHandleSlots, type PassState } from './pass-state.js';

/** A scene's dense object handles (`Scene.handles`), and its passes by name, read-only. */
export interface SceneHandles {
  /**
   * An object's dense handle: a small integer, stable for the scene's life once the object has
   * held slots in any pass, to index per-pass tables with.
   *
   * @param id - The object.
   * @returns Its handle, or undefined when it has never held slots in this scene.
   */
  handleOf(id: ObjectId): number | undefined;
  /**
   * A pass's index in the scene's passes, to read the handle tables with.
   *
   * @param passName - The pass's name.
   * @returns Its index.
   * @throws {RangeError} When no pass has that name.
   */
  passIndexOf(passName: string): number;
  /**
   * The slots an object's records occupy in one pass, by its handle: the same live array the
   * scene's `slotsOf` returns.
   *
   * @param handle - The object's handle (`handleOf`).
   * @param passIndex - The pass's index (`passIndexOf`).
   * @returns The slots, record 0 first, or undefined when it holds none there.
   */
  slotsOf(handle: number, passIndex: number): readonly number[] | undefined;
  /**
   * An object's slot ownership revision in one pass, by its handle: equal to the scene's
   * `slotRevisionOf`.
   *
   * @param handle - The object's handle (`handleOf`).
   * @param passIndex - The pass's index (`passIndexOf`).
   * @returns The revision, or 0 when it holds no slots there.
   */
  revisionOf(handle: number, passIndex: number): number;
}

/** {@link SceneHandles} over the scene's pass states; the scene records slots through it. */
export class SceneHandleTables implements SceneHandles {
  private readonly handles = new Map<ObjectId, number>();
  private readonly passIndexByName: ReadonlyMap<string, number>;

  /**
   * Starts with no handles.
   *
   * @param states - The scene's passes, in draw order.
   */
  constructor(private readonly states: readonly PassState[]) {
    this.passIndexByName = new Map(states.map(({ pass }, index) => [pass.name, index]));
  }

  /**
   * An object's dense handle: a small integer, stable for the scene's life once the object has
   * held slots in any pass, to index per-pass tables with.
   *
   * @param id - The object.
   * @returns Its handle, or undefined when it has never held slots in this scene.
   */
  handleOf(id: ObjectId): number | undefined {
    return this.handles.get(id);
  }

  /**
   * A pass's index in the scene's passes, to read the handle tables with.
   *
   * @param passName - The pass's name.
   * @returns Its index.
   * @throws {RangeError} When no pass has that name.
   */
  passIndexOf(passName: string): number {
    const index = this.passIndexByName.get(passName);
    if (index === undefined) throw new RangeError(`The scene has no pass named "${passName}".`);
    return index;
  }

  /**
   * The slots an object's records occupy in one pass, by its handle: the same live array the
   * scene's `slotsOf` returns.
   *
   * @param handle - The object's handle (`handleOf`).
   * @param passIndex - The pass's index (`passIndexOf`).
   * @returns The slots, record 0 first, or undefined when it holds none there.
   */
  slotsOf(handle: number, passIndex: number): readonly number[] | undefined {
    return this.states[passIndex]?.slotsByHandle[handle];
  }

  /**
   * An object's slot ownership revision in one pass, by its handle: equal to the scene's
   * `slotRevisionOf`.
   *
   * @param handle - The object's handle (`handleOf`).
   * @param passIndex - The pass's index (`passIndexOf`).
   * @returns The revision, or 0 when it holds no slots there.
   */
  revisionOf(handle: number, passIndex: number): number {
    return this.states[passIndex]?.revisionByHandle[handle] ?? 0;
  }

  /**
   * Records an object's slots in one pass under its handle, handing one out on first use.
   *
   * @param passIndex - The pass's index.
   * @param id - The object.
   * @param slots - Its live slots, at least one.
   * @param revision - Its ownership revision.
   */
  hold(passIndex: number, id: ObjectId, slots: number[], revision: number): void {
    const state = this.states[passIndex];
    if (state === undefined) return;
    let handle = this.handles.get(id);
    if (handle === undefined) {
      handle = this.handles.size;
      this.handles.set(id, handle);
    }
    setHandleSlots(state, handle, slots, revision);
  }

  /**
   * Records that an object holds no slots in one pass; its handle stays.
   *
   * @param passIndex - The pass's index.
   * @param id - The object.
   */
  release(passIndex: number, id: ObjectId): void {
    const state = this.states[passIndex];
    const handle = this.handles.get(id);
    if (state !== undefined && handle !== undefined) setHandleSlots(state, handle, undefined, 0);
  }
}
