// Acceptance, owner area "memory limits during preview/live overlap": while a preview is
// visible and live content is being built, every category and the total stay within the device
// budget including the live-only and transient reserves; a request that would exceed any of
// them is refused before anything is allocated. No limit here is new: every number is
// read from `budgetForDevice` or is the plan's own nominal cap.
import { describe, expect, it } from 'vitest';

import { MEMORY_CATEGORIES, type MemoryCategory } from '../diagnostics/memory-ledger.js';

import {
  grant,
  handoffPlan,
  ledgerState,
  startAdmission,
  vertexBuffer,
  wholeBudget,
  type AdmissionUnderTest,
} from './__fixtures__/counting-gpu.js';
import type { CategoryBytes, HandoffMemoryPlan } from './__fixtures__/viv-126-seams.js';
import { budgetForDevice, type DeviceMemoryBudget } from './device-budget.js';

const MIB = 1024 * 1024;
const DESKTOP = budgetForDevice({
  deviceMemoryGb: undefined,
  maxTextureSize: 8192,
  isMobile: false,
});
const SMALL_GPU = budgetForDevice({
  deviceMemoryGb: undefined,
  maxTextureSize: 4096,
  isMobile: false,
});
const MOBILE = budgetForDevice({ deviceMemoryGb: undefined, maxTextureSize: 8192, isMobile: true });
const TERMS = ['shared', 'previewOnly', 'liveOnlyReserve', 'transientReserve'] as const;

// Splits every category's cap over the four terms so each term is non-zero and they sum to it.
function planAtBudget(budget: DeviceMemoryBudget): HandoffMemoryPlan {
  const terms: Record<(typeof TERMS)[number], Partial<Record<MemoryCategory, number>>> = {
    shared: {},
    previewOnly: {},
    liveOnlyReserve: {},
    transientReserve: {},
  };
  for (const category of MEMORY_CATEGORIES) {
    const cap = budget.bytesByCategory[category];
    const quarter = Math.floor(cap / 4);
    terms.shared[category] = quarter;
    terms.previewOnly[category] = quarter;
    terms.liveOnlyReserve[category] = quarter;
    terms.transientReserve[category] = cap - 3 * quarter;
  }
  return handoffPlan(terms);
}

// Refused, with nothing allocated and the ledger untouched.
function expectRefused(under: AdmissionUnderTest, plan: HandoffMemoryPlan): void {
  const before = ledgerState(under.ledger);
  const result = under.admission.reserve(plan);
  expect(result.isAdmitted).toBe(false);
  expect(under.gpu.created).toEqual([]);
  expect(ledgerState(under.ledger)).toEqual(before);
}

// Refused (a result or a thrown error), with nothing allocated.
function expectRefusedOrThrown(under: AdmissionUnderTest, plan: HandoffMemoryPlan): void {
  let isAdmitted = false;
  try {
    isAdmitted = under.admission.reserve(plan).isAdmitted;
  } catch {
    isAdmitted = false;
  }
  expect(isAdmitted).toBe(false);
  expect(under.gpu.created).toEqual([]);
}

describe('the existing limits the plan keeps unchanged', () => {
  // Passes today; breaks if anyone raises or lowers a cap to make the handoff fit.
  it('keeps the nominal instance caps at 56, 28 and 14 MiB and the mobile total at 128 MiB', () => {
    expect(DESKTOP.bytesByCategory.instanceBuffers).toBe(56 * MIB);
    expect(SMALL_GPU.bytesByCategory.instanceBuffers).toBe(28 * MIB);
    expect(MOBILE.bytesByCategory.instanceBuffers).toBe(14 * MIB);
    expect(MOBILE.totalBytes).toBe(128 * MIB);
  });
});

