// @vitest-environment jsdom
// The field states sheet: the number field enabled, mixed and disabled, themed.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { FieldStatesSheet } from './field-states-sheet.js';

afterEach(cleanup);

it('shows the number field enabled, mixed and disabled, in the theme asked for', () => {
  const { container } = render(<FieldStatesSheet initialThemePreference="light" />);
  expect(container.querySelector('[data-field-states]')?.getAttribute('data-field-states')).toBe(
    'light',
  );
  expect(screen.getByLabelText<HTMLInputElement>('Width').value).toBe('576');
  expect(screen.getByLabelText<HTMLInputElement>('Height (mixed)').value).toBe('');
  expect(screen.getByText('Mixed')).toBeInstanceOf(HTMLElement);
  expect(screen.getByLabelText<HTMLInputElement>('Radius').disabled).toBe(true);
});

it('takes a value in its enabled field and edits nothing', () => {
  render(<FieldStatesSheet initialThemePreference="dark" />);
  const width = screen.getByLabelText<HTMLInputElement>('Width');
  act(() => {
    width.value = '600';
    width.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(width.value).toBe('600');
  expect(width.getAttribute('aria-invalid')).toBeNull();
});
