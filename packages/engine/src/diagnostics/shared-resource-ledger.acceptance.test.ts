// Acceptance, owner area "safe resource sharing": a resource the preview and the live
// scene share (an adopted, unchanged page) is never destroyed while either still holds it;
// releasing one holder leaves it usable by the other; once both release it is freed exactly once,
// and the memory ledger counts it once throughout and nothing afterwards.
import { expect, it } from 'vitest';

import {
  grant,
  handoffPlan,
  startAdmission,
  vertexBuffer,
  type AdmissionUnderTest,
} from '../memory/__fixtures__/counting-gpu.js';
import type { LeasedResource, ResourceLease } from '../memory/__fixtures__/viv-126-seams.js';
import { budgetForDevice } from '../memory/device-budget.js';

const DESKTOP = budgetForDevice({
  deviceMemoryGb: undefined,
  maxTextureSize: 8192,
  isMobile: false,
});
const PAGE = 64 * 1024;

interface SharedPage {
  readonly under: AdmissionUnderTest;
  readonly lease: ResourceLease;
  readonly page: LeasedResource;
}

// A preview page the live scene has adopted: two holders, reserved once as `shared`.
async function adoptedPage(): Promise<SharedPage> {
  const under = await startAdmission(DESKTOP);
  const lease = grant(under.admission, handoffPlan({ shared: { instanceBuffers: PAGE } }));
  const page = lease.createBuffer('instanceBuffers', vertexBuffer('page', PAGE), 'preview');
  lease.hold(page, 'live');
  return { under, lease, page };
}

it('adopts a preview page without copying it and counts it once in the ledger and the lease', async () => {
  const { under, lease } = await adoptedPage();
  expect(under.gpu.created).toEqual(['page']);
  expect(under.ledger.bytesOf('instanceBuffers')).toBe(PAGE);
  expect(under.ledger.totalBytes).toBe(PAGE);
  // The reservation held exactly one copy; a per-holder count would have refused the adoption,
  // and nothing is left over for a second copy.
  expect(() => lease.createBuffer('instanceBuffers', vertexBuffer('copy', PAGE), 'live')).toThrow();
  expect(under.gpu.created).toEqual(['page']);
});

it('keeps the page for the live scene when the preview lets go, then frees it once', async () => {
  const { under, lease, page } = await adoptedPage();
  lease.drop(page, 'preview');
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual([]);
  expect(under.ledger.bytesOf('instanceBuffers')).toBe(PAGE);
  lease.drop(page, 'live');
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['page']);
  expect(under.ledger.totalBytes).toBe(0);
  // Nothing of the freed page stays charged: its whole reservation is usable again.
  lease.createBuffer('instanceBuffers', vertexBuffer('next', PAGE), 'live');
  lease.release();
  await under.gpu.settle();
  expect(under.gpu.destroyCount('page')).toBe(1);
  expect(under.gpu.destroyCount('next')).toBe(1);
});

it('keeps the page for the visible preview when the live plan rolls back, then frees it once', async () => {
  const { under, lease, page } = await adoptedPage();
  lease.rollbackLive();
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual([]);
  expect(under.ledger.bytesOf('instanceBuffers')).toBe(PAGE);
  lease.drop(page, 'preview');
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['page']);
  expect(under.ledger.totalBytes).toBe(0);
});

it('does not let one holder dropping twice free the page the other still holds', async () => {
  const { under, lease, page } = await adoptedPage();
  lease.drop(page, 'preview');
  lease.drop(page, 'preview');
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual([]);
  expect(under.ledger.bytesOf('instanceBuffers')).toBe(PAGE);
  lease.drop(page, 'live');
  lease.drop(page, 'live');
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['page']);
  expect(under.ledger.totalBytes).toBe(0);
});

it('frees a page both still hold exactly once when the attempt ends, and never again', async () => {
  const { under, lease } = await adoptedPage();
  lease.release();
  await under.gpu.settle();
  lease.release();
  lease.rollbackLive();
  await under.gpu.settle();
  expect(under.gpu.destroyed).toEqual(['page']);
  expect(under.ledger.totalBytes).toBe(0);
});
