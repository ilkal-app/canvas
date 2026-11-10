// @vitest-environment jsdom
// The follow UI: the person menu (F1, F7), the follow frame and its chip (F3, F4) and,
// on a phone, the people sheet (P1, P2), over a fake board connection.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PresenceClientId, PresenceSpotlight, PresenceState } from '@canvas/collab';

import { AccountMenu } from '../account/account-menu.js';
import type { CameraSource } from '../editing/camera-source.js';
import type { MountedEngine } from '../engine/mounted-engine.js';

import type { BoardConnection } from './board-connection.js';
import { FollowFrame } from './follow-frame.js';
import { PresenceAvatars } from './presence-avatars.js';
import type { PresencePerson } from './presence-people.js';
import { CameraInputProvider, CameraInputSignal, FollowProvider } from './use-follow.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

const VIEWPORT = { x: 0, y: 0, w: 800, h: 600, zoom: 1 };

/**
 * A person's presence.
 *
 * @param id - Their principal id.
 * @param name - Their name.
 * @param fields - Fields to change.
 * @returns The state.
 */
function state(id: string, name: string, fields: Partial<PresenceState> = {}): PresenceState {
  return {
    principal: { id, kind: 'user', name, color: '#0090ff' },
    viewport: VIEWPORT,
    updatedAt: 1,
    ...fields,
  };
}

const ANA: PresencePerson = {
  principalId: 'ana',
  kind: 'user',
  name: 'Ana Silva',
  initials: 'AS',
  color: '#0090ff',
};
const CLAUDE: PresencePerson = {
  principalId: 'claude',
  kind: 'agent',
  name: 'Claude',
  initials: 'C',
  color: '#8e4ec6',
};

/**
 * A board with presence: Ana with a view, an agent without one, and what the person shares.
 *
 * @param isReadOnly - Whether the person may only look.
 * @returns The connection, and what it was told.
 */
function fakeBoard(isReadOnly = false) {
  const listeners = new Set<() => void>();
  let local = state('me', 'Vivek H');
  let remote = new Map<PresenceClientId, PresenceState>([
    [2, state('ana', 'Ana Silva')],
    [
      3,
      {
        principal: { id: 'claude', kind: 'agent', name: 'Claude', color: '#8e4ec6' },
        updatedAt: 1,
      },
    ],
  ]);
  const told = { following: [] as (string | null)[] };
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const connection = {
    status: () => ({ isReadOnly }),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    localPresence: () => ({ clientId: 1, state: local }),
    remotePresence: () => remote,
    showSpotlight: (spotlight: PresenceSpotlight | null) => {
      local = spotlight === null ? state('me', 'Vivek H') : { ...local, spotlight };
      notify();
    },
    showFollowing: (principalId: string | null) => {
      told.following.push(principalId);
    },
  } as unknown as BoardConnection;
  const setRemote = (next: Map<PresenceClientId, PresenceState>): void => {
    remote = next;
    notify();
  };
  return { connection, told, setRemote };
}

const camera = {
  read: () => ({ x: 0, y: 0, zoom: 1, viewportWidthPx: 800, viewportHeightPx: 600 }),
  write: () => undefined,
  subscribe: () => () => undefined,
} as unknown as CameraSource;

const pagesShown: string[] = [];

const engine = {
  camera: () => ({ x: 0, y: 0, zoom: 1 }),
  jumpCamera: () => undefined,
  pages: { show: (pageId: string) => pagesShown.push(pageId) },
} as unknown as MountedEngine;

/**
 * Gives the page a viewport below 768 px wide (the phone), or not.
 *
 * @param isPhone - Whether it is a phone.
 */
