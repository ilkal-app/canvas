// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { BoardMenu } from '../shell/board-menu.js';
import { INITIAL_SHELL_STATE } from '../state/shell-reducer.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import { fakeMember } from './__fixtures__/fake-member-directory.js';
import { CommentComposer } from './comment-composer.js';
import { commentContext } from './comment-context.js';
import type { CommentData } from './comment-data-context.js';
import { CommentDialog } from './comment-dialog.js';
import { CommentTool } from './comment-toolbar.js';

afterEach(cleanup);
const member = fakeMember('grace', 'Grace', 'editor');

it('posts selected mentions and clears only after successful persistence', async () => {
  const onPost = vi.fn().mockResolvedValue(undefined);
  render(
    <CommentComposer members={[member]} isBusy={false} placeholder="Reply…" onPost={onPost} />,
  );
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: 'Hi @Gr' } });
  fireEvent.click(screen.getByRole('option', { name: 'Grace' }));
  expect(document.activeElement).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => {
    expect((input as HTMLTextAreaElement).value).toBe('');
  });
  expect(onPost).toHaveBeenCalledWith('Hi @Grace ', ['grace']);
});

it('retains failed text and removes a mention whose label was edited away', async () => {
  const onPost = vi.fn().mockRejectedValue(new Error('offline'));
  render(
    <CommentComposer members={[member]} isBusy={false} placeholder="Reply…" onPost={onPost} />,
  );
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: '@' } });
  fireEvent.click(screen.getByRole('option', { name: 'Grace' }));
  fireEvent.change(input, { target: { value: 'Plain text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => {
    expect(onPost).toHaveBeenCalledWith('Plain text', []);
  });
  expect((input as HTMLTextAreaElement).value).toBe('Plain text');
});

it.each(['blank', 'limit', 'busy'] as const)('does not submit %s input', (kind) => {
  const onPost = vi.fn();
  const { container } = render(
    <CommentComposer members={[]} isBusy={kind === 'busy'} placeholder="Reply…" onPost={onPost} />,
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: kind === 'blank' ? ' ' : kind === 'limit' ? '😀'.repeat(5001) : 'Pending' },
  });
  const form = container.querySelector('form');
  if (!form) throw new Error('composer form missing');
  fireEvent.submit(form);
  expect(onPost).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Post' }).hasAttribute('disabled')).toBe(true);
});

it('sends on Enter, adds a line on Shift+Enter, and keeps focus in the field after posting', async () => {
  const onPost = vi.fn().mockResolvedValue(undefined);
  render(<CommentComposer members={[]} isBusy={false} placeholder="Reply…" onPost={onPost} />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  expect(input.getAttribute('placeholder')).toBe('Reply…');
  fireEvent.change(input, { target: { value: 'Line' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(onPost).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => {
    expect((input as HTMLTextAreaElement).value).toBe('');
  });
  expect(onPost).toHaveBeenCalledWith('Line', []);
  expect(document.activeElement).toBe(input);
});

it('does not send on the Enter that commits an input method’s word, in Chrome or Safari', () => {
  const onPost = vi.fn().mockResolvedValue(undefined);
  render(<CommentComposer members={[]} isBusy={false} placeholder="Reply…" onPost={onPost} />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: '日本語' } });
  // Chrome: the Enter arrives while composing. Safari: after compositionend, with keyCode 229.
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  expect(onPost).not.toHaveBeenCalled();
  expect((input as HTMLTextAreaElement).value).toBe('日本語');
});

it('shows the count against the limit only from 4,500 characters', () => {
  render(<CommentComposer members={[]} isBusy={false} placeholder="Reply…" onPost={vi.fn()} />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: 'a'.repeat(4_499) } });
  expect(document.getElementById('comment-limit')?.textContent).toBe('');
  fireEvent.change(input, { target: { value: 'a'.repeat(5_001) } });
  expect(document.getElementById('comment-limit')?.textContent).toBe('5,001 / 5,000 characters');
});

function data() {
  return {
    connection: new FakeBoardConnection('board'),
    user: FAKE_PERSON,
    members: [member],
    threads: [
      {
        id: 'thread',
        pinId: 'pin',
        isResolved: false,
        messages: [
          {
            id: 'mine',
            authorId: FAKE_PERSON.id,
            authorName: FAKE_PERSON.name,
            text: 'My message',
            mentions: [],
            createdAt: new Date(0).toISOString(),
          },
          {
            id: 'other',
            authorId: 'grace',
            authorName: 'Grace',
            text: 'Other message',
            mentions: [],
            createdAt: new Date(0).toISOString(),
          },
        ],
      },
    ],
    selectedId: 'thread',
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard: false,
    deleteThread: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
  } satisfies CommentData;
}

