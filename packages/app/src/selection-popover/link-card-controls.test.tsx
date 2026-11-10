// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinkObject, ObjectId, PrincipalId } from '@canvas/schema';

import type { ShellAction } from '../state/shell-action.js';

import { mount, preparePopover, propsOf, rowOf } from './popover-shape-connector-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CARD: LinkObject = {
  id: 'card' as ObjectId,
  type: 'link',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: 'user:ada' as PrincipalId,
  createdAt: 1,
  updatedAt: 1,
  width: 320,
  height: 280,
  url: 'https://example.com/story',
  title: 'Story',
  description: '',
  siteName: '',
  layout: 'vertical',
  status: 'ready',
  unfurlKey: 'k',
};

describe('the link card row (frame L2)', () => {
  it('orders Open, Copy link | the two layouts, To text link, then Comment and More', () => {
    const toolbar = mount(propsOf([CARD]));
    expect(rowOf(toolbar)).toEqual([
      'Open',
      'Copy link',
      '|',
      'Image above',
      'Image beside',
      'To text link',
      'Comment',
      'More',
    ]);
    expect(screen.getByRole('button', { name: 'Image above' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens the page without an opener, and copies its link', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(propsOf([CARD]));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledWith(CARD.url, '_blank', 'noopener,noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(CARD.url);
  });

  it('switches the layout and turns the card into a text link, one action each', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([CARD], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Image above' }));
    fireEvent.click(screen.getByRole('button', { name: 'Image beside' }));
    fireEvent.click(screen.getByRole('button', { name: 'To text link' }));
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'linkCard', id: CARD.id, change: { kind: 'layout', layout: 'vertical' } },
      { type: 'linkCard', id: CARD.id, change: { kind: 'layout', layout: 'horizontal' } },
      { type: 'linkCard', id: CARD.id, change: { kind: 'toText' } },
    ]);
  });

  it('offers Retry on a failed card, and only Open and Copy link on a locked one', () => {
    const props = propsOf([{ ...CARD, status: 'failed' }]);
    const retry = vi.fn(() => true);
    const { engine } = props;
    if (engine === undefined) throw new Error('no engine');
    vi.spyOn(engine, 'pasteTarget').mockReturnValue({
      pointer: undefined,
      viewCentre: { x: 0, y: 0 },
      createObjects: () => true,
      notify: () => undefined,
      retryLinkUnfurl: retry,
    });
    mount(props);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // The card goes back to pending through the engine's paste target, under a new key.
    expect(retry).toHaveBeenCalledWith(CARD.id, expect.stringMatching(/^paste-/));
    cleanup();
    const toolbar = mount(propsOf([{ ...CARD, locked: true }]));
    expect(rowOf(toolbar).slice(0, 3)).toEqual(['Open', 'Copy link', 'Comment']);
  });

  it('gives a viewer Open and Copy link', () => {
    const toolbar = mount(propsOf([CARD], { canEdit: false }), undefined, false);
    expect(rowOf(toolbar)).toEqual(['Open', 'Copy link', 'Comment']);
  });
});
