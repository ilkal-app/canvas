import { describe, expect, it, vi } from 'vitest';

import { createPopupStack, type PopupClaim } from './popup-stack.js';

describe('popup stack acceptance', () => {
  it('replaces an unrelated popup exactly once and forgets its old claim', () => {
    const stack = createPopupStack();
    const closeFirst = vi.fn();
    const first = stack.claim(closeFirst);
    expect(stack.size()).toBe(1);
    stack.claim(vi.fn());
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(stack.size()).toBe(1);
    first.release();
    expect(stack.size()).toBe(1);
  });

  it('preserves the complete ancestor chain and closes descendants from the inside out', () => {
    const stack = createPopupStack();
    const closed: string[] = [];
    const root = stack.claim(() => {
      closed.push('root');
    });
    const child = stack.claim(() => {
      closed.push('child');
    }, root);
    stack.claim(() => {
      closed.push('grandchild');
    }, child);
    expect(stack.size()).toBe(3);
    stack.claim(() => {
      closed.push('sibling');
    }, root);
    expect(closed).toEqual(['grandchild', 'child']);
    expect(stack.size()).toBe(2);
    stack.claim(() => {
      closed.push('stranger');
    });
    expect(closed).toEqual(['grandchild', 'child', 'sibling', 'root']);
    expect(stack.size()).toBe(1);
  });

  it('release removes only its own claim and never invokes its close callback', () => {
    const stack = createPopupStack();
    const closeParent = vi.fn();
    const closeChild = vi.fn();
    const parent = stack.claim(closeParent);
    const child = stack.claim(closeChild, parent);
    child.release();
    child.release();
    expect(stack.size()).toBe(1);
    expect(closeChild).not.toHaveBeenCalled();
    stack.claim(vi.fn());
    expect(closeParent).toHaveBeenCalledOnce();
    expect(closeChild).not.toHaveBeenCalled();
  });

  it('treats an obsolete parent claim as unrelated to the current popup', () => {
    const stack = createPopupStack();
    const former: PopupClaim = stack.claim(vi.fn());
    former.release();
    const closeCurrent = vi.fn();
    stack.claim(closeCurrent);
    stack.claim(vi.fn(), former);
    expect(closeCurrent).toHaveBeenCalledOnce();
    expect(stack.size()).toBe(1);
  });
});
