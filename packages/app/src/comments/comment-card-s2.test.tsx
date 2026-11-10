// @vitest-environment jsdom
// The floating whiteboard's pin and card (design frame B): a 28 px accent disc with
// its thread's message count, and a card headed by "Thread · N replies", its actions and Close.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import type { Message, Thread } from './comment-api.js';
import { cardTitleOf } from './comment-card-bar.js';
import {
  cardPlacement,
  CARD_GAP_PX,
  pinRect,
  PIN_SIZE_PX,
  WHITEBOARD_CARD_SPACING,
} from './comment-card-position.js';
import type { CommentData } from './comment-data-context.js';
import { CommentDialog } from './comment-dialog.js';
import { PinLayer, PLACEMENT_KEY } from './comment-pins.js';

afterEach(cleanup);

/**
 * A message by the signed-in person.
 *
 * @param id - Its id.
 * @param text - Its text.
 * @returns The message.
 */
function message(id: string, text: string): Message {
  return {
    id,
    authorId: FAKE_PERSON.id,
    authorName: FAKE_PERSON.name,
    text,
    mentions: [],
    createdAt: new Date(0).toISOString(),
  };
}

/** A thread of two messages. */
const THREAD: Thread = {
  id: 'open',
  pinId: 'pin',
  isResolved: false,
  messages: [message('a', 'Can we try this next sprint?'), message('b', 'Yes, Fridays only.')],
};

/**
 * Comment data with one thread, its actions spied on.
 *
 * @param fields - What differs.
 * @returns The data.
 */
