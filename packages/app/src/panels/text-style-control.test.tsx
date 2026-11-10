// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  TextStyleProvider,
  useTextStyleControl,
  type TextStyleControl,
} from './text-style-control.js';

describe('useTextStyleControl', () => {
  it('targets no text outside a provider, and a change there goes nowhere', () => {
    const { result } = renderHook(() => useTextStyleControl());
    expect(result.current.context).toBeUndefined();
    expect(() => {
      result.current.onChange({ kind: 'toggleBold' });
    }).not.toThrow();
    expect(result.current.context).toBeUndefined();
  });

  it('reads the nearest provider’s control', () => {
    const value: TextStyleControl = { context: undefined, onChange: vi.fn() };
    const { result } = renderHook(() => useTextStyleControl(), {
      wrapper: ({ children }) => <TextStyleProvider value={value}>{children}</TextStyleProvider>,
    });
    result.current.onChange({ kind: 'toggleItalic' });
    expect(value.onChange).toHaveBeenCalledExactlyOnceWith({ kind: 'toggleItalic' });
  });
});
