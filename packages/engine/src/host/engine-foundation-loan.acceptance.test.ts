import { describe, expect, it } from 'vitest';

import { MemoryLedger } from '../diagnostics/memory-ledger.js';
import { FakeGpuBackend } from '../scene/__fixtures__/fake-gpu-backend.js';

import { EngineFoundation } from './engine-foundation.js';

interface LoanUnderTest {
  readonly textureCapBytes: number;
  readonly borrowedBytes: number;
  attachBorrower(borrowed: () => number): void;
}

/**
 * Reads the environment's loan while its implementation has yet to land.
 *
 * @param foundation - The owner of the environment.
 * @returns The loan, when provided.
 */
function loanOf(foundation: EngineFoundation): LoanUnderTest | undefined {
  return foundation.environment.atlasLoan;
}

describe('EngineFoundation atlas loan', () => {
  it('makes one loan from the texture share and replaces it with the backend budget', () => {
    const foundation = new EngineFoundation(
      new FakeGpuBackend({ maxTextureSize: 8192 }),
      {},
      {},
      new MemoryLedger(),
    );
    try {
      const first = loanOf(foundation);
      expect(first).toBeDefined();
      expect(first?.textureCapBytes).toBe(foundation.environment.budget.bytesByCategory.textures);
      first?.attachBorrower(() => 10);

      foundation.adoptBackend(new FakeGpuBackend({ maxTextureSize: 2048 }));

      const second = loanOf(foundation);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(second?.textureCapBytes).toBe(foundation.environment.budget.bytesByCategory.textures);
      expect(second?.borrowedBytes).toBe(0);
      expect(second?.textureCapBytes).toBeLessThan(first?.textureCapBytes ?? Infinity);
    } finally {
      foundation.destroy();
    }
  });
});
