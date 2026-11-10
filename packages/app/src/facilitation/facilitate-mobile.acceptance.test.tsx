// @vitest-environment jsdom
// The floating phone card starts collapsed, desktop stays expanded.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { YjsDocumentStore, type TransactionOrigin } from '@canvas/document';
import type { PrincipalId } from '@canvas/schema';

import { fakeViewport } from '../shell/__fixtures__/fake-media.js';

import { FacilitateCard } from './facilitate-card.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('starts collapsed at 390 px, expands on request, and starts expanded at 768 px', () => {
  const viewport = fakeViewport(390);
  vi.stubGlobal('matchMedia', viewport.matchMedia);
  const source = {
    store: new YjsDocumentStore(),
    origin: { kind: 'user', principalId: 'user:test' as PrincipalId } as TransactionOrigin,
  };
  const view = render(
    <FacilitateCard
      source={source}
      canEdit
      storage={{ getItem: () => null, setItem: vi.fn() }}
      createChime={() => ({ play: vi.fn(() => true), dispose: vi.fn() })}
    />,
  );
  const card = screen.getByRole('region', { name: 'Facilitate' });
  expect(card.hasAttribute('data-compact')).toBe(true);
  const expand = screen.getByRole('button', { name: 'Expand Facilitate' });
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: /set the duration/ })).toBeNull();
  fireEvent.click(expand);
  expect(screen.getByRole('button', { name: /set the duration/ })).toBeTruthy();
  viewport.resize(768);
  view.unmount();
  render(
    <FacilitateCard
      source={source}
      canEdit
      storage={{ getItem: () => null, setItem: vi.fn() }}
      createChime={() => ({ play: vi.fn(() => true), dispose: vi.fn() })}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Collapse Facilitate' }).getAttribute('aria-expanded'),
  ).toBe('true');
});
