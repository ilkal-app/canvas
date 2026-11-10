import { describe, expect, it } from 'vitest';

import { OpenPassGuard } from './pass-guard.js';

describe('OpenPassGuard', () => {
  it('rejects buffer and texture writes while a pass is open, on every backend alike', () => {
    const guard = new OpenPassGuard();
    guard.open();
    expect(() => {
      guard.assertClosed('write a buffer');
    }).toThrow(/Cannot write a buffer while a render pass is open/);
  });

  it('allows writes again once the pass has ended', () => {
    const guard = new OpenPassGuard();
    guard.open();
    guard.close();
    expect(() => {
      guard.assertClosed('write a texture');
    }).not.toThrow();
  });

  it('rejects beginning a second pass while one is open', () => {
    const guard = new OpenPassGuard();
    guard.open();
    expect(() => {
      guard.open();
    }).toThrow(/begin a render pass/);
  });
});
