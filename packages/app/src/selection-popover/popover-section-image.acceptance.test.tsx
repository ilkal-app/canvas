// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ShellAction } from '../state/shell-action.js';
import type { BoardVote } from '../voting/vote-context.js';

import { mount, preparePopover, propsOf, rowOf } from './popover-shape-connector-fixtures.js';
import { FRAME, FRAME_2, IMAGE, IMAGE_2 } from './popover-viv-629-fixtures.js';

beforeEach(preparePopover);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function chooseColour(name: RegExp, choice: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: choice }));
}

function disabled(name: string): void {
  expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
}

describe('section selection', () => {
  it('orders Fill, Fit, Lock, section actions, Comment and More', () => {
    const toolbar = mount(propsOf([FRAME]));
    expect(rowOf(toolbar)).toEqual([
      expect.stringMatching(/^Fill: /),
      'Fit to content',
      'Lock',
      '|',
      'Timer for this section',
      'Vote in this section',
      '|',
      'Comment',
      'More',
    ]);
    expect(toolbar.querySelectorAll('[data-popover-divider]')).toHaveLength(2);
    disabled('Fit to content');
    disabled('Timer for this section');
    disabled('Vote in this section');
  });

  it('changes every frame background to None in one style action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([FRAME, FRAME_2], { dispatch }));
    chooseColour(/^Fill:/, 'None');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: FRAME.id, style: { background: null } },
        { id: FRAME_2.id, style: { background: null } },
      ],
    });
  });

  it('applies a board token to every frame in one style action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([FRAME, FRAME_2], { dispatch }));
    chooseColour(/^Fill:/, 'accent');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: FRAME.id, style: { background: { token: 'accent' } } },
        { id: FRAME_2.id, style: { background: { token: 'accent' } } },
      ],
    });
  });

  it('applies a custom RGBA background to every frame in one action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([FRAME, FRAME_2], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: /^Fill:/ }));
    const custom = within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Hex' });
    fireEvent.change(custom, { target: { value: '#ff8040' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: FRAME.id, style: { background: [1, 128 / 255, 64 / 255, 1] } },
        { id: FRAME_2.id, style: { background: [1, 128 / 255, 64 / 255, 1] } },
      ],
    });
  });

  it('toggles a locked section through the selection action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([{ ...FRAME, locked: true }], { dispatch }));
    const lock = screen.getByRole('button', { name: 'Lock' });
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(lock);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'selection',
      command: 'toggleLock',
    });
  });

  it('calls the timer only for a single section with a handler', () => {
    const onSectionTimer = vi.fn();
    mount(propsOf([FRAME], { onSectionTimer }));
    fireEvent.click(screen.getByRole('button', { name: 'Timer for this section' }));
    expect(onSectionTimer).toHaveBeenCalledExactlyOnceWith(FRAME.id);
    cleanup();
    mount(propsOf([FRAME, FRAME_2], { onSectionTimer }));
    disabled('Timer for this section');
    fireEvent.click(screen.getByRole('button', { name: 'Timer for this section' }));
    expect(onSectionTimer).toHaveBeenCalledTimes(1);
  });

  it('starts a scoped vote only with one section, vote permission and no current session', () => {
    const start = vi.fn();
    const vote = { session: null, canVote: true, notice: undefined, start } as unknown as BoardVote;
    mount(propsOf([FRAME]), vote);
    fireEvent.click(screen.getByRole('button', { name: 'Vote in this section' }));
    expect(start).toHaveBeenCalledExactlyOnceWith(FRAME.id);
    cleanup();
    mount(propsOf([FRAME, FRAME_2]), vote);
    disabled('Vote in this section');
    cleanup();
    mount(propsOf([FRAME]), { ...vote, canVote: false });
    disabled('Vote in this section');
    cleanup();
    mount(propsOf([FRAME]), { ...vote, session: { status: 'open' } } as BoardVote);
    disabled('Vote in this section');
    expect(start).toHaveBeenCalledTimes(1);
  });
});

describe('image selection', () => {
  it('orders Crop, Replace, Border, Link, Comment and More', () => {
    const toolbar = mount(propsOf([IMAGE]));
    expect(rowOf(toolbar)).toEqual([
      'Crop',
      'Replace',
      'Border: None',
      '|',
      'Link',
      'Comment',
      'More',
    ]);
    disabled('Replace');
    expect(
      screen.getByRole('button', { name: 'Border: None' }).getAttribute('aria-disabled'),
    ).not.toBe('true');
  });

  it('activates crop for one unlocked image and disables it otherwise', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([IMAGE], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Crop' }));
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'selection', command: 'activate' });
    cleanup();
    dispatch.mockClear();
    mount(propsOf([{ ...IMAGE, locked: true }], { dispatch }));
    disabled('Crop');
    fireEvent.click(screen.getByRole('button', { name: 'Crop' }));
    expect(dispatch).not.toHaveBeenCalled();
    cleanup();
    mount(propsOf([IMAGE, IMAGE_2], { dispatch }));
    disabled('Crop');
  });

  it('names absent, shared and mixed image links', () => {
    mount(propsOf([IMAGE, IMAGE_2]));
    screen.getByRole('button', { name: 'Link' });
    cleanup();
    mount(
      propsOf([
        { ...IMAGE, link: 'https://example.com/' },
        { ...IMAGE_2, link: 'https://example.com/' },
      ]),
    );
    screen.getByRole('button', { name: 'Link: https://example.com/' });
    cleanup();
    mount(propsOf([{ ...IMAGE, link: 'https://example.com/' }, IMAGE_2]));
    screen.getByRole('button', { name: 'Link: Mixed' });
  });

  it('sets one link on every image with a single style action', () => {
    const dispatch = vi.fn<(action: ShellAction) => void>();
    mount(propsOf([IMAGE, IMAGE_2], { dispatch }));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const input = within(screen.getByRole('dialog', { name: 'Link' })).getByRole('textbox', {
      name: 'Link address',
    });
    fireEvent.change(input, { target: { value: 'HTTPS://Example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'style',
      changes: [
        { id: IMAGE.id, style: { link: 'https://example.com/' } },
        { id: IMAGE_2.id, style: { link: 'https://example.com/' } },
      ],
    });
  });

  it('shows only Comment to a commenter and nothing to a viewer', () => {
    expect(rowOf(mount(propsOf([IMAGE], { canEdit: false })))).toEqual(['Comment']);
    expect(
      screen.getByRole('button', { name: 'Comment' }).getAttribute('aria-disabled'),
    ).toBeNull();
    cleanup();
    mount(propsOf([FRAME], { canEdit: false }), undefined, false);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
  });
});
