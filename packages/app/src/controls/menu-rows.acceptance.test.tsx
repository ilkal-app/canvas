// @vitest-environment jsdom
// Items 3-4, written before the fix. CONTRACT: default checks follow the label and
// danger has no leading element. Deliberately not asserted: browser geometry or CSS colours.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Menu, type MenuEntry } from './menu.js';

afterEach(cleanup);

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
  return () => vi.restoreAllMocks();
});

function Harness(props: {
  readonly entry: MenuEntry;
  readonly variant?: 'default' | 'compact';
}): ReactElement {
  const [isOpen, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <Menu
        label="Board menu"
        entries={[props.entry]}
        anchor={anchor}
        isOpen={isOpen}
        variant={props.variant}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

function openRow(role: 'menuitem' | 'menuitemcheckbox', name: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  return within(screen.getByRole('menu', { name: 'Board menu' })).getByRole(role, { name });
}

const label = 'Show resolved comments';

describe('menu row acceptance', () => {
  it('places a checked default checkbox label first and its check after the label', () => {
    render(<Harness entry={{ kind: 'checkbox', id: 'resolved', label, isChecked: true }} />);
    const row = openRow('menuitemcheckbox', label);
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(row.firstElementChild?.textContent).toBe(label);
    expect(row.firstElementChild?.querySelector('svg')).toBeNull();
    expect(row.querySelector('svg')).not.toBeNull();
    expect(row.lastElementChild?.querySelector('svg')).not.toBeNull();
  });

  it('leaves no check or empty leading element in an unchecked default checkbox', () => {
    render(<Harness entry={{ kind: 'checkbox', id: 'resolved', label, isChecked: false }} />);
    const row = openRow('menuitemcheckbox', label);
    expect(row.getAttribute('aria-checked')).toBe('false');
    expect(row.firstElementChild?.textContent).toBe(label);
    expect(row.querySelector('svg')).toBeNull();
  });

  it('retains the leading check column in the compact variant', () => {
    render(
      <Harness
        variant="compact"
        entry={{ kind: 'checkbox', id: 'resolved', label, isChecked: true }}
      />,
    );
    const row = openRow('menuitemcheckbox', label);
    expect(row.firstElementChild?.querySelector('svg')).not.toBeNull();
    expect(row.children.item(1)?.textContent).toBe(label);
  });

  it('starts a danger item with its label', () => {
    render(
      <Harness entry={{ kind: 'item', id: 'delete', label: 'Delete board', isDanger: true }} />,
    );
    const row = openRow('menuitem', 'Delete board');
    expect(row.hasAttribute('data-danger')).toBe(true);
    expect(row.firstElementChild?.textContent).toBe('Delete board');
  });
});
