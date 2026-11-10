// @vitest-environment jsdom
// A text field that commits on Enter or blur, and with `accepts` reverts a
// refused value instead of committing it.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TextFieldControl } from './text-field-control.js';

afterEach(cleanup);

describe('TextFieldControl', () => {
  it('commits an accepted value and reverts a refused one, committing nothing', () => {
    const onCommit = vi.fn<(value: string) => void>();
    render(
      <TextFieldControl
        label="Value"
        value="rest"
        accepts={(value) => value !== ''}
        onCommit={onCommit}
      />,
    );
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Value' });
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
    expect(field.value).toBe('rest');
    fireEvent.change(field, { target: { value: 'hover' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('hover');
  });
});
