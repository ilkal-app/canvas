import type { MemoryCategory, MemoryLedger } from '../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../gpu/gpu-backend.js';
import type { GpuBuffer, GpuBufferDescriptor } from '../gpu/gpu-buffer.js';

import type { DeviceMemoryBudget } from './device-budget.js';

/** Known byte counts by category; omitted categories reserve zero bytes. */
export type CategoryBytes = Partial<Readonly<Record<MemoryCategory, number>>>;

/** Maximum simultaneous GPU ownership for one preview and its pending live handoff. */
export interface HandoffMemoryPlan {
  /** Startup identity, distinct from a buffer's diagnostic label. */
  readonly attempt: string;
  /** Source generation of this attempt. */
  readonly generation: number;
  /** Immutable resources used by both holders, counted once. */
  readonly shared: CategoryBytes;
  /** Resources owned only by the preview. */
  readonly previewOnly: CategoryBytes;
  /** Maximum additional live resources. */
  readonly liveOnlyReserve: CategoryBytes;
  /** Simultaneous replacement, upload and hidden-output resources. */
  readonly transientReserve: CategoryBytes;
  /** Required non-category bytes; unknown refuses admission. */
  readonly uncategorizedReserve: number | undefined;
}

/** One of the two independent owners of a leased allocation. */
export type ResourceHolder = 'preview' | 'live';

/** Handle owned by the lease; callers must not destroy its buffer themselves. */
export interface LeasedResource {
  /** Backend buffer; immutable while shared with a visible preview. */
  readonly buffer: GpuBuffer;
}

/** GPU allocation lifetime tied to one reservation, independent of other attempts. */
export interface ResourceLease {
  /** Allocates within the reserved category; backend failure charges no actual bytes. */
  createBuffer(
    category: MemoryCategory,
    descriptor: GpuBufferDescriptor,
    holder: ResourceHolder,
  ): LeasedResource;
  /** Adds an owner without copying or charging twice. */
  hold(resource: LeasedResource, holder: ResourceHolder): void;
  /** Drops one owner; final destruction waits for submitted GPU work. */
  drop(resource: LeasedResource, holder: ResourceHolder): void;
  /** Drops pending live ownership, preserving every preview hold. */
  rollbackLive(): void;
  /** Ends the attempt; reservations survive until pending destruction completes. */
  release(): void;
}

/** Reservation result, before any backend allocation. */
export type Admission =
  | { readonly isAdmitted: true; readonly lease: ResourceLease }
  | { readonly isAdmitted: false; readonly reason: string };

/** Device-scoped reservation authority; one instance must own a backend's leases. */
export interface ResourceAdmission {
  /** Checks the complete plan, existing allocations and outstanding reservations. */
  reserve(plan: HandoffMemoryPlan): Admission;
}

/** Dependencies of the reservation authority, owned on the backend thread. */
export interface ResourceAdmissionOptions {
  /** Unchanged device-derived caps. */
  readonly budget: DeviceMemoryBudget;
  /** Actual allocation ledger, including unrelated owners. */
  readonly ledger: MemoryLedger;
  /** Backend used for every leased allocation. */
  readonly backend: GpuBackend;
  /** Successful completion fence for all previously submitted GPU commands. */
  readonly gpuIdle: () => Promise<void>;
}
