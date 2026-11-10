import { describe, expect, it } from 'vitest';

import { BOARD_ISSUE_CODES } from './board-issue.js';

describe('BOARD_ISSUE_CODES', () => {
  it('lists each code once, the file-format codes before the reference codes', () => {
    expect(new Set(BOARD_ISSUE_CODES).size).toBe(BOARD_ISSUE_CODES.length);
    expect(BOARD_ISSUE_CODES.slice(0, 7)).toEqual([
      'invalid-format',
      'unsupported-schema-version',
      'invalid-object',
      'run-splits-character',
      'invalid-z-key',
      'out-of-bound',
      'duplicate-id',
    ]);
  });
});
