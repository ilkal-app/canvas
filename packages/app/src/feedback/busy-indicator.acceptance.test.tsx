// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { BusyIndicator } from './busy-indicator.js';

afterEach(cleanup);

it('renders nothing while hidden', () => {
  const { container } = render(<BusyIndicator busy={{ isShown: false, progress: 0.5 }} />);
  expect(container.childElementCount).toBe(0);
});

it('names its status and omits a bar until progress is known', () => {
  const { rerender } = render(<BusyIndicator busy={{ isShown: true, progress: undefined }} />);
  expect(screen.getByRole('status', { name: 'Applying changes' }).textContent).toContain(
    'Applying changes…',
  );
  expect(screen.queryByRole('progressbar')).toBeNull();
  rerender(<BusyIndicator busy={{ isShown: true, progress: 0.5 }} />);
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  rerender(<BusyIndicator busy={{ isShown: false, progress: undefined }} />);
  expect(screen.queryByRole('status', { name: 'Applying changes' })).toBeNull();
});
