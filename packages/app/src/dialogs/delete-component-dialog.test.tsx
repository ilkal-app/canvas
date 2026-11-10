// @vitest-environment jsdom
// The delete-main confirmation (ruling 6): shown while a deletion waits, Cancel and
// Escape keep everything, "Delete component" deletes.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeletionConfirmations } from '../engine/deletion-confirmations.js';

import { DeleteComponentDialog } from './delete-component-dialog.js';

const CARD = { name: 'Card', mainCount: 1, instanceCount: 3 };

/**
 * The dialog over a set of confirmations, with a deletion waiting.
 *
 * @returns The confirmations and the deletion's spy.
 */
function renderAsked() {
  const confirmations = new DeletionConfirmations();
  render(<DeleteComponentDialog confirmations={confirmations} />);
  const proceed = vi.fn();
  act(() => {
    confirmations.ask(CARD, proceed);
  });
  return { confirmations, proceed };
}

afterEach(cleanup);

describe('DeleteComponentDialog', () => {
  it('shows nothing while no deletion waits, nor without confirmations', () => {
    render(<DeleteComponentDialog confirmations={new DeletionConfirmations()} />);
    render(<DeleteComponentDialog confirmations={undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks about the main and its instances, and deletes on "Delete component"', () => {
    const { confirmations, proceed } = renderAsked();
    const dialog = screen.getByRole('dialog', { name: 'Delete component' });
    expect(dialog.textContent).toContain(
      'Delete component “Card”? Its 3 instances become plain objects.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete component' }));
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(confirmations.current()).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps everything on Cancel and on Escape', () => {
    for (const close of [
      () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })),
      () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }),
    ]) {
      const { proceed } = renderAsked();
      close();
      expect(proceed).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).toBeNull();
      cleanup();
    }
  });
});
