// Acceptance, owner area "failure cleanup": a failed live allocation rolls back only what
// the pending live plan took, never what the visible preview draws; the ledger returns to its
// state before the attempt; the fallback releases the preview's memory exactly once; and a late
// release or GPU completion of an older attempt never frees a newer attempt's allocation.

import { expect, it } from 'vitest';

import {
  grant,
  handoffPlan,
  ledgerState,
  startAdmission,
  vertexBuffer,
  type AdmissionUnderTest,
} from './__fixtures__/counting-gpu.js';
import type { LeasedResource, ResourceLease } from './__fixtures__/viv-126-seams.js';
import { budgetForDevice } from './device-budget.js';

const DESKTOP = budgetForDevice({
  deviceMemoryGb: undefined,
  maxTextureSize: 8192,
  isMobile: false,
});
const PAGE = 4096;

interface VisiblePreview {
  readonly under: AdmissionUnderTest;
  readonly lease: ResourceLease;
  readonly shared: LeasedResource;
  // The ledger before this attempt reserved anything.
  readonly beforeAttempt: ReturnType<typeof ledgerState>;
  // The ledger with the preview drawn and no live work started.
  readonly beforeLive: ReturnType<typeof ledgerState>;
}

// An attempt whose preview is visible: one shared page, one preview-only page and an atlas page,

// with an unrelated owner (the camera uniforms) already in the ledger.
async function visiblePreview(): Promise<VisiblePreview> {
  const under = await startAdmission(DESKTOP);
  under.ledger.set('uniforms', 'camera', 256);
  const beforeAttempt = ledgerState(under.ledger);
  const lease = grant(
    under.admission,
    handoffPlan({
      shared: { instanceBuffers: PAGE },
      previewOnly: { instanceBuffers: PAGE, atlases: 2 * PAGE },
      liveOnlyReserve: { instanceBuffers: 2 * PAGE },
    }),
  );
  const shared = lease.createBuffer('instanceBuffers', vertexBuffer('shared', PAGE), 'preview');
  lease.createBuffer('instanceBuffers', vertexBuffer('preview-only', PAGE), 'preview');
  lease.createBuffer('atlases', vertexBuffer('atlas-page', 2 * PAGE), 'preview');
  return { under, lease, shared, beforeAttempt, beforeLive: ledgerState(under.ledger) };
}

const PREVIEW_LABELS = ['shared', 'preview-only', 'atlas-page'];

it('rolls back a live build whose allocation the driver fails, keeping every preview resource', async () => {
  const { under, lease, shared, beforeLive } = await visiblePreview();
  lease.hold(shared, 'live');
  lease.createBuffer('instanceBuffers', vertexBuffer('live-1', PAGE), 'live');
  under.gpu.failNextCreate();
  expect(() =>
    lease.createBuffer('instanceBuffers', vertexBuffer('live-2', PAGE), 'live'),
  ).toThrow();
  lease.rollbackLive();
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['live-1']);
  expect(under.gpu.alive()).toEqual(PREVIEW_LABELS);
  expect(ledgerState(under.ledger)).toEqual(beforeLive);
});

it('rolls back a live build that outgrows its reservation, before the oversized allocation', async () => {
  const { under, lease, shared, beforeLive } = await visiblePreview();
  lease.hold(shared, 'live');
  lease.createBuffer('instanceBuffers', vertexBuffer('live-1', PAGE), 'live');
  expect(() =>
    lease.createBuffer('instanceBuffers', vertexBuffer('live-growth', 2 * PAGE), 'live'),
  ).toThrow();
  expect(under.gpu.created).not.toContain('live-growth');
  lease.rollbackLive();
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['live-1']);
  expect(under.gpu.alive()).toEqual(PREVIEW_LABELS);
  expect(ledgerState(under.ledger)).toEqual(beforeLive);
});

