import { expect, it, vi } from 'vitest';

import { createHistory, createLinkCard } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import type { CanvasAction } from '../state/shell-action.js';

import { createDemoDocument, LOCAL_USER_ORIGIN } from './demo-document.js';
import { EngineDocument } from './engine-document.js';

/**
 * The demo board with a pending link card, through an engine document.
 *
 * @returns The store, its history, the document and the card.
 */
function setUp() {
  const store = createDemoDocument();
  const history = createHistory(store, LOCAL_USER_ORIGIN.principalId);
  const document = new EngineDocument({
    store,
    history,
    origin: LOCAL_USER_ORIGIN,
    environment: { clock: () => 1_790_000_000_000, createId: () => 'new' as ObjectId },
    onChange: vi.fn(),
    onCommandRefused: vi.fn(),
    onNotice: vi.fn(),
  });
  const url = 'https://example.com/story';
  const card = createLinkCard(store, { url, x: 0, y: 0, unfurlKey: 'k' }, LOCAL_USER_ORIGIN);
  return { store, history, document, card, url };
}

it('switches a link card’s layout as one undo step', () => {
  const { store, history, document, card } = setUp();
  const action: CanvasAction = {
    type: 'linkCard',
    id: card,
    change: { kind: 'layout', layout: 'horizontal' },
  };
  expect(document.runCanvasAction(action, 1)).toBe(true);
  expect(store.get(card)).toMatchObject({ layout: 'horizontal', width: 440, height: 120 });
  expect(history.undo()).toBe(true);
  expect(store.get(card)).toMatchObject({ layout: 'vertical', width: 320, height: 280 });
  document.destroy();
  history.destroy();
  store.destroy();
});

it('turns a link card into its link as a text, in its place', () => {
  const { store, history, document, card, url } = setUp();
  expect(
    document.runCanvasAction({ type: 'linkCard', id: card, change: { kind: 'toText' } }, 1),
  ).toBe(true);
  expect(store.get(card)).toBeUndefined();
  const text = [...store.read().objects.values()].find(
    (object) => object.type === 'text' && object.text === url,
  );
  expect(text?.type === 'text' ? text.runs[0]?.style.link : undefined).toBe(url);
  document.destroy();
  history.destroy();
  store.destroy();
});
