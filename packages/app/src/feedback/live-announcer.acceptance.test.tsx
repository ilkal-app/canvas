// CONTRACT: one polite, accessible live region reannounces repeated messages after a 50 ms delay.
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ANNOUNCE_DELAY_MS, LiveAnnouncerBoundary, useAnnounce } from './live-announcer.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('shares one visually hidden polite region across nested boundaries', () => {
  let announce: (message: string) => void = () => undefined;
  function Probe(): null {
    announce = useAnnounce();
    return null;
  }
  render(
    <LiveAnnouncerBoundary>
      <LiveAnnouncerBoundary>
        <Probe />
      </LiveAnnouncerBoundary>
    </LiveAnnouncerBoundary>,
  );
  const regions = document.querySelectorAll('[data-live-announcer]');
  expect(regions).toHaveLength(1);
  const region = screen.getByRole('status');
  expect(region.getAttribute('aria-live')).toBe('polite');
  expect(region.getAttribute('aria-atomic')).toBe('true');
  expect(region.hasAttribute('aria-hidden')).toBe(false);
  expect(getComputedStyle(region).display).not.toBe('none');
  expect(region.className).not.toBe('');
  act(() => {
    announce('Ready');
  });
  expect(region.textContent).toBe('');
});

it('clears synchronously and refills even when the message repeats', () => {
  vi.useFakeTimers();
  expect(ANNOUNCE_DELAY_MS).toBe(50);
  let announce: (message: string) => void = () => undefined;
  function Probe(): null {
    announce = useAnnounce();
    return null;
  }
  render(
    <LiveAnnouncerBoundary>
      <Probe />
    </LiveAnnouncerBoundary>,
  );
  const region = screen.getByRole('status');
  act(() => {
    announce('Someone reacted with heart');
  });
  expect(region.textContent).toBe('');
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(region.textContent).toBe('Someone reacted with heart');
  act(() => {
    announce('Someone reacted with heart');
  });
  expect(region.textContent).toBe('');
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS);
  });
  expect(region.textContent).toBe('Someone reacted with heart');
});

it('gives callers outside a boundary a harmless function', () => {
  let announce: (message: string) => void = () => undefined;
  function Probe(): null {
    announce = useAnnounce();
    return null;
  }
  render(<Probe />);
  expect(() => {
    announce('Ignored');
  }).not.toThrow();
  expect(document.querySelectorAll('[data-live-announcer]')).toHaveLength(0);
});
