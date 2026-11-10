import { describe, expect, it } from 'vitest';

import { LAYOUT_GATE_CLOSE_CODE } from '@canvas/document';

import { classifyClose } from './relay-close.js';
import { FRAME_TOO_LARGE_CLOSE_CODE, UPDATE_TOO_LARGE_REASON } from './update-too-large.js';

describe('classifyClose', () => {
  it('ends outdated on the layout gate close, with its reason or its code', () => {
    expect(classifyClose(LAYOUT_GATE_CLOSE_CODE, 'unreadable-layout', true)).toEqual({
      kind: 'outdated',
      reason: 'unreadable-layout',
    });
    expect(classifyClose(LAYOUT_GATE_CLOSE_CODE, '', false)).toEqual({
      kind: 'outdated',
      reason: String(LAYOUT_GATE_CLOSE_CODE),
    });
  });

  it('reads 1009 as an oversized update only once authenticated', () => {
    expect(classifyClose(FRAME_TOO_LARGE_CLOSE_CODE, '', true)).toEqual({
      kind: 'outdated',
      reason: UPDATE_TOO_LARGE_REASON,
    });
    expect(classifyClose(FRAME_TOO_LARGE_CLOSE_CODE, '', false)).toEqual({ kind: 'lost' });
  });

  it('reads 4401 and 4403 as a refused token and anything else as a lost connection', () => {
    expect(classifyClose(4401, 'token-expired', true)).toEqual({
      kind: 'rejected',
      reason: 'token-expired',
    });
    expect(classifyClose(4403, '', true)).toEqual({ kind: 'rejected', reason: '4403' });
    expect(classifyClose(1008, 'token-refresh-limit', true)).toEqual({ kind: 'lost' });
    expect(classifyClose(4425, 'incomplete-update', true)).toEqual({ kind: 'lost' });
  });
});