function data(fields: Partial<CommentData> = {}): CommentData {
  return {
    connection: new FakeBoardConnection('board'),
    user: FAKE_PERSON,
    members: [],
    threads: [THREAD],
    selectedId: 'open',
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

describe('cardTitleOf', () => {
  it('counts the thread’s messages as its replies, as its pin does', () => {
    expect(cardTitleOf(THREAD)).toBe('Thread · 2 replies');
    expect(cardTitleOf({ ...THREAD, messages: [message('a', 'One')] })).toBe('Thread · 1 reply');
    expect(cardTitleOf(undefined)).toBe('New comment');
  });
});

describe('the floating whiteboard’s card', () => {
  it('is headed by its title, Resolve, ⋯ and Close, always shown', () => {
    const close = vi.fn();
    render(<CommentDialog data={data({ close })} canWrite isWhiteboard />);
    const card = screen.getByRole('dialog', { name: 'Comment thread' });
    expect(card.dataset.chrome).toBe('whiteboard');
    const bar = card.querySelector<HTMLElement>('[data-comment-card-bar]');
    if (bar === null) throw new Error('No bar.');
    expect(bar.textContent).toContain('Thread · 2 replies');
    const names = within(bar)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Resolve', 'More', 'Close']);
    // Close closes the card and gives the keyboard back to the canvas.
    const closeButton = within(bar).getByRole('button', { name: 'Close' });
    closeButton.focus();
    fireEvent.click(closeButton);
    expect(close).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.body);
  });

  it('asks to delete the thread in its own row under the bar, not in it (review)', () => {
    render(<CommentDialog data={data()} canWrite isWhiteboard />);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete thread' }));
    const question = screen.getByRole('group', { name: 'Delete this thread?' });
    const bar = question.parentElement;
    expect(bar?.dataset.commentCardBar).toBe('');
    // A direct child of the bar, which wraps it to its own row; not inside the actions.
    expect(question.closest('[data-comment-card-bar] > div')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm: Delete thread' })).toBe(
      document.activeElement,
    );
  });

  it('has only its title and Close for a viewer, and names a new comment', () => {
    const view = render(<CommentDialog data={data()} canWrite={false} isWhiteboard />);
    const bar = view.container.querySelector<HTMLElement>('[data-comment-card-bar]');
    if (bar === null) throw new Error('No bar.');
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Close']);
    view.unmount();
    const placement = {
      id: 'new' as ObjectId,
      point: { x: 1, y: 1 },
      anchor: { kind: 'point' as const },
    };
    const fresh = render(
      <CommentDialog data={data({ selectedId: undefined, placement })} canWrite isWhiteboard />,
    );
    expect(fresh.container.querySelector('[data-comment-card-bar]')?.textContent).toContain(
      'New comment',
    );
  });

  it('keeps the classic card without a bar, its actions over its edge', () => {
    const view = render(<CommentDialog data={data()} canWrite />);
    expect(view.container.querySelector('[data-comment-card-bar]')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Comment thread' }).dataset.chrome).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

describe('the floating whiteboard’s pin', () => {
  const pins = [
    { id: 'open', x: 100, y: 200, isMoving: false },
    { id: PLACEMENT_KEY, x: 300, y: 200, isMoving: false },
  ];

  it('shows its thread’s message count instead of an avatar, and a new comment’s is empty', () => {
    const view = render(
      <PinLayer
        pins={pins}
        data={data({ selectedId: undefined })}
        threadsById={new Map([[THREAD.id, THREAD]])}
        onFrame={vi.fn()}
        toWorld={(point) => point}
        isCounted
      />,
    );
    const pin = screen.getByRole('button', { name: /^Comment thread: / });
    expect(pin.dataset.variant).toBe('count');
    expect(pin.textContent.startsWith('2')).toBe(true);
    const placing = view.container.querySelector<HTMLElement>(
      '[aria-hidden="true"][data-state="open"]',
    );
    expect(placing?.dataset.variant).toBe('count');
    expect(placing?.textContent).toBe('');
  });

  it('is described by its message count, its name unchanged (review)', () => {
    render(
      <PinLayer
        pins={pins.slice(0, 1)}
        data={data({ selectedId: undefined })}
        threadsById={new Map([[THREAD.id, THREAD]])}
        onFrame={vi.fn()}
        toWorld={(point) => point}
        isCounted
      />,
    );
    const pin = screen.getByRole('button', {
      name: 'Comment thread: Can we try this next sprint?',
      description: '2 messages',
    });
    expect(pin).toBeTruthy();
  });

  it('keeps the avatar pin under the classic chrome', () => {
    render(
      <PinLayer
        pins={pins.slice(0, 1)}
        data={data({ selectedId: undefined })}
        threadsById={new Map([[THREAD.id, THREAD]])}
        onFrame={vi.fn()}
        toWorld={(point) => point}
      />,
    );
    const pin = screen.getByRole('button', { name: /^Comment thread: / });
    expect(pin.dataset.variant).toBeUndefined();
    expect(pin.querySelector('[data-comment-pin-count]')).toBeNull();
  });
});

describe('the whiteboard card’s spacing', () => {
  it('opens 12 px off its pin, 8 px higher, as frame B places it', () => {
    const pin = pinRect({ x: 400, y: 300 });
    const input = {
      pin,
      card: { width: 288, height: 180 },
      viewport: { width: 1280, height: 800 },
      insets: { top: 74, right: 12, bottom: 78, left: 12 },
    };
    expect(cardPlacement({ ...input, spacing: WHITEBOARD_CARD_SPACING })).toEqual({
      left: 400 + PIN_SIZE_PX + 12,
      top: 300 - PIN_SIZE_PX - 8,
      side: 'right',
    });
    expect(cardPlacement(input)).toEqual({
      left: 400 + PIN_SIZE_PX + CARD_GAP_PX,
      top: 300 - PIN_SIZE_PX,
      side: 'right',
    });
    // On the left, and raised over a zone, with the same gap.
    const nearRight = pinRect({ x: 1100, y: 300 });
    expect(cardPlacement({ ...input, pin: nearRight, spacing: WHITEBOARD_CARD_SPACING })).toEqual({
      left: 1100 - 12 - 288,
      top: 300 - PIN_SIZE_PX - 8,
      side: 'left',
    });
    const zone = { left: 400, top: 400, width: 600, height: 100 };
    expect(cardPlacement({ ...input, zones: [zone], spacing: WHITEBOARD_CARD_SPACING }).top).toBe(
      400 - 12 - 180,
    );
  });
});
