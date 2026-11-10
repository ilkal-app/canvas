import { MEMORY_CATEGORIES, type MemoryCategory } from '../diagnostics/memory-ledger.js';
import { assertBufferByteLength, type GpuBufferDescriptor } from '../gpu/gpu-buffer.js';

import type {
  LeasedResource,
  ResourceHolder,
  ResourceLease,
  ResourceAdmissionOptions,
} from './resource-lease-types.js';

/** Accounting callbacks owned by the device reservation authority. */
export interface LeaseAccounting {
  /** Rechecks unrelated allocations before backend creation. */
  readonly canAllocate: () => boolean;
  /** Adds or removes actual owned bytes without double-counting the reservation. */
  readonly charge: (category: MemoryCategory, bytes: number) => void;
  /** Returns the reservation once every allocation has safely retired. */
  readonly release: () => void;
}

interface Allocation {
  readonly handle: LeasedResource;
  readonly category: MemoryCategory;
  readonly bytes: number;
  readonly owner: string;
  readonly holders: Set<ResourceHolder>;
  isRetiring: boolean;
}

let nextOwner = 0;

/** Buffer ownership and completion fences for a single admitted attempt. */
export class BufferResourceLease implements ResourceLease {
  private readonly allocations = new Map<LeasedResource, Allocation>();
  private readonly used = new Map<MemoryCategory, number>();
  private isReleased = false;
  private isReservationReturned = false;

  /**
   * Constructs a lease after its device authority reserves the complete plan.
   *
   * @param options - Backend and actual allocation ledger.
   * @param limits - Reserved category bytes in MEMORY_CATEGORIES order.
   * @param accounting - Device-scoped reservation ownership.
   */
  constructor(
    private readonly options: ResourceAdmissionOptions,
    private readonly limits: readonly number[],
    private readonly accounting: LeaseAccounting,
  ) {}

  /**
   * Allocates without consuming a second owner's share for shared buffers.
   *
   * @param category - Category charged.
   * @param descriptor - Exact backend buffer description.
   * @param holder - Initial owner.
   * @returns The opaque lease-owned allocation.
   * @throws {RangeError} When the lease is closed, exhausted, or the descriptor is invalid.
   */
  createBuffer(
    category: MemoryCategory,
    descriptor: GpuBufferDescriptor,
    holder: ResourceHolder,
  ): LeasedResource {
    assertHolder(holder);
    assertBufferByteLength(descriptor.byteLength);
    const bytes = descriptor.byteLength;
    const next = (this.used.get(category) ?? 0) + bytes;
    const limit = this.limits[MEMORY_CATEGORIES.indexOf(category)];
    if (
      this.isReleased ||
      limit === undefined ||
      !Number.isSafeInteger(next) ||
      next > limit ||
      !this.accounting.canAllocate()
    ) {
      throw new RangeError('Buffer does not fit this active resource lease.');
    }
    const handle = Object.freeze({ buffer: this.options.backend.createBuffer({ ...descriptor }) });
    const owner = `preview-live-lease:${String(++nextOwner)}`;
    this.allocations.set(handle, {
      handle,
      category,
      bytes,
      owner,
      holders: new Set([holder]),
      isRetiring: false,
    });
    this.used.set(category, next);
    this.accounting.charge(category, bytes);
    this.options.ledger.set(category, owner, bytes);
    return handle;
  }

  /**
   * Adds ownership to a still-live immutable allocation.
   *
   * @param resource - Handle from this lease.
   * @param holder - Owner to retain.
   * @throws {RangeError} When the handle is foreign, retiring or released.
   */
  hold(resource: LeasedResource, holder: ResourceHolder): void {
    assertHolder(holder);
    const allocation = this.allocations.get(resource);
    if (this.isReleased || allocation === undefined || allocation.isRetiring)
      throw new RangeError('Resource is not available for adoption.');
    allocation.holders.add(holder);
  }

  /**
   * Drops an owner idempotently; foreign handles never affect another lease.
   *
   * @param resource - Handle from this lease.
   * @param holder - Owner to remove.
   */
  drop(resource: LeasedResource, holder: ResourceHolder): void {
    assertHolder(holder);
    const allocation = this.allocations.get(resource);
    if (allocation === undefined) return;
    allocation.holders.delete(holder);
    this.retire(allocation);
  }

  /** Drops live holds while preserving visible preview resources. */
  rollbackLive(): void {
    for (const allocation of this.allocations.values()) this.drop(allocation.handle, 'live');
  }

  /** Ends ownership exactly once; the device reservation survives outstanding GPU work. */
  release(): void {
    if (this.isReleased) return;
    this.isReleased = true;
    for (const allocation of this.allocations.values()) {
      allocation.holders.clear();
      this.retire(allocation);
    }
    this.returnReservation();
  }

  private retire(allocation: Allocation): void {
    if (allocation.isRetiring || allocation.holders.size !== 0) return;
    allocation.isRetiring = true;
    // A failed fence provides no destruction proof. Keep both allocation and reservation
    // charged; never free memory still potentially referenced by submitted commands.
    void Promise.resolve()
      .then(() => this.options.gpuIdle())
      .then(() => {
        allocation.handle.buffer.destroy();
        this.options.ledger.delete(allocation.category, allocation.owner);
        this.accounting.charge(allocation.category, -allocation.bytes);
        this.used.set(
          allocation.category,
          (this.used.get(allocation.category) ?? 0) - allocation.bytes,
        );
        this.allocations.delete(allocation.handle);
        this.returnReservation();
      })
      .catch(() => undefined);
  }

  private returnReservation(): void {
    if (!this.isReleased || this.allocations.size !== 0 || this.isReservationReturned) return;
    this.isReservationReturned = true;
    this.accounting.release();
  }
}

function assertHolder(holder: unknown): asserts holder is ResourceHolder {
  if (holder !== 'preview' && holder !== 'live') throw new RangeError('Unknown resource holder.');
}
