import * as Y from 'yjs';

/** One decoded struct of an update: an item, a collected range, or a range the update skips. */
export type UpdateStruct = Y.Item | Y.GC | Y.Skip;

/** One chunk of structs: each client's consecutive structs, oldest first. */
export type StructChunk = ReadonlyMap<number, readonly UpdateStruct[]>;

/**
 * What an update v1 costs beyond its structs, bytes, at most: the client count (a varuint of up
 * to 5 bytes) and an empty delete set (1 byte).
 */
export const UPDATE_OVERHEAD_BYTES = 6;

/**
 * What one client's run costs beyond its structs, bytes, at most: the struct count and the
 * client id (varuints of up to 5 bytes each) and the first clock (up to 8 bytes below 2^53).
 */
export const RUN_OVERHEAD_BYTES = 18;

/**
 * The ids an item needs before Yjs can integrate it: its left and right origins and, for an item
 * at the start of a type, a parent that is itself an item. A collected or skipped range needs
 * nothing. A client's own earlier structs are needed too; the planner keeps each client's
 * structs in clock order, which covers them.
 *
 * @param struct - The struct.
 * @returns The ids it depends on.
 */
function dependenciesOf(struct: UpdateStruct): Y.ID[] {
  if (!(struct instanceof Y.Item)) return [];
  const ids: Y.ID[] = [];
  if (struct.origin !== null) ids.push(struct.origin);
  if (struct.rightOrigin !== null) ids.push(struct.rightOrigin);
  if (struct.parent instanceof Y.ID) ids.push(struct.parent);
  return ids;
}

/** A chunk being filled, with its byte count so far. */
class ChunkBuilder {
  readonly runs = new Map<number, UpdateStruct[]>();
  #bytes = UPDATE_OVERHEAD_BYTES;

  /**
   * Whether a struct still fits: always in an empty chunk (a struct is never split), else
   * when the chunk stays within `maxBytes` with it.
   *
   * @param client - The struct's client.
   * @param size - Its encoded size, bytes.
   * @param maxBytes - The chunk limit, bytes.
   * @returns `true` when it fits.
   */
  fits(client: number, size: number, maxBytes: number): boolean {
    if (this.runs.size === 0) return true;
    const header = this.runs.has(client) ? 0 : RUN_OVERHEAD_BYTES;
    return this.#bytes + header + size <= maxBytes;
  }

  /**
   * Adds a struct at the end of its client's run.
   *
   * @param client - The struct's client.
   * @param struct - The struct.
   * @param size - Its encoded size, bytes.
   */
  add(client: number, struct: UpdateStruct, size: number): void {
    const run = this.runs.get(client);
    if (run === undefined) {
      this.runs.set(client, [struct]);
      this.#bytes += RUN_OVERHEAD_BYTES + size;
    } else {
      run.push(struct);
      this.#bytes += size;
    }
  }
}

/** One client's structs, in clock order, and how many of them are placed. */
class ClientQueue {
  readonly structs: UpdateStruct[] = [];
  #placed = 0;

  /**
   * The next struct to place.
   *
   * @returns It, or `undefined` once every struct is placed.
   */
  get next(): UpdateStruct | undefined {
    return this.structs[this.#placed];
  }

  /**
   * The first clock not yet placed: a dependency of this client below it is available.
   *
   * @returns The clock; infinite once every struct is placed.
   */
  get nextClock(): number {
    return this.next?.id.clock ?? Number.POSITIVE_INFINITY;
  }

  /** Records the next struct as placed. */
  advance(): void {
    this.#placed += 1;
  }
}

/**
 * Groups structs by client, keeping each client's in the order the update lists them (clock
 * order), clients in the order they first appear.
 *
 * @param structs - The update's structs.
 * @returns Each client's queue.
 */
function queuesOf(structs: readonly UpdateStruct[]): Map<number, ClientQueue> {
  const queues = new Map<number, ClientQueue>();
  for (const struct of structs) {
    let queue = queues.get(struct.id.client);
    if (queue === undefined) {
      queue = new ClientQueue();
      queues.set(struct.id.client, queue);
    }
    queue.structs.push(struct);
  }
  return queues;
}

/**
 * Plans the chunks of an update's structs: each chunk at most `maxBytes` once encoded
 * (a single struct larger than that alone in its chunk), and every chunk applicable in order on
 * a document that already holds whatever the update does not carry, with nothing left pending:
 * a struct goes in only once every struct it depends on is in this chunk or an earlier one. The
 * relay refuses an update Yjs would keep partly pending (`UpdateStampCheck`, 4425
 * `incomplete-update`), so a struct of one client that sits next to another client's (a peer's
 * content edited offline, a second tab's writer) must follow it. A client's structs stay in clock
 * order, so a writer's layout stamp, written before its first object, precedes its objects.
 * Structs whose dependencies never arrive (none in integrated content) go last, in update order,
 * for the relay to judge as it would the whole update. Pure; never mutates its inputs.
 *
 * @param structs - The update's structs, as `Y.decodeUpdate` lists them.
 * @param maxBytes - The chunk limit, bytes.
 * @param sizeOf - A struct's encoded size, bytes.
 * @returns The chunks, in sending order.
 */
export function planStructChunks(
  structs: readonly UpdateStruct[],
  maxBytes: number,
  sizeOf: (struct: UpdateStruct) => number,
): StructChunk[] {
  const queues = queuesOf(structs);
  // A client the update does not carry is all available: the receiver holds what it needs.
  const isAvailable = (id: Y.ID): boolean =>
    id.clock < (queues.get(id.client)?.nextClock ?? Number.POSITIVE_INFINITY);
  const chunks: StructChunk[] = [];
  let current = new ChunkBuilder();
  let remaining = structs.length;
  const place = (queue: ClientQueue, struct: UpdateStruct): void => {
    const size = sizeOf(struct);
    if (!current.fits(struct.id.client, size, maxBytes)) {
      chunks.push(current.runs);
      current = new ChunkBuilder();
    }
    current.add(struct.id.client, struct, size);
    queue.advance();
    remaining -= 1;
  };
  while (remaining > 0) {
    let isProgress = false;
    for (const queue of queues.values()) {
      let struct = queue.next;
      for (
        ;
        struct !== undefined && dependenciesOf(struct).every(isAvailable);
        struct = queue.next
      ) {
        place(queue, struct);
        isProgress = true;
      }
    }
    // A dependency nothing can satisfy (a cycle, which integrated content never has): place the
    // first waiting struct anyway, in update order, so the plan always ends.
    for (const queue of isProgress ? [] : queues.values()) {
      const struct = queue.next;
      if (struct === undefined) continue;
      place(queue, struct);
      break;
    }
  }
  if (current.runs.size > 0) chunks.push(current.runs);
  return chunks;
}
