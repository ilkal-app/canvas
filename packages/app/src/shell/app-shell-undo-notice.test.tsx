// @vitest-environment jsdom
// Item 5 in the shell: an undo another person's change kept keeps's
// words and names nobody a Yjs client id alone points at;
// it names the one present person the relay vouches for as the writer. The outline:
// notices/notice-outlines.test.tsx; in Chrome: tooling/scenario/specs/app/undo-creation-guard.spec.ts.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PresenceSnapshot } from '@canvas/collab';
import type { ObjectId } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import type { ProtectedUndo } from '../notices/notice-outline.js';

import { AppShell } from './app-shell.js';

afterEach(cleanup);

const GENERAL = 'Nothing to undo here: this has changed since.';
const KEPT: ProtectedUndo = {
  isUndo: true,
  protection: { objectIds: ['shape-1' as ObjectId], writers: [9] },
};

describe('AppShell: an undo another person kept', () => {
  it("keeps's words and names nobody, even one presence knows by that client id", () => {
    localStorage.clear();
    const { mount, engines } = createFakeMount();
    // A connection whose presence holds client 9: its name must not reach the notice.
    const connection = Object.assign(new FakeBoardConnection('Plans00000000000000000'), {
      writerOf: () => ({ name: 'Mira', color: '#e5484d' }),
    });
    render(<AppShell platform="mac" mountEngine={mount} connection={connection} />);
    const [engine] = engines;
    act(() => {
      engine?.options.onNotice?.(GENERAL, KEPT);
    });
    const notice = screen.getByRole('status', { name: 'Notice' });
    expect(notice.textContent).toContain(GENERAL);
    expect(notice.textContent).not.toContain('Mira');
  });

  it('names the one present person the relay vouches wrote it, and outlines in their colour', () => {
    localStorage.clear();
    const { mount, engines } = createFakeMount();
    const presence: PresenceSnapshot = new Map([
      [
        101,
        {
          principal: { id: 'user-mira', kind: 'user', name: 'Mira', color: '#e5484d' },
          updatedAt: 1,
          writerClientIds: [9],
        },
      ],
    ]);
    const connection = Object.assign(new FakeBoardConnection('Plans00000000000000000'), {
      remotePresence: () => presence,
    });
    render(<AppShell platform="mac" mountEngine={mount} connection={connection} />);
    const [engine] = engines;
    act(() => {
      engine?.options.onNotice?.(GENERAL, KEPT);
    });
    const notice = screen.getByRole('status', { name: 'Notice' });
    expect(notice.textContent).toContain("Can't undo — Mira changed this since");
  });
});
