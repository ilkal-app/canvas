// CONTRACT: count pins track messages, the headed card preserves permission, and thread and message menus are separate.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import type { Message, Thread } from './comment-api.js';
import { cardTitleOf } from './comment-card-bar.js';
import type { CommentData } from './comment-data-context.js';
import { CommentDialog } from './comment-dialog.js';
import { PinLayer } from './comment-pins.js';

afterEach(cleanup);

function message(id: string, authorId = FAKE_PERSON.id): Message {
  return {
    id,
    authorId,
    authorName: authorId,
    text: `Message ${id}`,
    mentions: [],
    createdAt: new Date(0).toISOString(),
  };
}

function thread(messages: readonly Message[], fields: Partial<Thread> = {}): Thread {
  return { id: 'thread', pinId: 'pin', isResolved: false, messages, ...fields };
}

function data(current: Thread, fields: Partial<CommentData> = {}): CommentData {
  return {
    connection: new FakeBoardConnection('board'),
    user: FAKE_PERSON,
    members: [],
    threads: [current],
    selectedId: current.id,
    placement: undefined,
    error: '',
    isBusy: false,
    canEditBoard: true,
    deleteThread: vi.fn(),
    change: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    select: vi.fn(),
    place: vi.fn(),
    ...fields,
  };
}

function pins(current: Thread, fields: Partial<CommentData> = {}) {
  const pin = { id: current.id, x: 400, y: 300, isMoving: false };
  return render(
    <PinLayer
      pins={[pin]}
      data={data(current, { selectedId: undefined, ...fields })}
      threadsById={new Map([[current.id, current]])}
      onFrame={vi.fn()}
      toWorld={(point) => point}
      isCounted
    />,
  );
}

it('updates a count after a reply and after a message is deleted', () => {
  const first = thread([message('one')]);
  const view = pins(first);
  const pin = screen.getByRole('button', { name: 'Comment thread: Message one' });
  expect(pin.querySelector('[data-comment-pin-count]')?.textContent ?? pin.textContent).toContain(
    '1',
  );
  const second = thread([message('one'), message('two')]);
  view.rerender(
    <PinLayer
      pins={[{ id: second.id, x: 400, y: 300, isMoving: false }]}
      data={data(second, { selectedId: undefined })}
      threadsById={new Map([[second.id, second]])}
      onFrame={vi.fn()}
      toWorld={(point) => point}
      isCounted
    />,
  );
  expect(pin.textContent).toContain('2');
  const deleted = thread([message('one')]);
  view.rerender(
    <PinLayer
      pins={[{ id: deleted.id, x: 400, y: 300, isMoving: false }]}
      data={data(deleted, { selectedId: undefined })}
      threadsById={new Map([[deleted.id, deleted]])}
      onFrame={vi.fn()}
      toWorld={(point) => point}
      isCounted
    />,
  );
  expect(pin.textContent).toContain('1');
});

it('keeps overlapping threads as an avatar cluster, not a count pin', () => {
  const first = thread([message('one'), message('two')], { id: 'first' });
  const second = thread([message('three')], { id: 'second' });
  render(
    <PinLayer
      pins={[
        { id: 'first', x: 400, y: 300, isMoving: false },
        { id: 'second', x: 401, y: 301, isMoving: false },
      ]}
      data={data(first, { selectedId: undefined, threads: [first, second] })}
      threadsById={
        new Map([
          [first.id, first],
          [second.id, second],
        ])
      }
      onFrame={vi.fn()}
      toWorld={(point) => point}
      isCounted
    />,
  );
  const cluster = screen.getByRole('button', { name: '2 comment threads: zoom to them' });
  expect(cluster.dataset.variant).toBeUndefined();
  expect(cluster.textContent).toContain('2');
  expect(screen.queryByRole('button', { name: /Comment thread:/ })).toBeNull();
});

it('marks a resolved count pin as resolved, with the count variant', () => {
  pins(thread([message('one')], { isResolved: true }));
  const pin = screen.getByRole('button', { name: 'Comment thread: Message one' });
  expect(pin.dataset.state).toBe('resolved');
  expect(pin.dataset.resolved).toBe('true');
  expect(pin.dataset.variant).toBe('count');
});

it('titles a retained empty thread with zero replies', () => {
  expect(cardTitleOf(thread([]))).toBe('Thread · 0 replies');
});