it('focuses the card, closes by Escape, and deletes only the author`s own message from its ⋯', async () => {
  const state = data();
  render(<CommentDialog data={state} canWrite />);
  expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Comment thread' }));
  expect(screen.queryByRole('button', { name: 'Close comment thread' })).toBeNull();
  // The thread's ⋯ holds Delete thread alone; each own message has its own ⋯.
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
    'Delete thread',
  ]);
  const [mine] = screen.getAllByRole('listitem');
  if (!mine) throw new Error('no message');
  expect(screen.getAllByRole('button', { name: 'Message actions' })).toHaveLength(1);
  const actions = within(mine).getByRole('button', { name: 'Message actions' });
  fireEvent.click(actions);
  expect(screen.queryByRole('menuitem', { name: 'Delete thread' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete message' }));
  expect(state.change).not.toHaveBeenCalled();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Confirm: Delete message');
  expect(mine.contains(document.activeElement)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm: Delete message' }));
  await waitFor(() => {
    expect(state.change).toHaveBeenCalledWith('/thread/messages/mine', undefined, 'DELETE');
  });
  expect(document.activeElement).toBe(screen.getByRole('dialog'));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(state.close).toHaveBeenCalledOnce();
  state.connection.store.destroy();
});

it('keeps the card and its reply open on the Escape that cancels a Safari composition', () => {
  const state = data();
  render(<CommentDialog data={state} canWrite />);
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: '日本' } });
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
  expect(state.close).not.toHaveBeenCalled();
  expect((input as HTMLTextAreaElement).value).toBe('日本');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(state.close).toHaveBeenCalledTimes(1);
});

it('cancels a deletion, and offers no ⋯ to someone with no message in the thread', () => {
  const state = data();
  const view = render(<CommentDialog data={state} canWrite />);
  fireEvent.click(screen.getByRole('button', { name: 'Message actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete message' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel: Delete message' }));
  expect(screen.queryByRole('button', { name: 'Confirm: Delete message' })).toBeNull();
  expect(state.change).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Message actions' }));
  view.rerender(
    <CommentDialog data={{ ...state, user: { ...FAKE_PERSON, id: 'stranger' } }} canWrite />,
  );
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Message actions' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Resolve' })).toBeDefined();
  state.connection.store.destroy();
});

it('deletes the thread its starter or an editor confirms, and nobody else is offered it', async () => {
  const state = { ...data(), deleteThread: vi.fn().mockResolvedValue(undefined) };
  const view = render(<CommentDialog data={state} canWrite />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete thread' }));
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Confirm: Delete thread');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel: Delete thread' }));
  expect(screen.queryByRole('group', { name: 'Delete this thread?' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete thread' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm: Delete thread' }));
  await waitFor(() => {
    expect(state.deleteThread).toHaveBeenCalledWith(state.threads[0]);
  });
  // An editor who wrote nothing in it may delete it; a commenter who did not start it may not.
  const stranger = { ...FAKE_PERSON, id: 'stranger' };
  view.rerender(<CommentDialog data={{ ...state, user: stranger, canEditBoard: true }} canWrite />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual([
    'Delete thread',
  ]);
  view.rerender(
    <CommentDialog
      data={{ ...state, user: { ...FAKE_PERSON, id: 'grace' }, canEditBoard: false }}
      canWrite
    />,
  );
  expect(screen.queryByRole('menuitem', { name: 'Delete thread' })).toBeNull();
  // The starter the service records wins over the first message.
  const threads = state.threads.map((entry) => ({ ...entry, starterId: 'grace' }));
  view.rerender(<CommentDialog data={{ ...state, threads }} canWrite />);
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  view.rerender(
    <CommentDialog data={{ ...state, threads, user: { ...FAKE_PERSON, id: 'grace' } }} canWrite />,
  );
  if (screen.queryByRole('menu') === null) {
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
  }
  expect(screen.getByRole('menuitem', { name: 'Delete thread' })).toBeDefined();
  state.connection.store.destroy();
});

