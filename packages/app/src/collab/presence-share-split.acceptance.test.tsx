// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PresenceShareBar } from './presence-share-bar.js';

afterEach(cleanup);

describe('split Share control', () => {
  it('attaches an icon-only Copy link button to Share with a tooltip and separate callbacks', () => {
    const onShare = vi.fn();
    const onCopyLink = vi.fn();
    render(<PresenceShareBar onShare={onShare} onCopyLink={onCopyLink} />);
    const group = screen.getByRole('group', { name: 'Share' });
    const share = within(group).getByRole('button', { name: 'Share' });
    const copy = within(group).getByRole('button', { name: 'Copy link' });
    expect(share.getAttribute('aria-haspopup')).toBe('dialog');
    expect(copy.textContent.trim()).toBe('');
    expect(
      copy.getAttribute('title') === 'Copy link' || screen.queryByText('Copy link') !== null,
    ).toBe(true);
    fireEvent.click(share);
    fireEvent.click(copy);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it('shows only Share when no copy callback is supplied', () => {
    render(<PresenceShareBar onShare={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });

  it('makes both controls inert while sharing is inert', () => {
    const onShare = vi.fn();
    const onCopyLink = vi.fn();
    render(<PresenceShareBar onShare={onShare} onCopyLink={onCopyLink} isShareInert />);
    const group = screen.getByRole('group', { name: 'Share' });
    const share = within(group).getByRole('button', { name: 'Share' });
    const copy = within(group).getByRole('button', { name: 'Copy link' });
    expect(share.closest('[inert]')).not.toBeNull();
    expect(copy.closest('[inert]')).not.toBeNull();
    expect(onShare).not.toHaveBeenCalled();
    expect(onCopyLink).not.toHaveBeenCalled();
  });
});