it('reclaims the preview exactly once on fallback and returns the ledger to its pre-attempt state', async () => {
  const { under, lease, shared, beforeAttempt } = await visiblePreview();
  lease.hold(shared, 'live');
  lease.createBuffer('instanceBuffers', vertexBuffer('live-1', PAGE), 'live');
  lease.rollbackLive();
  lease.release();
  lease.release();
  await under.gpu.settle();
  expect([...under.gpu.destroyed].sort()).toEqual([
    'atlas-page',
    'live-1',
    'preview-only',
    'shared',
  ]);
  expect(under.gpu.alive()).toEqual([]);
  // The unrelated camera uniforms survive: the attempt frees only what it owns.
  expect(ledgerState(under.ledger)).toEqual(beforeAttempt);
});

it('cannot be revived after release: a late allocation is refused before the backend', async () => {
  const { under, lease } = await visiblePreview();
  lease.release();
  await under.gpu.settle();
  const created = under.gpu.created.length;
  expect(() => lease.createBuffer('instanceBuffers', vertexBuffer('late', PAGE), 'live')).toThrow();
  expect(under.gpu.created).toHaveLength(created);
});

it('fails a new attempt without touching the older attempt the screen still shows', async () => {
  const { under, lease: visible, beforeLive } = await visiblePreview();
  const next = grant(
    under.admission,
    handoffPlan({
      attempt: 'attempt-2',
      generation: 2,
      liveOnlyReserve: { instanceBuffers: 2 * PAGE },
    }),
  );
  next.createBuffer('instanceBuffers', vertexBuffer('next-1', PAGE), 'live');
  under.gpu.failNextCreate();
  expect(() =>
    next.createBuffer('instanceBuffers', vertexBuffer('next-2', PAGE), 'live'),
  ).toThrow();
  next.release();
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['next-1']);
  expect(under.gpu.alive()).toEqual(PREVIEW_LABELS);
  expect(ledgerState(under.ledger)).toEqual(beforeLive);
  visible.release();
});

it('ignores a repeated or late release of an older generation once a newer one allocates', async () => {
  const under = await startAdmission(DESKTOP);
  const older = grant(under.admission, handoffPlan({ previewOnly: { instanceBuffers: PAGE } }));
  older.createBuffer('instanceBuffers', vertexBuffer('older-page', PAGE), 'preview');
  const newer = grant(
    under.admission,
    handoffPlan({ attempt: 'attempt-2', generation: 2, previewOnly: { instanceBuffers: PAGE } }),
  );
  newer.createBuffer('instanceBuffers', vertexBuffer('newer-page', PAGE), 'preview');
  older.release();
  older.rollbackLive();
  older.release();
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['older-page']);
  expect(under.gpu.alive()).toEqual(['newer-page']);
  expect(under.ledger.bytesOf('instanceBuffers')).toBe(PAGE);
  newer.release();
  await under.gpu.settle();
  expect(under.gpu.destroyCount('newer-page')).toBe(1);
  expect(under.ledger.bytesOf('instanceBuffers')).toBe(0);
});

it('lets a late GPU completion free only the older generation’s allocation', async () => {
  const under = await startAdmission(DESKTOP);
  const older = grant(under.admission, handoffPlan({ previewOnly: { instanceBuffers: PAGE } }));
  older.createBuffer('instanceBuffers', vertexBuffer('older-page', PAGE), 'preview');
  under.gpu.beginWork();
  older.release();
  const newer = grant(
    under.admission,
    handoffPlan({ attempt: 'attempt-2', generation: 2, previewOnly: { instanceBuffers: PAGE } }),
  );
  newer.createBuffer('instanceBuffers', vertexBuffer('newer-page', PAGE), 'preview');
  expect(under.gpu.destroyed).toEqual([]);
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['older-page']);
  expect(under.gpu.alive()).toEqual(['newer-page']);
  expect(under.ledger.bytesOf('instanceBuffers')).toBe(PAGE);
  newer.release();
});