it('closes the card while More is open and returns keyboard focus', () => {
  const close = vi.fn();
  render(<CommentDialog data={data(thread([message('one')]), { close })} canWrite isWhiteboard />);
  const bar = screen
    .getByRole('dialog', { name: 'Comment thread' })
    .querySelector('[data-comment-card-bar]');
  if (!bar) throw new Error('Missing card bar');
  fireEvent.click(within(bar as HTMLElement).getByRole('button', { name: 'More' }));
  expect(screen.getByRole('menu', { name: 'More' })).toBeTruthy();
  fireEvent.click(within(bar as HTMLElement).getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(document.body);
});

it('gives a viewer a title and Close without writer actions or composer', () => {
  render(<CommentDialog data={data(thread([message('one')]))} canWrite={false} isWhiteboard />);
  const dialog = screen.getByRole('dialog', { name: 'Comment thread' });
  const bar = dialog.querySelector('[data-comment-card-bar]');
  if (!bar) throw new Error('Missing card bar');
  expect(bar.textContent).toContain('Thread · 1 reply');
  expect(
    within(bar as HTMLElement)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')),
  ).toEqual(['Close']);
  expect(within(dialog).queryByRole('textbox', { name: 'Message' })).toBeNull();
});

it('lets a commenter resolve but hides More without ownership or own messages', () => {
  render(
    <CommentDialog
      data={data(thread([message('other', 'other')], { starterId: 'other' }), {
        canEditBoard: false,
      })}
      canWrite
      isWhiteboard
    />,
  );
  const bar = screen
    .getByRole('dialog', { name: 'Comment thread' })
    .querySelector('[data-comment-card-bar]');
  if (!bar) throw new Error('Missing card bar');
  expect(within(bar as HTMLElement).getByRole('button', { name: 'Resolve' })).toBeTruthy();
  expect(within(bar as HTMLElement).queryByRole('button', { name: 'More' })).toBeNull();
});

it('hides thread More on another starter’s thread while keeping own message actions', () => {
  render(
    <CommentDialog
      data={data(thread([message('other', 'other'), message('mine')], { starterId: 'other' }), {
        canEditBoard: false,
      })}
      canWrite
      isWhiteboard
    />,
  );
  const bar = screen
    .getByRole('dialog', { name: 'Comment thread' })
    .querySelector('[data-comment-card-bar]');
  if (!bar) throw new Error('Missing card bar');
  expect(within(bar as HTMLElement).getByRole('button', { name: 'Resolve' })).toBeTruthy();
  expect(within(bar as HTMLElement).queryByRole('button', { name: 'More' })).toBeNull();
  const mine = screen.getByText('Message mine').closest('li');
  const other = screen.getByText('Message other').closest('li');
  if (!mine || !other) throw new Error('Missing message row');
  fireEvent.click(within(mine as HTMLElement).getByRole('button', { name: 'Message actions' }));
  expect(
    within(screen.getByRole('menu', { name: 'Message actions' })).getByRole('menuitem', {
      name: 'Delete message',
    }),
  ).toBeTruthy();
  expect(
    within(other as HTMLElement).queryByRole('button', { name: 'Message actions' }),
  ).toBeNull();
});

it('offers a commenter Delete thread when they started it', () => {
  render(
    <CommentDialog
      data={data(thread([message('other', 'other')], { starterId: FAKE_PERSON.id }), {
        canEditBoard: false,
      })}
      canWrite
      isWhiteboard
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(
    within(screen.getByRole('menu', { name: 'More' })).getByRole('menuitem', {
      name: 'Delete thread',
    }),
  ).toBeTruthy();
});

it('keeps classic card actions outside a bar and its pin as an avatar', () => {
  const current = thread([message('one')]);
  const view = render(<CommentDialog data={data(current)} canWrite />);
  const dialog = screen.getByRole('dialog', { name: 'Comment thread' });
  expect(dialog.dataset.chrome).toBeUndefined();
  expect(dialog.querySelector('[data-comment-card-bar]')).toBeNull();
  const actions = screen.getByRole('button', { name: 'Resolve' }).parentElement;
  expect(actions?.className).toContain('actions');
  view.unmount();
  render(
    <PinLayer
      pins={[{ id: current.id, x: 400, y: 300, isMoving: false }]}
      data={data(current, { selectedId: undefined })}
      threadsById={new Map([[current.id, current]])}
      onFrame={vi.fn()}
      toWorld={(point) => point}
    />,
  );
  const pin = screen.getByRole('button', { name: 'Comment thread: Message one' });
  expect(pin.dataset.variant).toBeUndefined();
  expect(pin.querySelector('[aria-hidden="true"]')).toBeTruthy();
});
