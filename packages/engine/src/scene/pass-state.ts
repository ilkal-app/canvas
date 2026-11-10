import type { ObjectId } from '@canvas/schema';

import { InstanceBuffer, type InstanceBufferOptions } from './instance-buffer.js';
import type { ScenePass } from './scene-pass.js';

/** One pass with its instance buffer, a scratch record and the slots each object holds in it. */
export interface PassState {
  /** The pass. */
  readonly pass: ScenePass;
  /** Its persistent instance buffer. */
  readonly buffer: InstanceBuffer;
  /** Reused for every `prepare` call, so a change allocates no record. */
  readonly scratchRecord: Float32Array;
  /** Each drawn object's slots in this pass's buffer, record 0 first. */
  readonly slotsById: Map<ObjectId, number[]>;
  /** Each drawn object's slot ownership revision (`Scene.slotRevisionOf`). */
  readonly slotRevisions: Map<ObjectId, number>;
  /**
   * Each object's slots by its dense handle (`Scene.handleOf`): the same live arrays as
   * `slotsById`, undefined where it holds none, so a hot path reads them without a map lookup.
   */
  readonly slotsByHandle: (number[] | undefined)[];
  /** Each object's slot ownership revision by its dense handle, 0 where it holds no slots. */
  revisionByHandle: Uint32Array;
  /** A paged pass's page per slot (`ScenePass.pageOf`), grown with the buffer; else empty. */
  pageBySlot: Int32Array;
  /** Counts the changes to `pageBySlot`, so the draw list's page split knows when to redo. */
  pageRevision: number;
}

/**
 * Records the page a slot's record samples, growing the table with the buffer.
 *
 * @param state - A paged pass.
 * @param slot - The slot.
 * @param page - Its page.
 */
export function setSlotPage(state: PassState, slot: number, page: number): void {
  if (state.pageBySlot.length < state.buffer.capacity) {
    const grown = new Int32Array(state.buffer.capacity);
    grown.set(state.pageBySlot);
    state.pageBySlot = grown;
  }
  if (state.pageBySlot[slot] === page) return;
  state.pageBySlot[slot] = page;
  state.pageRevision += 1;
}

/**
 * Builds each pass's state: an empty instance buffer with the pass's layout, a scratch record and
 * no slots.
 *
 * @param passes - The passes, in draw order.
 * @param options - Their buffers' capacity and coalescing.
 * @returns The states, in the passes' order.
 * @throws {RangeError} When two passes share a name.
 */
export function createPassStates(
  passes: readonly ScenePass[],
  options?: InstanceBufferOptions,
): PassState[] {
  if (new Set(passes.map((pass) => pass.name)).size !== passes.length) {
    const names = passes.map((pass) => pass.name).join(', ');
    throw new RangeError(`Scene pass names must be unique: ${names}.`);
  }
  return passes.map((pass) => ({
    pass,
    buffer: new InstanceBuffer(pass.layout, options),
    scratchRecord: new Float32Array(pass.layout.floatsPerRecord),
    slotsById: new Map(),
    slotRevisions: new Map(),
    slotsByHandle: [],
    revisionByHandle: new Uint32Array(0),
    pageBySlot: new Int32Array(0),
    pageRevision: 0,
  }));
}

/**
 * Records an object's slots and ownership revision under its dense handle, growing the
 * revision table as handles are handed out.
 *
 * @param state - The pass.
 * @param handle - The object's handle.
 * @param slots - Its live slots, or undefined when it holds none here.
 * @param revision - Its ownership revision, 0 when it holds none.
 */
export function setHandleSlots(
  state: PassState,
  handle: number,
  slots: number[] | undefined,
  revision: number,
): void {
  if (handle >= state.revisionByHandle.length) {
    const grown = new Uint32Array(Math.max(64, (handle + 1) * 2));
    grown.set(state.revisionByHandle);
    state.revisionByHandle = grown;
  }
  state.slotsByHandle[handle] = slots;
  state.revisionByHandle[handle] = revision;
}
