// Opening the layers drawer in a shell rendered in jsdom, as a person does with the
// zoom control's layers toggle: the layers panel lives in the drawer, closed at first.
import { act, fireEvent, screen } from '@testing-library/react';

/**
 * Opens the layers drawer with the zoom control's toggle, unless it is open already (the person's
 * choice is kept in `localStorage`, which a test file's earlier tests may have left open).
 */
export function openLayersDrawer(): void {
  const toggle = screen.getByRole('button', { name: 'Layers' });
  if (toggle.getAttribute('aria-pressed') === 'true') return;
  act(() => {
    fireEvent.click(toggle);
  });
}