describe('admission of a preview-plus-handoff plan', () => {
  it('admits a plan whose four terms sum exactly to every category cap', async () => {
    const under = await startAdmission(DESKTOP);
    expect(under.admission.reserve(planAtBudget(DESKTOP)).isAdmitted).toBe(true);
    expect(under.gpu.created).toEqual([]);
  });

  it('refuses one byte over in any term of any category, before allocating', async () => {
    for (const category of MEMORY_CATEGORIES) {
      for (const term of TERMS) {
        const under = await startAdmission(DESKTOP);
        const plan = planAtBudget(DESKTOP);
        const bumped: CategoryBytes = {
          ...plan[term],
          [category]: (plan[term][category] ?? 0) + 1,
        };
        expectRefused(under, { ...plan, [term]: bumped });
      }
    }
  });

  it('lends no category slack to another: one byte over in instance buffers alone is refused', async () => {
    const under = await startAdmission(DESKTOP);
    expectRefused(
      under,
      handoffPlan({
        previewOnly: { instanceBuffers: DESKTOP.bytesByCategory.instanceBuffers + 1 },
      }),
    );
  });

  it('counts a shared resource once: a whole category of shared bytes is isAdmitted', async () => {
    const under = await startAdmission(DESKTOP);
    expect(under.admission.reserve(handoffPlan({ shared: wholeBudget(DESKTOP) })).isAdmitted).toBe(
      true,
    );
  });

  it('counts a hidden live output and a replacement peak in the transient reserve', async () => {
    const textures = DESKTOP.bytesByCategory.textures;
    const instances = DESKTOP.bytesByCategory.instanceBuffers;
    const visible = handoffPlan({ previewOnly: { textures, instanceBuffers: instances } });
    // A hidden live output (textures) or a replacement buffer alive beside the old one
    // (instance buffers) of one byte cannot be isAdmitted beside a full category.
    expectRefused(await startAdmission(DESKTOP), {
      ...visible,
      transientReserve: { textures: 1 },
    });
    expectRefused(await startAdmission(DESKTOP), {
      ...visible,
      transientReserve: { instanceBuffers: 1 },
    });
  });

  it('checks required bytes outside the categories against the total, and refuses an unknown one', async () => {
    expect(
      (await startAdmission(DESKTOP)).admission.reserve(
        handoffPlan({ previewOnly: wholeBudget(DESKTOP), uncategorizedReserve: 0 }),
      ).isAdmitted,
    ).toBe(true);
    expectRefused(
      await startAdmission(DESKTOP),
      handoffPlan({ previewOnly: wholeBudget(DESKTOP), uncategorizedReserve: 1 }),
    );
    // An unknown required reserve refuses admission; it is never assumed to be zero.
    expectRefusedOrThrown(
      await startAdmission(DESKTOP),
      handoffPlan({ uncategorizedReserve: undefined }),
    );
  });

  it('refuses a term that is not a known non-negative whole number of bytes', async () => {
    for (const bytes of [Number.NaN, -4, 1.5, Number.POSITIVE_INFINITY]) {
      expectRefusedOrThrown(
        await startAdmission(DESKTOP),
        handoffPlan({ liveOnlyReserve: { meshes: bytes } }),
      );
    }
  });
});

describe('device-derived caps', () => {
  const cases: readonly (readonly [string, DeviceMemoryBudget])[] = [
    ['small GPU (28 MiB instance cap)', SMALL_GPU],
    ['mobile (14 MiB instance cap)', MOBILE],
    [
      'desktop reporting 1 GiB of memory',
      budgetForDevice({ deviceMemoryGb: 1, maxTextureSize: 8192, isMobile: false }),
    ],
    [
      'desktop reporting 2 GiB of memory',
      budgetForDevice({ deviceMemoryGb: 2, maxTextureSize: 8192, isMobile: false }),
    ],
  ];
  for (const [name, budget] of cases) {
    it(`honours the ${name}: at the cap admits, one byte over refuses`, async () => {
      const cap = budget.bytesByCategory.instanceBuffers;
      expect(cap).toBeLessThan(DESKTOP.bytesByCategory.instanceBuffers);
      const split = { previewOnly: { instanceBuffers: cap - 1024 } };
      expect(
        (await startAdmission(budget)).admission.reserve(
          handoffPlan({ ...split, liveOnlyReserve: { instanceBuffers: 1024 } }),
        ).isAdmitted,
      ).toBe(true);
      expectRefused(
        await startAdmission(budget),
        handoffPlan({ ...split, liveOnlyReserve: { instanceBuffers: 1025 } }),
      );
    });
  }
});

