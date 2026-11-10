import { describe, expect, it, vi } from 'vitest';

import { createPopupStack } from './popup-stack.js';

describe('createPopupStack', () => {
  it('closes the open popup when another opens, so two never show at once', () => {
    const stack = createPopupStack();
    const first = vi.fn();
    stack.claim(first);
    expect(stack.size()).toBe(1);
    const second = vi.fn();
    stack.claim(second);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(stack.size()).toBe(1);
  });

  it('keeps a parent open under its child, and closes both, innermost first, for a stranger', () => {
    const stack = createPopupStack();
    const order: string[] = [];
    const popover = stack.claim(() => order.push('popover'));
    const palette = stack.claim(() => order.push('palette'), popover);
    stack.claim(() => order.push('submenu'), palette);
    expect(order).toEqual([]);
    expect(stack.size()).toBe(3);
    stack.claim(() => order.push('menu'));
    expect(order).toEqual(['submenu', 'palette', 'popover']);
    expect(stack.size()).toBe(1);
  });

  it('closes a sibling child, not the parent, when another child opens', () => {
    const stack = createPopupStack();
    const parentClose = vi.fn();
    const parent = stack.claim(parentClose);
    const dropdown = vi.fn();
    stack.claim(dropdown, parent);
    stack.claim(vi.fn(), parent);
    expect(dropdown).toHaveBeenCalledOnce();
    expect(parentClose).not.toHaveBeenCalled();
    expect(stack.size()).toBe(2);
  });

  it('forgets a popup that releases its claim, without closing it', () => {
    const stack = createPopupStack();
    const close = vi.fn();
    const claim = stack.claim(close);
    claim.release();
    claim.release();
    expect(stack.size()).toBe(0);
    stack.claim(vi.fn());
    expect(close).not.toHaveBeenCalled();
  });

  it('treats a released parent as gone: its would-be child closes everything open', () => {
    const stack = createPopupStack();
    const parent = stack.claim(vi.fn());
    parent.release();
    const other = vi.fn();
    stack.claim(other);
    stack.claim(vi.fn(), parent);
    expect(other).toHaveBeenCalledOnce();
  });

  it('closes a released parent’s open children, innermost first, and forgets them', () => {
    const stack = createPopupStack();
    const order: string[] = [];
    const parentClose = vi.fn();
    const parent = stack.claim(parentClose);
    const child = stack.claim(() => order.push('child'), parent);
    stack.claim(() => order.push('grandchild'), child);
    parent.release();
    expect(order).toEqual(['grandchild', 'child']);
    expect(parentClose).not.toHaveBeenCalled();
    expect(stack.size()).toBe(0);
  });
});
