import { expect, it, vi } from 'vitest';

import { MemoryLedger } from '../diagnostics/memory-ledger.js';

import {
  createCountingGpu,
  grant,
  handoffPlan,
  vertexBuffer,
} from './__fixtures__/counting-gpu.js';
import { budgetForDevice } from './device-budget.js';
import { createResourceAdmission } from './resource-lease.js';

const budget = budgetForDevice({
  deviceMemoryGb: undefined,
  maxTextureSize: 8192,
  isMobile: false,
});
const cap = budget.bytesByCategory.instanceBuffers;

function setup(gpuIdle?: () => Promise<void>) {
  const gpu = createCountingGpu();
  const ledger = new MemoryLedger();
  const admission = createResourceAdmission({
    budget,
    ledger,
    backend: gpu.backend,
    gpuIdle: gpuIdle ?? gpu.gpuIdle,
  });
  return { gpu, ledger, admission };
}

it('rechecks other owners growing after reservation before allocating a live page', async () => {
  const { gpu, ledger, admission } = setup();
  const lease = grant(admission, handoffPlan({ liveOnlyReserve: { instanceBuffers: cap } }));
  ledger.set('instanceBuffers', 'ordinary-scene', 4);
  expect(() => lease.createBuffer('instanceBuffers', vertexBuffer('live', 4), 'live')).toThrow();
  expect(gpu.created).toEqual([]);
  expect(ledger.bytesOf('instanceBuffers')).toBe(4);
  ledger.delete('instanceBuffers', 'ordinary-scene');
  lease.createBuffer('instanceBuffers', vertexBuffer('live', 4), 'live');
  lease.release();
  await gpu.settle();
  expect(ledger.totalBytes).toBe(0);
});

it('counts existing allocations beside another attempt without charging leased pages twice', async () => {
  const { gpu, ledger, admission } = setup();
  ledger.set('instanceBuffers', 'ordinary-scene', 4);
  const first = grant(admission, handoffPlan({ shared: { instanceBuffers: cap - 8 } }));
  const page = first.createBuffer('instanceBuffers', vertexBuffer('shared', 4), 'preview');
  first.hold(page, 'live');
  const second = grant(
    admission,
    handoffPlan({ attempt: 'second', liveOnlyReserve: { instanceBuffers: 4 } }),
  );
  second.createBuffer('instanceBuffers', vertexBuffer('second', 4), 'live');
  expect(
    admission.reserve(handoffPlan({ attempt: 'third', liveOnlyReserve: { instanceBuffers: 4 } }))
      .isAdmitted,
  ).toBe(false);
  first.release();
  second.release();
  await gpu.settle();
  expect(ledger.ownersOf('instanceBuffers')).toEqual(new Map([['ordinary-scene', 4]]));
});

it('retains the entire released reservation until its last submitted page completes', async () => {
  const { gpu, ledger, admission } = setup();
  const plan = handoffPlan({ previewOnly: { instanceBuffers: cap } });
  const lease = grant(admission, plan);
  lease.createBuffer('instanceBuffers', vertexBuffer('preview', 4), 'preview');
  gpu.beginWork();
  lease.release();
  await Promise.resolve();
  expect(admission.reserve(plan).isAdmitted).toBe(false);
  expect(ledger.totalBytes).toBe(4);
  await gpu.settle();
  const next = grant(admission, plan);
  expect(ledger.totalBytes).toBe(0);
  expect(gpu.destroyed).toEqual(['preview']);
  next.release();
});

for (const mode of ['reject', 'throw'] as const) {
  it(`keeps allocation and reservation when the completion fence fails by ${mode}`, async () => {
    const gpuIdle = vi.fn((): Promise<void> => {
      if (mode === 'throw') throw new Error('Device completion is unavailable');
      return Promise.reject(new Error('Device completion is unavailable'));
    });
    const { gpu, ledger, admission } = setup(gpuIdle);
    const plan = handoffPlan({ previewOnly: { instanceBuffers: cap } });
    const lease = grant(admission, plan);
    lease.createBuffer('instanceBuffers', vertexBuffer('preview', 4), 'preview');
    lease.release();
    await gpu.settle();
    expect(gpuIdle).toHaveBeenCalledOnce();
    expect(gpu.destroyed).toEqual([]);
    expect(ledger.totalBytes).toBe(4);
    expect(admission.reserve(plan).isAdmitted).toBe(false);
    lease.release();
    lease.rollbackLive();
    await gpu.settle();
    expect(gpuIdle).toHaveBeenCalledOnce();
    expect(ledger.totalBytes).toBe(4);
  });
}

it('ignores duplicate live ownership and delayed drops after successful retirement', async () => {
  const { gpu, ledger, admission } = setup();
  const lease = grant(admission, handoffPlan({ shared: { instanceBuffers: 4 } }));
  const page = lease.createBuffer('instanceBuffers', vertexBuffer('page', 4), 'preview');
  lease.hold(page, 'live');
  lease.hold(page, 'live');
  lease.rollbackLive();
  lease.rollbackLive();
  await gpu.settle();
  expect(gpu.alive()).toEqual(['page']);
  expect(ledger.totalBytes).toBe(4);
  lease.drop(page, 'preview');
  await gpu.settle();
  lease.drop(page, 'preview');
  lease.drop(page, 'live');
  lease.release();
  expect(gpu.destroyCount('page')).toBe(1);
  expect(ledger.totalBytes).toBe(0);
});

it('releases an empty allocation plan without creating a completion fence', () => {
  const fence = vi.fn(() => Promise.resolve());
  const { gpu, admission } = setup(fence);
  const empty = grant(admission, handoffPlan());
  empty.rollbackLive();
  empty.release();
  empty.release();
  const reserved = grant(admission, handoffPlan({ previewOnly: { instanceBuffers: cap } }));
  reserved.release();
  expect(fence).not.toHaveBeenCalled();
  expect(gpu.created).toEqual([]);
});

it('does not revive a page when a delayed live adoption arrives during retirement', async () => {
  const { gpu, ledger, admission } = setup();
  const lease = grant(admission, handoffPlan({ shared: { instanceBuffers: 4 } }));
  const page = lease.createBuffer('instanceBuffers', vertexBuffer('page', 4), 'preview');
  gpu.beginWork();
  lease.drop(page, 'preview');
  expect(() => {
    lease.hold(page, 'live');
  }).toThrow('Resource is not available for adoption.');
  expect(ledger.totalBytes).toBe(4);
  await gpu.settle();
  expect(() => {
    lease.hold(page, 'live');
  }).toThrow('Resource is not available for adoption.');
  expect(gpu.destroyCount('page')).toBe(1);
  expect(ledger.totalBytes).toBe(0);
  lease.release();
});

it('refuses a late adoption callback after the attempt released while GPU work remains', async () => {
  const { gpu, ledger, admission } = setup();
  const lease = grant(admission, handoffPlan({ shared: { instanceBuffers: 4 } }));
  const page = lease.createBuffer('instanceBuffers', vertexBuffer('page', 4), 'preview');
  gpu.beginWork();
  lease.release();
  expect(() => {
    lease.hold(page, 'live');
  }).toThrow('Resource is not available for adoption.');
  await gpu.settle();
  expect(gpu.destroyCount('page')).toBe(1);
  expect(ledger.totalBytes).toBe(0);
});
