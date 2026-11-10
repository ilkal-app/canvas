// Acceptance: resolved layers own 6/64 of the GPU budget.
import { expect, it } from 'vitest';

import { MEMORY_CATEGORIES, MemoryLedger } from '../diagnostics/memory-ledger.js';

import { budgetForDevice, DESKTOP_BUDGET_BYTES } from './device-budget.js';

it('reserves 6/64 for layers, moving those bytes out of textures', () => {
  expect(MEMORY_CATEGORIES).toContain('layers');
  const budget = budgetForDevice({
    deviceMemoryGb: undefined,
    maxTextureSize: 8192,
    isMobile: false,
  });
  expect(budget.bytesByCategory).toMatchObject({
    layers: (DESKTOP_BUDGET_BYTES * 6) / 64,
    textures: (DESKTOP_BUDGET_BYTES * 34) / 64,
  });
  expect(Object.values(budget.bytesByCategory).reduce((sum, bytes) => sum + bytes, 0)).toBe(
    DESKTOP_BUDGET_BYTES,
  );
});

it('counts and frees resolved target memory under layers', () => {
  const ledger = new MemoryLedger();
  const category = 'layers' as Parameters<MemoryLedger['set']>[0];
  ledger.set(category, 'target-1', 32 * 16 * 4);
  expect(ledger.bytesOf(category)).toBe(2048);
  expect(ledger.delete(category, 'target-1')).toBe(true);
  expect(ledger.bytesOf(category)).toBe(0);
});
