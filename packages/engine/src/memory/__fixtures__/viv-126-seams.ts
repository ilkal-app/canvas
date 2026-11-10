// Acceptance seams for the bounded preview/live resource plan.
// The plan names these seams as proposals, not existing exports. Each is resolved here, by its
// planned module and export name, so the acceptance tests typecheck before the code exists and
// fail with `seam not implemented: <module>#<name>` until it does. This file is the one place
// a seam's module or export name may be adjusted; the tests' bodies and assertions are not.

import type { MemoryCategory, MemoryLedger } from '../../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBuffer, GpuBufferDescriptor } from '../../gpu/gpu-buffer.js';
import type { DeviceMemoryBudget } from '../device-budget.js';

/** Bytes per GPU category; a category left out holds no bytes in that term. */
export type CategoryBytes = Partial<Readonly<Record<MemoryCategory, number>>>;

/**
 * One attempt's complete preview-plus-handoff plan: the four terms of the plan's per-category
 * inequality `shared[c] + previewOnly[c] + liveOnlyReserve[c] + transientReserve[c] <=
 * budget[c]` (term names from the plan), plus the required bytes no category represents, which
 * the total-device check includes. `undefined` there is an unknown reserve, which the plan says
 * refuses admission rather than counting as zero (`uncategorizedReserve`: name proposed by
 * Claude).
 */
export interface HandoffMemoryPlan {
  /** The startup attempt this lease belongs to. */
  readonly attempt: string;
  /** The attempt's source generation; a later attempt has a larger one. */
  readonly generation: number;
  /** Immutable resources held by preview and live together, counted once. */
  readonly shared: CategoryBytes;
  /** Resources only the visible preview draws. */
  readonly previewOnly: CategoryBytes;
  /** Pages reserved for changed and new live records. */
  readonly liveOnlyReserve: CategoryBytes;
  /** Replacement buffers while the old one is alive, staging, alignment, hidden live output. */
  readonly transientReserve: CategoryBytes;
  /** Required bytes outside the categories, checked against the total; `undefined` = unknown. */
  readonly uncategorizedReserve: number | undefined;
}

/** Who holds a leased resource: the visible preview, the pending live scene, or both. */
export type ResourceHolder = 'preview' | 'live';

/** An opaque handle to one resource a lease allocated. */
export interface LeasedResource {
  /** The GPU buffer drawn from; its `destroy` is the lease's to call, not the caller's. */
  readonly buffer: GpuBuffer;
}

/** The outcome of a reservation: a lease, or a refusal before anything is allocated. */
export type Admission =
  | { readonly isAdmitted: true; readonly lease: ResourceLease }
  | { readonly isAdmitted: false; readonly reason: string };

/**
 * The engine-owned lease for one attempt and generation (plan: "A reservation is an
 * engine-owned lease"). Every method name here is proposed by Claude.
 */
export interface ResourceLease {
  /**
   * Allocates a buffer charged to this lease and the ledger; refuses (throws) before calling the
   * backend when the lease's reservation for `category` cannot hold it beside everything the
   * lease still holds, and rethrows a backend failure after charging nothing.
   */
  createBuffer(
    category: MemoryCategory,
    descriptor: GpuBufferDescriptor,
    holder: ResourceHolder,
  ): LeasedResource;
  /** Adds a holder to an existing resource (adoption): no bytes copied, nothing allocated. */
  hold(resource: LeasedResource, holder: ResourceHolder): void;
  /** Removes a holder; a resource with no holder is destroyed once GPU work allows. */
  drop(resource: LeasedResource, holder: ResourceHolder): void;
  /** Aborts the pending live plan: drops every live hold, never a preview hold. */
  rollbackLive(): void;
  /** Ends the attempt: drops every hold and returns the reservation. Idempotent. */
  release(): void;
}

/** What the admission needs from the engine. */
export interface ResourceAdmissionOptions {
  /** The actual device-derived budget, including reductions from reported device memory. */
  readonly budget: DeviceMemoryBudget;
  /** Where actual allocations are reported. */
  readonly ledger: MemoryLedger;
  /** The backend that allocates and destroys. */
  readonly backend: GpuBackend;
  /**
   * Resolves once every GPU command submitted so far has completed: the point after which a
   * dropped resource may be destroyed and its charge returned (plan: "retain charges until
   * backend completion makes destruction safe"). Name proposed by Claude.
   */
  readonly gpuIdle: () => Promise<void>;
}

/** Checked reservations of preview-plus-handoff plans against one device budget. */
export interface ResourceAdmission {
  /** Reserves a plan's maximum concurrent bytes before any GPU allocation, or refuses it. */
  reserve(plan: HandoffMemoryPlan): Admission;
}

/** Creates the admission for one backend (module and name proposed by Claude). */
export type CreateResourceAdmission = (options: ResourceAdmissionOptions) => ResourceAdmission;

/** Where the plan's lease/admission seam is expected: near `memory/device-budget.ts`. */
export const RESOURCE_LEASE_MODULE = 'packages/engine/src/memory/resource-lease.ts';
const RESOURCE_LEASE_SPECIFIER = '../resource-lease.js';
const CREATE_RESOURCE_ADMISSION = 'createResourceAdmission';

/**
 * Loads `createResourceAdmission` from its planned module.
 *
 * @returns The factory.
 * @throws {Error} `seam not implemented: …` when the module or the export is absent.
 */
export async function loadCreateResourceAdmission(): Promise<CreateResourceAdmission> {
  const exports = await importSeamModule(RESOURCE_LEASE_SPECIFIER);
  const factory = exports?.[CREATE_RESOURCE_ADMISSION];
  if (typeof factory !== 'function') {
    throw new Error(`seam not implemented: ${RESOURCE_LEASE_MODULE}#${CREATE_RESOURCE_ADMISSION}`);
  }
  return factory as CreateResourceAdmission;
}

/**
 * Imports a planned module relative to this file, telling an absent module apart from a broken
 * one (a broken module's own error is rethrown).
 *
 * @param specifier - Relative to this fixture.
 * @returns Its exports, or `undefined` when the module does not exist.
 */
async function importSeamModule(
  specifier: string,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as Readonly<Record<string, unknown>>;
  } catch (error) {
    if (/Cannot find module|Failed to load url|does not exist/.test(String(error))) {
      return undefined;
    }
    throw error;
  }
}
