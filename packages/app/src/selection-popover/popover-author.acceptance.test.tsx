// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId, StickyObject } from '@canvas/schema';

import { mount, preparePopover, propsOf, rowOf, TEXT } from './popover-shape-connector-fixtures.js';

const NOTE = {
  ...TEXT,
  id: 'author-note-1' as ObjectId,
  type: 'sticky',
  color: [1, 0.9, 0.5, 1],
  autoWidth: false,
} as StickyObject;
const NOTE_2 = { ...NOTE, id: 'author-note-2' as ObjectId, x: 420 };

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('sticky author popover', () => {
  it('shows a pressed author toggle for every selected sticky and calls it once per click', () => {
    const onToggle = vi.fn();
    const toolbar = mount(propsOf([NOTE, NOTE_2], { stickyAuthors: { isShown: false, onToggle } }));
    expect(rowOf(toolbar)).toEqual(
      expect.arrayContaining(['Show authors', 'Vote', 'Comment', 'More']),
    );
    const button = screen.getByRole('button', { name: 'Show authors' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.querySelector('[data-icon="invite"]')).not.toBeNull();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reflects a true setting and keeps the Author placeholder without the prop', () => {
    mount(propsOf([NOTE], { stickyAuthors: { isShown: true, onToggle: vi.fn() } }));
    expect(screen.getByRole('button', { name: 'Show authors' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    cleanup();
    mount(propsOf([NOTE]));
    expect(screen.getByRole('button', { name: 'Author — not available yet' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Show authors' })).toBeNull();
  });

  it('keeps the author toggle off text rows and away from commenters and viewers', () => {
    const stickyAuthors = { isShown: true, onToggle: vi.fn() };
    mount(propsOf([TEXT], { stickyAuthors }));
    expect(screen.queryByRole('button', { name: 'Show authors' })).toBeNull();
    cleanup();
    mount(propsOf([NOTE], { stickyAuthors, canEdit: false }));
    expect(screen.queryByRole('button', { name: 'Show authors' })).toBeNull();
  });
});
