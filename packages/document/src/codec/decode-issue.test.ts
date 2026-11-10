import { expect, it } from 'vitest';

import { DECODE_ISSUE_CODES, isHiddenMemberIssue, isParentCycleIssue } from './decode-issue.js';

it('classifies a projected parent cycle separately from hidden members and unreadable entries', () => {
  for (const code of DECODE_ISSUE_CODES) {
    const issue = { code, key: 'object', field: null, message: 'fixture' };
    expect(isParentCycleIssue(issue)).toBe(code === 'parent-cycle');
    if (isParentCycleIssue(issue)) expect(isHiddenMemberIssue(issue)).toBe(false);
  }
});
