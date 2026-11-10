// CONTRACT: the harness may inject a local reaction channel, while a connection's channel takes precedence.
// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ReactionChannel } from '@canvas/collab';
import { DEFAULT_PAGE_ID } from '@canvas/schema';

import { FakeBoardConnection } from '../collab/__fixtures__/fake-board-connection.js';
import { createFakeMount } from '../engine/__fixtures__/fake-mounted-engine.js';
import { createDemoDocument } from '../engine/demo-document.js';
import { parseHarnessUrlOptions } from '../harness/harness-url-options.js';
import { AppShell } from '../shell/app-shell.js';

import { useBoardReactions, type BoardReactions } from './reactions-context.js';
import { ReactionsProvider } from './reactions-provider.js';

afterEach(cleanup);

const EVENT = { emoji: '🎉', x: 100, y: 200, pageId: DEFAULT_PAGE_ID, from: 'sender-0' } as const;

/**
 * Observes the public board reactions context beneath a provider.
 *
 * @param read - The probe's callback.
 * @param read.read - Receives the latest context value.
 * @returns No visible element.
 */
function Probe({ read }: { readonly read: (value: BoardReactions | undefined) => void }): null {
  read(useBoardReactions());
  return null;
}

describe('local reaction channel', () => {
  it('reads only the local harness URL value', () => {
    expect(parseHarnessUrlOptions('?reactions=local').reactions).toBe('local');
    expect(parseHarnessUrlOptions('?reactions=x').reactions).toBeUndefined();
  });

  it('shows a received event from the injected channel without a connection', () => {
    const channel = new ReactionChannel();
    let boardReactions: BoardReactions | undefined;
    render(
      <ReactionsProvider connection={undefined} reactions={channel}>
        <Probe read={(value) => (boardReactions = value)} />
      </ReactionsProvider>,
    );
    act(() => {
      channel.receive(EVENT);
    });
    expect(boardReactions?.shown).toEqual([
      { id: 1, emoji: '🎉', x: 100, y: 200, pageId: DEFAULT_PAGE_ID, isOwn: false },
    ]);
  });

  it('prefers a connection channel over the injected channel', () => {
    const local = new ReactionChannel();
    const connected = new ReactionChannel();
    const connection = new FakeBoardConnection('board');
    Object.assign(connection, { reactions: connected });
    let boardReactions: BoardReactions | undefined;
    render(
      <ReactionsProvider connection={connection} reactions={local}>
        <Probe read={(value) => (boardReactions = value)} />
      </ReactionsProvider>,
    );
    act(() => {
      local.receive(EVENT);
    });
    expect(boardReactions?.shown).toEqual([]);
    act(() => {
      connected.receive(EVENT);
    });
    expect(boardReactions?.shown).toEqual([
      { id: 1, emoji: '🎉', x: 100, y: 200, pageId: DEFAULT_PAGE_ID, isOwn: false },
    ]);
  });

  it('passes the injected channel from AppShell to its reaction layer', async () => {
    const channel = new ReactionChannel();
    const { mount } = createFakeMount(undefined, createDemoDocument());
    render(<AppShell platform="mac" mountEngine={mount} reactions={channel} />);
    act(() => {
      channel.receive(EVENT);
    });
    await waitFor(() => {
      // jsdom's selectors miss an emoji attribute value: read the attribute instead.
      const shown = [...document.querySelectorAll('[data-reaction]')];
      expect(shown.map((element) => element.getAttribute('data-reaction'))).toEqual(['🎉']);
    });
  });
});
