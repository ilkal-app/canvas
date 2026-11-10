// A counting, failing GPU backend for the resource acceptance tests: it records every
// buffer created and every destroy call by label (so a double free shows as two entries), can
// fail the next allocation like a driver out of memory, and holds "submitted GPU work" open
// until the test completes it.
import { MEMORY_CATEGORIES, MemoryLedger } from '../../diagnostics/memory-ledger.js';
import type { GpuBackend } from '../../gpu/gpu-backend.js';
import type { GpuBuffer, GpuBufferDescriptor } from '../../gpu/gpu-buffer.js';
import type { DeviceMemoryBudget } from '../device-budget.js';

import {
  loadCreateResourceAdmission,
  type CategoryBytes,
  type HandoffMemoryPlan,
  type ResourceAdmission,
  type ResourceLease,
} from './viv-126-seams.js';

/** One admission under test, its counting backend and the ledger it reports to. */
export interface AdmissionUnderTest {
  readonly admission: ResourceAdmission;
  readonly gpu: CountingGpu;
  readonly ledger: MemoryLedger;
}

/**
 * Builds the proposed admission over a counting backend and a fresh ledger.
 *
 * @param budget - The device budget, from `budgetForDevice`.
 * @returns The admission and what observes it.
 * @throws {Error} `seam not implemented: …` until the seam exists.
 */
export async function startAdmission(budget: DeviceMemoryBudget): Promise<AdmissionUnderTest> {
  const createResourceAdmission = await loadCreateResourceAdmission();
  const gpu = createCountingGpu();
  const ledger = new MemoryLedger();
  const admission = createResourceAdmission({
    budget,
    ledger,
    backend: gpu.backend,
    gpuIdle: gpu.gpuIdle,
  });
  return { admission, gpu, ledger };
}

/**
 * Reserves a plan that the test expects to be isAdmitted.
 *
 * @param admission - The admission.
 * @param plan - The plan.
 * @returns Its lease.
 * @throws {Error} When the plan is refused.
 */
export function grant(admission: ResourceAdmission, plan: HandoffMemoryPlan): ResourceLease {
  const result = admission.reserve(plan);
  if (!result.isAdmitted) throw new Error(`expected admission, refused: ${result.reason}`);
  return result.lease;
}

/** The counting backend and its observations. */
export interface CountingGpu {
  /** Pass to the admission. */
  readonly backend: GpuBackend;
  /** Pass to the admission as `gpuIdle`. */
  readonly gpuIdle: () => Promise<void>;
  /** Labels of every buffer the backend created, in order. */
  readonly created: string[];
  /** Labels of every destroy call, in order; a label twice is a double free. */
  readonly destroyed: string[];
  /** Makes the next `createBuffer` throw, as a driver allocation failure does. */
  failNextCreate(): void;
  /** Marks GPU work as in flight: `gpuIdle` stays pending until {@link CountingGpu.settle}. */
  beginWork(): void;
  /** Completes all in-flight work and lets every promise chain it started run. */
  settle(): Promise<void>;
  /** Labels created and not destroyed. */
  alive(): string[];
  /** How many times a label was destroyed. */
  destroyCount(label: string): number;
}

/**
 * Creates the backend. Only buffers are supported; anything else throws, so an admission that
 * allocates outside the test's view fails loudly.
 *
 * @returns The backend and its logs.
 */
