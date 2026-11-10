import { expect, it } from 'vitest';

import type { BoardTokenClaims } from './board-token.js';
import { repairModeFor } from './repair-mode-for.js';

const HUMAN: BoardTokenClaims = {
  principalId: 'ada',
  principalType: 'user',
  boardId: 'board',
  role: 'editor',
};

it('uses the signed principal type for repair authority, regardless of the subject spelling', () => {
  expect(repairModeFor(HUMAN)).toBe('write');
  expect(
    repairModeFor({ ...HUMAN, principalId: 'helper', principalType: 'agent', operatorId: 'ada' }),
  ).toBe('agent-write');
  expect(
    repairModeFor({
      ...HUMAN,
      principalId: 'agent-key:uuid',
      principalType: 'agent',
      operatorId: 'ada',
    }),
  ).toBe('agent-write');
  expect(repairModeFor({ ...HUMAN, principalId: 'agent:human' })).toBe('write');
  expect(repairModeFor(HUMAN, true)).toBe('read-only');
  expect(repairModeFor({ ...HUMAN, role: 'viewer' })).toBe('read-only');
});
