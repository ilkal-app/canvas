// CONTRACT: agent attribution and per-message deletion ownership.
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';

import { FAKE_PERSON } from './__fixtures__/fake-member-directory.js';
import type { Message } from './comment-api.js';
import type { CommentData } from './comment-data-context.js';
import { CommentDialog } from './comment-dialog.js';

const CREATED_AT = '2026-10-12T09:00:00.000Z';

/**
 * A future API message, including the attribution fields.
 *
 * @param id - The message id.
 * @param authorKind - The author type.
 * @param operatorId - The operator for an agent.
 * @param authorId - The person author, if any.
 * @returns The message.
 */
function message(
  id: string,
  authorKind: 'agent' | 'user',
  operatorId: string | null,
  authorId: string | null,
): Message {
  return {
    id,
    authorKind,
    authorId,
    authorName: authorKind === 'agent' ? 'Planner' : 'Person',
    operatorId,
    operatorName: operatorId === null ? null : 'Ada',
    text: id,
    mentions: [],
    createdAt: CREATED_AT,
  };
}

/**
 * The dialog's fixture with a person's and two agents' messages.
 *
 * @returns The dialog data.
 */
function data(): CommentData {
  return {
    connection: new FakeBoardConnection('board'),
    user: FAKE_PERSON,
    members: [],
    threads: [
      {
        id: 'thread',
        pinId: 'pin',
        isResolved: false,
        messages: [
          message('mine', 'user', null, FAKE_PERSON.id),
          message('my-agent', 'agent', FAKE_PERSON.id, null),
          message('other-agent', 'agent', 'other', null),
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
  };
}

afterEach(cleanup);

describe('agent messages in the comment dialog', () => {
  it('shows the agent name, accessible Agent badge, presence agent icon and operator', () => {
    const state = data();
    render(<CommentDialog data={state} canWrite />);
    const item = screen.getByText('my-agent').closest('li');
    expect(item).not.toBeNull();
    expect(item?.textContent).toContain('Planner');
    expect(item?.textContent).toContain('Agent');
    expect(item?.textContent).toContain('for Ada');
    expect(item?.querySelector('[data-kind="agent"]')).not.toBeNull();
    expect(item?.querySelector('[aria-label*="agent" i]')).not.toBeNull();
    state.connection.store.destroy();
  });

  it('offers deletion for the viewer’s own person and agent messages but not another operator’s', () => {
    const state = data();
    render(<CommentDialog data={state} canWrite />);
    const row = (id: string): HTMLElement => {
      const item = screen.getByText(id).closest('li');
      if (!item) throw new Error(`Missing ${id} row`);
      return item;
    };
    for (const id of ['mine', 'my-agent']) {
      const actions = row(id).querySelector('button[aria-label="Message actions"]');
      expect(actions).not.toBeNull();
      fireEvent.click(actions as HTMLButtonElement);
      expect(screen.getByRole('menuitem', { name: 'Delete message' })).toBeTruthy();
      fireEvent.keyDown(screen.getByRole('menu', { name: 'Message actions' }), {
        key: 'Escape',
      });
    }
    expect(row('other-agent').querySelector('button[aria-label="Message actions"]')).toBeNull();
    state.connection.store.destroy();
  });
});