export function createCountingGpu(): CountingGpu {
  const created: string[] = [];
  const destroyed: string[] = [];
  let shouldFail = false;
  let isBusy = false;
  let waiters: (() => void)[] = [];
  const backend = countingBackend((descriptor) => {
    if (shouldFail) {
      shouldFail = false;
      throw new Error('GPU out of memory (injected)');
    }
    const label = descriptor.label ?? `buffer-${String(created.length)}`;
    created.push(label);
    return {
      usage: descriptor.usage,
      byteLength: descriptor.byteLength,
      destroy: () => {
        destroyed.push(label);
      },
    };
  });
  const gpuIdle = (): Promise<void> =>
    isBusy ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve();
  return {
    backend,
    gpuIdle,
    created,
    destroyed,
    failNextCreate: () => {
      shouldFail = true;
    },
    beginWork: () => {
      isBusy = true;
    },
    settle: async () => {
      // Two rounds: an admission may ask for idleness again after the first completion.
      for (let round = 0; round < 2; round += 1) {
        isBusy = false;
        const ready = waiters;
        waiters = [];
        for (const resolve of ready) resolve();
        // A macrotask boundary runs every microtask chain the completions started.
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      }
    },
    alive: () => {
      const remaining = [...created];
      for (const label of destroyed) {
        const index = remaining.indexOf(label);
        if (index >= 0) remaining.splice(index, 1);
      }
      return remaining;
    },
    destroyCount: (label) => destroyed.filter((entry) => entry === label).length,
  };
}

/**
 * A backend whose only allocation is `createBuffer`; everything else that allocates throws.
 *
 * @param createBuffer - Allocates (or fails) one buffer.
 * @returns The backend.
 */
function countingBackend(createBuffer: (descriptor: GpuBufferDescriptor) => GpuBuffer): GpuBackend {
  const unsupported = (name: string): never => {
    throw new Error(`The counting backend does not support ${name}.`);
  };
  return {
    capabilities: {
      backendName: 'webgl2',
      maxTextureSize: 8192,
      hasTimestampQuery: false,
      sampleCount: 1,
      adapterName: 'counting',
      isSoftwareAdapter: false,
    },
    createBuffer,
    writeBuffer: () => undefined,
    createTexture: () => unsupported('createTexture'),
    writeTexture: () => unsupported('writeTexture'),
    createSampler: () => unsupported('createSampler'),
    createRenderPipeline: () => unsupported('createRenderPipeline'),
    createBindGroup: () => unsupported('createBindGroup'),
    createRenderTarget: () => unsupported('createRenderTarget'),
    beginRenderPass: () => unsupported('beginRenderPass'),
    submit: () => undefined,
    readPixels: () => unsupported('readPixels'),
    collectPassTimings: () => Promise.resolve([]),
    onDeviceLost: () => () => undefined,
    destroy: () => undefined,
  };
}

/** A ledger's complete observable state: every category's total and owners. */
export interface LedgerState {
  readonly totals: readonly number[];
  readonly owners: Readonly<Record<string, readonly (readonly [string, number])[]>>;
}

/**
 * Copies a ledger's state, for "returns to its pre-attempt state" comparisons.
 *
 * @param ledger - The ledger.
 * @returns Totals and owners, by category.
 */
export function ledgerState(ledger: MemoryLedger): LedgerState {
  const totals: number[] = [];
  ledger.copyTotalsInto(totals);
  const owners: Record<string, (readonly [string, number])[]> = {};
  for (const category of MEMORY_CATEGORIES) {
    owners[category] = [...ledger.ownersOf(category).entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }
  return { totals, owners };
}

/**
 * A plan for one attempt; every term empty unless given.
 *
 * @param terms - The terms to set.
 * @returns The plan.
 */
export function handoffPlan(terms: Partial<HandoffMemoryPlan> = {}): HandoffMemoryPlan {
  return {
    attempt: 'attempt-1',
    generation: 1,
    shared: {},
    previewOnly: {},
    liveOnlyReserve: {},
    transientReserve: {},
    uncategorizedReserve: 0,
    ...terms,
  };
}

/**
 * Every category's whole budget.
 *
 * @param budget - The device budget.
 * @returns Bytes per category equal to the caps.
 */
export function wholeBudget(budget: DeviceMemoryBudget): CategoryBytes {
  return { ...budget.bytesByCategory };
}

/**
 * A buffer descriptor with a label the counting backend logs.
 *
 * @param label - Unique within a test.
 * @param byteLength - A positive multiple of 4.
 * @returns The descriptor.
 */
export function vertexBuffer(label: string, byteLength: number): GpuBufferDescriptor {
  return { usage: 'vertex', byteLength, label };
}
