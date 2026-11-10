import { describe, expect, it } from 'vitest';

import type { TextStyle } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { applyLinkUnfurl, createLinkCard, runCommand, setLinkLayout } from '../index.js';
import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { linkCardToTextCommand, retryLinkUnfurlCommand } from './link-card-edits.js';
import { FAILED_LINK_CARD_HEIGHT } from './link-card-sizes.js';

const URL = 'https://example.com/story';
const STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1],
  weight: 400,
  italic: false,
};

/**
 * A board with one pending card at (100, 100).
 *
 * @returns The store and the card's id.
 */
function withCard() {
  const store = createFixtureStore();
  const id = createLinkCard(store, { url: URL, x: 100, y: 100, unfurlKey: 'k' }, ADA);
  return { store, id };
}

describe('link card sizes', () => {
  it('makes a failed card compact, and a layout switch takes the layout’s size', () => {
    const { store, id } = withCard();
    applyLinkUnfurl(store, id, { unfurlKey: 'k', outcome: { status: 'failed' } }, ADA);
    expect(store.get(id)).toMatchObject({ width: 320, height: FAILED_LINK_CARD_HEIGHT });
    setLinkLayout(store, [id], 'horizontal', ADA);
    expect(store.get(id)).toMatchObject({ width: 440, height: FAILED_LINK_CARD_HEIGHT });
    const ready = withCard();
    const outcome = { status: 'ready' as const, title: 'Story', description: '', siteName: '' };
    applyLinkUnfurl(ready.store, ready.id, { unfurlKey: 'k', outcome }, ADA);
    setLinkLayout(ready.store, [ready.id], 'horizontal', ADA);
    expect(ready.store.get(ready.id)).toMatchObject({ x: 100, y: 100, width: 440, height: 120 });
  });
});

describe('retryLinkUnfurl', () => {
  it('puts a failed card back to pending under a new key, at full size', () => {
    const { store, id } = withCard();
    applyLinkUnfurl(store, id, { unfurlKey: 'k', outcome: { status: 'failed' } }, ADA);
    const input = { id, unfurlKey: 'k2' };
    const outcome = runCommand(store, ADA, retryLinkUnfurlCommand, input, testEnvironment());
    expect(outcome.status).toBe('applied');
    expect(store.get(id)).toMatchObject({ status: 'pending', unfurlKey: 'k2', height: 280 });
  });

  it('refuses a card that has not failed, and an object that is not a card', () => {
    const { store, id } = withCard();
    const pending = runCommand(
      store,
      ADA,
      retryLinkUnfurlCommand,
      { id, unfurlKey: 'k2' },
      testEnvironment(),
    );
    expect(pending.status).toBe('rejected');
    const missing = runCommand(
      store,
      ADA,
      retryLinkUnfurlCommand,
      {
        id: 'text-title',
        unfurlKey: 'k2',
      },
      testEnvironment(),
    );
    expect(missing.status).toBe('rejected');
  });
});

describe('linkCardToText', () => {
  it('replaces the card with its title linked to its page, in one undo step', () => {
    const { store, id } = withCard();
    const outcome = { status: 'ready' as const, title: 'Story', description: '', siteName: '' };
    applyLinkUnfurl(store, id, { unfurlKey: 'k', outcome }, ADA);
    const history = createHistory(store, ADA.principalId, { captureTimeout: 0 });
    const result = runCommand(
      store,
      ADA,
      linkCardToTextCommand,
      { id, style: STYLE },
      testEnvironment(),
    );
    if (result.status !== 'applied') throw new Error('refused');
    expect(store.get(id)).toBeUndefined();
    const text = store.get(result.result.id);
    expect(text).toMatchObject({ type: 'text', text: 'Story', autoWidth: true });
    expect(text?.type === 'text' ? text.runs[0]?.style.link : undefined).toBe(URL);
    expect(history.undo()).toBe(true);
    expect(store.get(id)).toMatchObject({ type: 'link' });
    expect(store.get(result.result.id)).toBeUndefined();
  });

  it('uses the URL where the page gave no title', () => {
    const { store, id } = withCard();
    const result = runCommand(
      store,
      ADA,
      linkCardToTextCommand,
      { id, style: STYLE },
      testEnvironment(),
    );
    if (result.status !== 'applied') throw new Error('refused');
    expect(store.get(result.result.id)).toMatchObject({ text: URL });
  });

  it('refuses an object that is not a card', () => {
    const store = createFixtureStore();
    const outcome = runCommand(
      store,
      ADA,
      linkCardToTextCommand,
      {
        id: 'text-title',
        style: STYLE,
      },
      testEnvironment(),
    );
    expect(outcome.status).toBe('rejected');
  });
});