function setPhone(isPhone: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: isPhone && query.startsWith('(width <'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

/**
 * Renders the avatars and the frame under a follow provider.
 *
 * @param connection - The board.
 * @param cameraInput - The person's own camera moves, which stop a follow; none if absent.
 */
function renderFollow(connection: BoardConnection, cameraInput?: CameraInputSignal): void {
  render(
    <CameraInputProvider value={cameraInput}>
      <FollowProvider connection={connection} engine={engine} camera={camera}>
        <PresenceAvatars people={[ANA, CLAUDE]} />
        <FollowFrame />
      </FollowProvider>
    </CameraInputProvider>,
  );
}

describe('the follow UI on a desktop', () => {
  it('follows from the person menu, shows the chip and stops on Stop', () => {
    setPhone(false);
    const { connection, told } = fakeBoard();
    renderFollow(connection);
    fireEvent.click(screen.getByRole('button', { name: 'Ana Silva' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Follow Ana/u }));
    const chip = screen.getByRole('group', { name: 'Following Ana Silva' });
    expect(told.following).toEqual(['ana']);
    fireEvent.click(within(chip).getByRole('button', { name: 'Stop' }));
    expect(screen.queryByRole('group', { name: 'Following Ana Silva' })).toBeNull();
    expect(told.following).toEqual(['ana', null]);
  });
});

describe('the follow UI around its edges', () => {
  it('stops following from the menu, and stops on the person moving the camera', () => {
    setPhone(false);
    const { connection, told } = fakeBoard();
    const cameraInput = new CameraInputSignal();
    renderFollow(connection, cameraInput);
    fireEvent.click(screen.getByRole('button', { name: 'Ana Silva' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Follow Ana/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Ana Silva' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop following' }));
    expect(told.following).toEqual(['ana', null]);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Ana Silva' }));
    expect(screen.getByRole('group', { name: 'Following Ana Silva' })).toBeTruthy();
    act(() => {
      cameraInput.emit();
    });
    expect(screen.queryByRole('group', { name: 'Following Ana Silva' })).toBeNull();
  });

  it('says why an agent cannot be followed', () => {
    setPhone(false);
    const { connection } = fakeBoard();
    renderFollow(connection);
    fireEvent.click(screen.getByRole('button', { name: 'Claude, agent' }));
    const item = screen.getByRole('menuitem', { name: /Follow/u });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Agents have no view to follow yet');
  });

  it("follows a spotlight onto its page with a toast, and ends one's own from the chip", () => {
    setPhone(false);
    pagesShown.length = 0;
    const { connection, setRemote } = fakeBoard();
    renderFollow(connection);
    act(() => {
      setRemote(
        new Map([[2, state('ana', 'Ana Silva', { page: 'p2', spotlight: { startedAt: 9 } })]]),
      );
    });
    expect(pagesShown).toEqual(['p2']);
    expect(screen.getByRole('group', { name: "Ana Silva's spotlight" })).toBeTruthy();
    expect(screen.getByText(/Ana Silva started a spotlight/u)).toBeTruthy();
  });
});

describe('Spotlight me in the account menu (frames F2, F8)', () => {
  const account = {
    principalId: 'me',
    name: 'Vivek H',
    email: 'vivek@example.com',
    onSettings: () => undefined,
    onBoards: () => undefined,
    onSignOut: () => undefined,
  };

  /**
   * Renders the account menu and the frame under a follow provider, its menu open.
   *
   * @param connection - The board.
   */
  function renderAccount(connection: BoardConnection): void {
    render(
      <FollowProvider connection={connection} engine={engine} camera={camera}>
        <AccountMenu account={account} />
        <FollowFrame />
      </FollowProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account: Vivek H' }));
  }

  it('starts and ends the spotlight', () => {
    setPhone(false);
    renderAccount(fakeBoard().connection);
    const start = screen.getByRole('menuitem', { name: /Spotlight me/u });
    expect(start.textContent).toContain('Everyone here follows your view');
    fireEvent.click(start);
    expect(screen.getByRole('group', { name: 'Spotlight' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Account: Vivek H' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'End spotlight' }));
    expect(screen.queryByRole('group', { name: 'Spotlight' })).toBeNull();
  });

  it('says why a viewer cannot spotlight', () => {
    setPhone(false);
    renderAccount(fakeBoard(true).connection);
    const item = screen.getByRole('menuitem', { name: /Spotlight me/u });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.textContent).toContain('Only editors and the owner can spotlight');
  });
});

describe('the "+N" list on a desktop', () => {
  it('follows someone past the avatars, and stops following them', () => {
    setPhone(false);
    const { connection, told, setRemote } = fakeBoard();
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    setRemote(new Map(ids.map((id, index) => [index + 2, state(id, id.toUpperCase())])));
    const people = ids.map((id): PresencePerson => ({
      principalId: id,
      kind: 'user',
      name: id.toUpperCase(),
      initials: id.toUpperCase(),
      color: '#0090ff',
    }));
    render(
      <FollowProvider connection={connection} engine={engine} camera={camera}>
        <PresenceAvatars people={people} />
        <FollowFrame />
      </FollowProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '2 more on this board' }));
    const list = screen.getByRole('listbox', { name: 'Also on this board' });
    const p6 = within(list).getByRole('option', { name: /P6/u });
    expect(p6.textContent).toContain('Follow');
    fireEvent.keyDown(p6, { key: 'Enter' });
    expect(told.following).toEqual(['p6']);
    expect(screen.getByRole('group', { name: 'Following P6' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '2 more on this board' }));
    fireEvent.click(screen.getByRole('option', { name: /P6/u }));
    expect(told.following).toEqual(['p6', null]);
    fireEvent.click(screen.getByRole('button', { name: '2 more on this board' }));
    fireEvent.keyDown(screen.getByRole('option', { name: /P5/u }), { key: ' ' });
    expect(told.following).toEqual(['p6', null, 'p5']);
  });
});

describe('the follow UI on a phone', () => {
  it('opens the people sheet from the avatars and follows from it, the chip centred', () => {
    setPhone(true);
    const { connection, told } = fakeBoard();
    renderFollow(connection);
    fireEvent.click(screen.getByRole('button', { name: 'People on this board, 2' }));
    const sheet = screen.getByRole('dialog', { name: 'On this board · 3' });
    expect(within(sheet).getByText('Vivek H (you)')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Spotlight me' })).toBeTruthy();
    expect(within(sheet).getByText(/no view to follow/u)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Follow Ana Silva' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(told.following).toEqual(['ana']);
    const frame = screen.getByRole('group', { name: 'Following Ana Silva' }).parentElement;
    expect(frame?.dataset.compact).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'People on this board, 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop following' }));
    expect(told.following).toEqual(['ana', null]);
  });

  it('says how many follow the local spotlight, and ends it from the sheet', () => {
    setPhone(true);
    const { connection, setRemote } = fakeBoard();
    renderFollow(connection);
    fireEvent.click(screen.getByRole('button', { name: 'People on this board, 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Spotlight me' }));
    act(() => {
      setRemote(new Map([[2, state('ana', 'Ana Silva', { following: 'me' })]]));
    });
    expect(screen.getByRole('group', { name: 'Spotlight' }).textContent).toContain(
      "You're spotlighting · 1 following",
    );
    // The avatars are given (not read from presence here): still two.
    fireEvent.click(screen.getByRole('button', { name: 'People on this board, 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'End spotlight' }));
    expect(screen.queryByRole('group', { name: 'Spotlight' })).toBeNull();
  });

  it("ends one's own spotlight from the chip's Stop", () => {
    setPhone(true);
    const { connection } = fakeBoard();
    renderFollow(connection);
    fireEvent.click(screen.getByRole('button', { name: 'People on this board, 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Spotlight me' }));
    const chip = screen.getByRole('group', { name: 'Spotlight' });
    fireEvent.click(within(chip).getByRole('button', { name: 'Stop' }));
    expect(screen.queryByRole('group', { name: 'Spotlight' })).toBeNull();
  });

  it('says why a viewer cannot spotlight', () => {
    setPhone(true);
    const { connection } = fakeBoard(true);
    renderFollow(connection);
    fireEvent.click(screen.getByRole('button', { name: 'People on this board, 2' }));
    expect(screen.queryByRole('button', { name: 'Spotlight me' })).toBeNull();
    expect(screen.getByText('Only editors and the owner can spotlight')).toBeTruthy();
  });
});