it('opens beside its pin, 8 px to its right, and on its left near the right edge', () => {
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(288);
  const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
  const state = data();
  const viewport = { width: 1280, height: 800 };
  const view = render(
    <CommentDialog data={state} canWrite anchor={{ x: 100, y: 300 }} viewport={viewport} />,
  );
  const card = screen.getByRole('dialog');
  expect([card.style.left, card.style.top, card.dataset.side]).toEqual(['136px', '272px', 'right']);
  view.rerender(
    <CommentDialog data={state} canWrite anchor={{ x: 1200, y: 300 }} viewport={viewport} />,
  );
  expect([card.style.left, card.style.top, card.dataset.side]).toEqual(['904px', '272px', 'left']);
  width.mockRestore();
  height.mockRestore();
  state.connection.store.destroy();
});

it('resolves/reopens existing threads and posts replies without a new pin', async () => {
  const state = data();
  const view = render(<CommentDialog data={state} canWrite />);
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  expect(state.change).toHaveBeenCalledWith('/thread/resolve');
  // Resolving closes the card (the approved design).
  await waitFor(() => {
    expect(state.close).toHaveBeenCalledOnce();
  });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Reply' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => {
    expect(state.change).toHaveBeenCalledWith('/thread/messages', { text: 'Reply', mentions: [] });
  });
  view.rerender(
    <CommentDialog
      data={{ ...state, threads: state.threads.map((thread) => ({ ...thread, isResolved: true })) }}
      canWrite
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  expect(state.change).toHaveBeenCalledWith('/thread/reopen', undefined, undefined);
  state.connection.store.destroy();
});

it('keeps the card open when resolving fails, so its error shows and Resolve can be tried again', async () => {
  const state = { ...data(), change: vi.fn().mockRejectedValue(new Error('offline')) };
  render(<CommentDialog data={state} canWrite />);
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
  await waitFor(() => {
    expect(state.change).toHaveBeenCalledWith('/thread/resolve');
  });
  await Promise.resolve();
  expect(state.close).not.toHaveBeenCalled();
  state.connection.store.destroy();
});

it('posts a first message for its pending pin and displays errors', async () => {
  const state = {
    ...data(),
    selectedId: undefined,
    placement: {
      id: 'new-pin' as ObjectId,
      point: { x: 1, y: 2 },
      anchor: { kind: 'point' as const },
    },
    error: 'Try again',
  };
  render(<CommentDialog data={state} canWrite />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'First' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post' }));
  await waitFor(() => {
    expect(state.change).toHaveBeenCalledWith('', {
      text: 'First',
      mentions: [],
      pinId: 'new-pin',
      pin: { pageId: 'page-1', anchor: { kind: 'point' }, point: { x: 1, y: 2 } },
    });
  });
  expect(screen.getByRole('alert').textContent).toBe('Try again');
  expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('Add a comment…');
  // A thread not yet posted has nothing to resolve.
  expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  state.connection.store.destroy();
});

/**
 * The board menu, where the threads panel's toggle is.
 *
 * @returns The menu button.
 */
function Menu(): ReactElement {
  return (
    <BoardMenu
      actions={[]}
      state={INITIAL_SHELL_STATE}
      themePreference="system"
      dispatch={vi.fn()}
      onThemeChange={vi.fn()}
    />
  );
}

it('keeps viewers read-only and controls optional site toolbar placement', () => {
  const state = data();
  const view = render(
    <>
      <CommentDialog data={state} canWrite={false} />
      <CommentTool isAvailable />
      <Menu />
    </>,
  );
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete message' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  expect(screen.queryByRole('menuitemcheckbox', { name: 'Comments' })).toBeNull();
  const mode = {
    canWrite: true,
    isPlacing: false,
    isPanelOpen: false,
    setPlacing: vi.fn(),
    togglePanel: vi.fn(),
  };
  view.rerender(
    <commentContext.Provider value={mode}>
      <CommentTool isAvailable />
      <Menu />
    </commentContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(mode.setPlacing).toHaveBeenCalledWith(true);
  // The threads panel's toggle is in the board menu since removed the old toolbar.
  fireEvent.click(screen.getByRole('button', { name: 'Board menu' }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Comments' }));
  expect(mode.togglePanel).toHaveBeenCalledOnce();
  view.rerender(
    <commentContext.Provider value={{ ...mode, canWrite: false }}>
      <CommentTool isAvailable />
      <Menu />
    </commentContext.Provider>,
  );
  expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  state.connection.store.destroy();
});