describe('allocation against a lease', () => {
  it('refuses a buffer the reservation cannot hold before the backend allocates it', async () => {
    const under = await startAdmission(DESKTOP);
    const lease = grant(under.admission, handoffPlan({ previewOnly: { instanceBuffers: 1024 } }));
    const before = ledgerState(under.ledger);
    expect(() => lease.createBuffer('meshes', vertexBuffer('unreserved', 4), 'live')).toThrow();
    expect(() =>
      lease.createBuffer('instanceBuffers', vertexBuffer('over', 1028), 'preview'),
    ).toThrow();
    expect(under.gpu.created).toEqual([]);
    expect(ledgerState(under.ledger)).toEqual(before);
    lease.createBuffer('instanceBuffers', vertexBuffer('fits', 1024), 'preview');
    expect(under.gpu.created).toEqual(['fits']);
    expect(under.ledger.bytesOf('instanceBuffers')).toBe(1024);
  });

  it('charges a replacement beside the buffer it replaces until the old one is gone', async () => {
    const under = await startAdmission(DESKTOP);
    const size = MIB;
    const lease = grant(
      under.admission,
      handoffPlan({
        previewOnly: { instanceBuffers: size },
        transientReserve: { instanceBuffers: size - 4 },
      }),
    );
    const old = lease.createBuffer('instanceBuffers', vertexBuffer('old', size), 'preview');
    // Both alive at once would need 2 MiB; the reservation holds 2 MiB - 4 bytes.
    expect(() =>
      lease.createBuffer('instanceBuffers', vertexBuffer('replacement', size), 'live'),
    ).toThrow();
    expect(under.gpu.created).toEqual(['old']);
    lease.drop(old, 'preview');
    await under.gpu.settle();
    lease.createBuffer('instanceBuffers', vertexBuffer('replacement', size), 'live');
    expect(under.gpu.alive()).toEqual(['replacement']);
    expect(under.ledger.bytesOf('instanceBuffers')).toBe(size);
  });

  it('keeps a dropped buffer charged until submitted GPU work completes', async () => {
    const under = await startAdmission(DESKTOP);
    const lease = grant(under.admission, handoffPlan({ previewOnly: { instanceBuffers: MIB } }));
    const page = lease.createBuffer('instanceBuffers', vertexBuffer('page', MIB), 'preview');
    under.gpu.beginWork();
    lease.drop(page, 'preview');
    await Promise.resolve();
    expect(under.gpu.destroyed).toEqual([]);
    expect(under.ledger.bytesOf('instanceBuffers')).toBe(MIB);
    expect(() =>
      lease.createBuffer('instanceBuffers', vertexBuffer('next', MIB), 'live'),
    ).toThrow();
    await under.gpu.settle();
    expect(under.gpu.destroyed).toEqual(['page']);
    expect(under.ledger.bytesOf('instanceBuffers')).toBe(0);
    lease.createBuffer('instanceBuffers', vertexBuffer('next', MIB), 'live');
    expect(under.gpu.alive()).toEqual(['next']);
  });

  it('counts an overlapping attempt’s outstanding reservation until that attempt releases', async () => {
    const under = await startAdmission(DESKTOP);
    const first = grant(
      under.admission,
      handoffPlan({ previewOnly: { instanceBuffers: DESKTOP.bytesByCategory.instanceBuffers } }),
    );
    const second = handoffPlan({
      attempt: 'attempt-2',
      generation: 2,
      liveOnlyReserve: { instanceBuffers: 4 },
    });
    expect(under.admission.reserve(second).isAdmitted).toBe(false);
    first.release();
    await under.gpu.settle();
    expect(under.admission.reserve(second).isAdmitted).toBe(true);
  });
});
