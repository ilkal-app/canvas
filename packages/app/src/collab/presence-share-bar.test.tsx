// @vitest-environment jsdom
// The connection chip's tests (moved them here with the chip's notices): the state is
// still a polite live region named `Connection: <label>` with the detail as its tooltip.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BoardConnectionStatus, CollaboratorSummary } from './board-connection-status.js';
import type { ConnectionStatusSource } from './board-connection.js';
import { PresenceShareBar } from './presence-share-bar.js';

afterEach(() => {
  cleanup();
});

/** A connection whose status the test sets. */
class FakeConnection implements ConnectionStatusSource {
  #status: BoardConnectionStatus = {
    boardId: 'demo',
    state: 'connecting',
    isLocalOnly: false,
    isSavedOnDevice: true,
    pendingUpdateCount: 0,
    isAcknowledged: false,
    isReadOnly: false,
    rejectionReason: undefined,
    collaborators: [],
    strandedEdits: [],
  };
  readonly #listeners = new Set<() => void>();

  status(): BoardConnectionStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(change: Partial<BoardConnectionStatus>): void {
    this.#status = { ...this.#status, ...change };
    for (const listener of this.#listeners) listener();
  }
}

/**
 * A collaborator.
 *
 * @param principalId - Their id.
 * @param name - Their name.
 * @param kind - Person or agent.
 * @returns The summary.
 */
function peer(
  principalId: string,
  name: string,
  kind: CollaboratorSummary['kind'] = 'user',
): CollaboratorSummary {
  return { principalId, kind, name, color: '#c77ddb' };
}

describe('PresenceShareBar: the connection chip’s notices', () => {
  it('shows the connection state as a live status and follows its changes', () => {
    const connection = new FakeConnection();
    render(<PresenceShareBar connection={connection} />);
    const chip = screen.getByRole('status', { name: 'Connection: Connecting…' });
    expect(chip.dataset.state).toBe('connecting');
    expect(chip.getAttribute('aria-live')).toBe('polite');
    // The bar says Connecting while the live board loads; the name keeps the
    // chip's label.
    expect(chip.textContent).toBe('Connecting');
    act(() => {
      connection.set({ state: 'connected', collaborators: [peer('guest-9', 'guest-9')] });
    });
    // The chip's text was "Connected · 1 other"; the bar says Live and shows the avatar, and the
    // full label stays the state's name.
    expect(screen.getByRole('status', { name: 'Connection: Connected · 1 other' })).toBe(chip);
    expect(chip).toHaveProperty('textContent', 'Live');
    expect(screen.getByRole('img', { name: 'guest-9' })).toBeTruthy();
    expect(chip.dataset.state).toBe('connected');
    expect(chip.title).toBe('with guest-9');
  });

  it('marks a local-only board', () => {
    const connection = new FakeConnection();
    connection.set({ state: 'offline', isLocalOnly: true });
    render(<PresenceShareBar connection={connection} />);
    const chip = screen.getByRole('status', { name: 'Connection: Offline · local board' });
    expect(chip.dataset.localOnly).toBe('');
    expect(chip.textContent).toBe('Offline · local board');
  });

  it('says reconnecting, offline, and read-only for a person who may only look', () => {
    const connection = new FakeConnection();
    render(<PresenceShareBar connection={connection} />);
    act(() => {
      connection.set({ state: 'reconnecting' });
    });
    // Item 6: the bar says Reconnecting; the accessible name keeps the full label.
    expect(screen.getByRole('status', { name: 'Connection: Reconnecting…' }).textContent).toBe(
      'Reconnecting',
    );
    act(() => {
      connection.set({ state: 'connected', isReadOnly: true });
    });
    expect(screen.getByRole('status').textContent).toBe('Live · read-only');
  });
});

