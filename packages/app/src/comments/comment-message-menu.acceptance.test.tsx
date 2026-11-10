// CONTRACT: item 16 keeps thread deletion in More and gives each deletable message its own one-item menu and confirmation.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import type { Message, Thread } from './comment-api.js';
import type { CommentData } from './comment-data-context.js';
import { CommentDialog } from './comment-dialog.js';

const message = (id: string, authorId: string): Message => ({
  id,
  authorId,
  authorName: authorId,
  text: id,
  mentions: [],
  createdAt: new Date(0).toISOString(),
});

function show(
  fields: Partial<CommentData> = {},
  messages: Message[] = [
    message('first', FAKE_PERSON.id),
    message('reply', FAKE_PERSON.id),
    message('another person message', 'other'),
  ],
  starterId = FAKE_PERSON.id,
): CommentData {
  const thread: Thread = {
    id: 'thread',
    pinId: 'pin',
    starterId,
    isResolved: false,
    messages,
  };
  const data: CommentData = {
    connection: new FakeBoardConnection('board'),
    user: FAKE_PERSON,
    members: [],
    threads: [thread],
    selectedId: thread.id,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard: true,
    deleteThread: vi.fn().mockResolvedValue(undefined),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
    ...fields,
  };
  render(<CommentDialog data={data} canWrite isWhiteboard />);
  return data;
}

function row(id: string): HTMLElement {
  const item = screen.getByText(id).closest('li');
  if (!item) throw new Error(`Missing ${id} message`);
  return item;
}

afterEach(cleanup);

it('shows only Delete thread in More, and hides More when a commenter only owns a reply', () => {
  const data = show();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  const menu = screen.getByRole('menu', { name: 'More' });
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.getAttribute('aria-label')),
  ).toEqual(['Delete thread']);
  data.connection.store.destroy();
  cleanup();

  const commenter = show(
    { canEditBoard: false },
    [message('other', 'other'), message('reply', FAKE_PERSON.id)],
    'other',
  );
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  expect(within(row('reply')).getByRole('button', { name: 'Message actions' })).toBeTruthy();
  commenter.connection.store.destroy();
});

it('shows an action styled, visible menu button only in deletable message rows', () => {
  const data = show();
  for (const id of ['first', 'reply']) {
    const button = within(row(id)).getByRole('button', { name: 'Message actions' });
    expect(button.hidden).toBe(false);
    expect(button.className).toContain('action');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
  }
  expect(
    within(row('another person message')).queryByRole('button', { name: 'Message actions' }),
  ).toBeNull();
  data.connection.store.destroy();
});

it.each(['Enter', ' '])(
  '%s opens a message menu with focus on its sole Delete message item',
  async (key) => {
    const data = show();
    const trigger = within(row('reply')).getByRole('button', { name: 'Message actions' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key });
    // jsdom does not synthesize the native button click that follows keyboard activation.
    fireEvent.click(trigger, { detail: 0 });
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0]?.getAttribute('aria-label')).toBe('Delete message');
    expect(document.activeElement).toBe(items[0]);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    data.connection.store.destroy();
  },
);

it('confirms deletion in the chosen row, calls the message DELETE route, and returns Cancel focus', async () => {
  const change = vi.fn().mockResolvedValue(undefined);
  const data = show({ change });
  const trigger = within(row('reply')).getByRole('button', { name: 'Message actions' });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete message' }));
  expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
  const question = within(row('reply')).getByRole('group', { name: 'Delete this message?' });
  const confirm = within(question).getByRole('button', { name: 'Confirm: Delete message' });
  expect(document.activeElement).toBe(confirm);
  expect(within(row('first')).queryByRole('group', { name: 'Delete this message?' })).toBeNull();
  fireEvent.click(within(question).getByRole('button', { name: 'Cancel: Delete message' }));
  expect(document.activeElement).toBe(trigger);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete message' }));
  fireEvent.click(within(row('reply')).getByRole('button', { name: 'Confirm: Delete message' }));
  await waitFor(() => {
    expect(change).toHaveBeenCalledWith('/thread/messages/reply', undefined, 'DELETE');
  });
  data.connection.store.destroy();
});

it('allows only one menu open across thread and message actions', () => {
  const data = show();
  const threadTrigger = screen.getByRole('button', { name: 'More' });
  const messageTrigger = within(row('reply')).getByRole('button', { name: 'Message actions' });
  fireEvent.click(threadTrigger);
  expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
  fireEvent.click(messageTrigger);
  expect(screen.queryByRole('menu', { name: 'More' })).toBeNull();
  expect(screen.getByRole('menu', { name: 'Message actions' })).toBeTruthy();
  fireEvent.click(threadTrigger);
  expect(screen.queryByRole('menu', { name: 'Message actions' })).toBeNull();
  expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
  data.connection.store.destroy();
});