describe('PresenceShareBar: away from the relay', () => {
  it('keeps the people last seen, dimmed, while offline or reconnecting, and live ones after', () => {
    const connection = new FakeConnection();
    connection.set({
      state: 'connected',
      collaborators: [peer('jo', 'Jonas'), peer('mi', 'Mira')],
    });
    render(<PresenceShareBar connection={connection} />);
    expect(screen.getByRole('list', { name: 'On this board' })).toBeTruthy();
    // Offline, presence forgets everyone; the bar keeps who was here, dimmed.
    act(() => {
      connection.set({ state: 'offline', collaborators: [] });
    });
    expect(screen.getByRole('status').textContent).toBe('Offline');
    const lastSeen = screen.getByRole('list', { name: 'Last seen on this board' });
    expect(
      within(lastSeen)
        .getAllByRole('img')
        .map((avatar) => avatar.getAttribute('aria-label')),
    ).toEqual(['Jonas', 'Mira']);
    expect(lastSeen.parentElement?.dataset.dimmed).toBe('');
    act(() => {
      connection.set({ state: 'reconnecting' });
    });
    expect(screen.getByRole('list', { name: 'Last seen on this board' })).toBeTruthy();
    // Back: whoever presence says is here now, not dimmed.
    act(() => {
      connection.set({ state: 'connected', collaborators: [peer('mi', 'Mira')] });
    });
    const here = screen.getByRole('list', { name: 'On this board' });
    expect(
      within(here)
        .getAllByRole('img')
        .map((avatar) => avatar.title),
    ).toEqual(['Mira']);
    expect(here.parentElement?.dataset.dimmed).toBeUndefined();
  });

  it('dims nobody on a local board, and shows nobody it never saw', () => {
    const connection = new FakeConnection();
    connection.set({ state: 'offline', isLocalOnly: true });
    render(<PresenceShareBar connection={connection} />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('PresenceShareBar: people and Share', () => {
  it('shows people by their initials and colour, and agents with the agent mark', () => {
    const connection = new FakeConnection();
    connection.set({
      state: 'connected',
      collaborators: [peer('ag', 'Summariser', 'agent'), peer('jo', 'Jonas'), peer('mi', 'Mira')],
    });
    render(<PresenceShareBar connection={connection} />);
    const list = screen.getByRole('list', { name: 'On this board' });
    const avatars = within(list).getAllByRole('img');
    expect(avatars.map((avatar) => avatar.getAttribute('aria-label'))).toEqual([
      'Jonas',
      'Mira',
      'Summariser, agent',
    ]);
    expect(avatars[1]?.textContent).toBe('MI');
    expect(avatars[1]?.style.backgroundColor).toBe('rgb(199, 125, 219)');
    expect(avatars[2]?.dataset.kind).toBe('agent');
    expect(avatars[2]?.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /more on this board/ })).toBeNull();
  });

  it('counts the people who do not fit under "+N", whose list the keyboard works', () => {
    const connection = new FakeConnection();
    const names = ['Ada', 'Bea', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus'];
    connection.set({
      state: 'connected',
      collaborators: names.map((name) => peer(name.toLowerCase(), name)),
    });
    render(<PresenceShareBar connection={connection} />);
    expect(within(screen.getByRole('list')).getAllByRole('img')).toHaveLength(4);
    const more = screen.getByRole('button', { name: '3 more on this board' });
    expect(more.textContent).toBe('+3');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(more, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox', { name: 'Also on this board' });
    const options = ['Eve', 'Fay', 'Gus'].map((name) => within(list).getByRole('option', { name }));
    expect(within(list).getAllByRole('option')).toEqual(options);
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0] ?? list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1] ?? list, { key: 'End' });
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2] ?? list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0] ?? list, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('offers Share when the host does, which opens its dialog, and makes it inert on request', () => {
    const onShare = vi.fn();
    const { rerender } = render(<PresenceShareBar onShare={onShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<PresenceShareBar onShare={onShare} isShareInert />);
    expect(screen.getByText('Share').closest('[inert]')).not.toBeNull();
  });
});

describe('PresenceShareBar: the account button (item 7)', () => {
  const account = {
    principalId: 'me',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    onSettings: vi.fn(),
    onBoards: vi.fn(),
    onSignOut: vi.fn(),
  };

  it('ends the bar, after Share, and leaves the person’s own avatar out of the people', () => {
    const connection = new FakeConnection();
    connection.set({
      state: 'connected',
      collaborators: [peer('me', 'Ada Lovelace'), peer('mi', 'Mira')],
    });
    render(<PresenceShareBar connection={connection} onShare={vi.fn()} account={account} />);
    const bar = screen.getByRole('group', { name: 'Presence and sharing' });
    const buttons = within(bar).getAllByRole('button');
    expect(
      buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['Share', 'Account: Ada Lovelace']);
    const people = within(screen.getByRole('list', { name: 'On this board' })).getAllByRole('img');
    expect(people.map((avatar) => avatar.getAttribute('aria-label'))).toEqual(['Mira']);
  });

  it('shows no account button without a signed-in person, and lists everyone', () => {
    const connection = new FakeConnection();
    connection.set({ state: 'connected', collaborators: [peer('me', 'Ada Lovelace')] });
    render(<PresenceShareBar connection={connection} onShare={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^Account/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeTruthy();
  });

  it('is out of reach with Share while the layout is inert', () => {
    render(<PresenceShareBar onShare={vi.fn()} account={account} isShareInert />);
    const button = screen.getByRole('button', { name: 'Account: Ada Lovelace' });
    expect(button.closest('[inert]')).not.toBeNull();
  });
});
