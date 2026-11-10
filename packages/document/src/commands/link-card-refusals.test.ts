import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '@canvas/schema';

import {
  applyLinkUnfurl,
  createLinkCard,
  runCommand,
  setLinkLayout,
  SYSTEM_ORIGIN,
} from '../index.js';
import { ADA, createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { linkCardToTextCommand } from './link-card-edits.js';
import { applyLinkUnfurlCommand, setLinkLayoutCommand } from './link-card.js';
import { COMMANDS } from './registry.js';

const STYLE = {
  fontFamily: 'Inter',
  fontSize: 16,
  color: [0, 0, 0, 1] as [number, number, number, number],
  weight: 400 as const,
  italic: false,
};

describe('link card refusals', () => {
  it('throws for a card the command refuses, a system writer, or an object that is not a card', () => {
    const store = createFixtureStore();
    expect(() =>
      createLinkCard(store, { url: 'ftp://example.com/', x: 0, y: 0, unfurlKey: 'k' }, ADA),
    ).toThrow(RangeError);
    const outcome = { status: 'failed' as const };
    expect(() =>
      applyLinkUnfurl(store, 'link-card' as never, { unfurlKey: 'k', outcome }, SYSTEM_ORIGIN),
    ).toThrow(/writes no preview/u);
    expect(() =>
      applyLinkUnfurl(store, 'text-title' as never, { unfurlKey: 'k', outcome }, ADA),
    ).toThrow(/no link card/u);
    expect(() => setLinkLayout(store, ['text-title' as never], 'horizontal', ADA)).toThrow(
      /no link card/u,
    );
  });

  it('refuses each command for an object that is not a link card', () => {
    const store = createFixtureStore();
    const environment = testEnvironment();
    const unfurl = runCommand(
      store,
      ADA,
      applyLinkUnfurlCommand,
      { id: 'text-title', unfurlKey: 'k', outcome: { status: 'failed' } },
      environment,
    );
    const layout = runCommand(
      store,
      ADA,
      setLinkLayoutCommand,
      { ids: ['link-card', 'text-title'], layout: 'horizontal' },
      environment,
    );
    expect([unfurl.status, layout.status]).toEqual(['rejected', 'rejected']);
  });

  it('keeps the icon’s size with its asset', () => {
    const store = createFixtureStore();
    const id = createLinkCard(
      store,
      { url: 'https://example.com/', x: 0, y: 0, unfurlKey: 'k' },
      ADA,
      testEnvironment(),
    );
    const outcome = {
      status: 'ready' as const,
      title: 'T',
      description: '',
      siteName: '',
      faviconAssetId: 'asset-icon',
      faviconSize: { width: 32, height: 32 },
    };
    expect(applyLinkUnfurl(store, id, { unfurlKey: 'k', outcome }, ADA, testEnvironment())).toBe(
      true,
    );
    expect(store.get(id)).toMatchObject({ faviconSize: { width: 32, height: 32 } });
  });

  it('turns a card in a frame into a text in that frame', () => {
    const store = createFixtureStore();
    const environment = testEnvironment();
    const card = {
      type: 'link' as const,
      parentId: null,
      x: 10,
      y: 10,
      rotation: 0,
      locked: false,
      width: 320,
      height: 280,
      url: 'https://example.com/',
      title: 'In a frame',
      description: '',
      siteName: '',
      layout: 'vertical' as const,
      status: 'ready' as const,
      unfurlKey: 'k',
    };
    const created = runCommand(
      store,
      ADA,
      COMMANDS.createObjects,
      { objects: [card], parentId: 'frame-plan' },
      environment,
    );
    if (created.status !== 'applied') throw new Error('refused');
    const [id] = created.result.ids;
    const result = runCommand(
      store,
      ADA,
      linkCardToTextCommand,
      { id: id ?? '', style: STYLE },
      environment,
    );
    if (result.status !== 'applied') throw new Error('refused');
    expect(store.get(result.result.id)).toMatchObject({
      type: 'text',
      text: 'In a frame',
      parentId: 'frame-plan',
    });
  });
});

describe('link card edits a card refuses', () => {
  /**
   * Puts a ready link card on the board's root.
   *
   * @param store - The board.
   * @param fields - What differs from a ready vertical card at the origin.
   * @returns The card's id.
   * @throws {Error} When the board refuses the card.
   */
  function placeCard(
    store: ReturnType<typeof createFixtureStore>,
    fields: Readonly<Record<string, unknown>>,
  ): string {
    const card = {
      type: 'link' as const,
      parentId: null,
      x: 0,
      y: 0,
      rotation: 0,
      locked: false,
      width: 320,
      height: 280,
      url: 'https://example.com/',
      title: 'Example',
      description: '',
      siteName: '',
      layout: 'vertical' as const,
      status: 'ready' as const,
      unfurlKey: 'k',
      ...fields,
    };
    const created = runCommand(
      store,
      ADA,
      COMMANDS.createObjects,
      { objects: [card], parentId: null },
      testEnvironment(),
    );
    if (created.status !== 'applied') throw new Error(JSON.stringify(created.errors));
    return created.result.ids[0] ?? '';
  }

  it('refuses to turn a locked card into a text', () => {
    const store = createFixtureStore();
    const id = placeCard(store, { locked: true });
    const outcome = runCommand(
      store,
      ADA,
      linkCardToTextCommand,
      { id, style: STYLE },
      testEnvironment(),
    );
    expect(outcome.status).toBe('rejected');
    expect(store.get(id as never)?.type).toBe('link');
  });

  it('refuses a text that would reach past the board’s edge', () => {
    const store = createFixtureStore();
    const id = placeCard(store, { x: BOARD_BOUND - 320, title: 'W'.repeat(200) });
    const outcome = runCommand(
      store,
      ADA,
      linkCardToTextCommand,
      { id, style: STYLE },
      testEnvironment(),
    );
    expect(outcome.status).toBe('rejected');
    expect(store.get(id as never)?.type).toBe('link');
  });

  it('leaves a pending card alone for a fetch under another key', () => {
    const store = createFixtureStore();
    const id = placeCard(store, { status: 'pending' });
    const outcome = runCommand(
      store,
      ADA,
      applyLinkUnfurlCommand,
      { id, unfurlKey: 'stale', outcome: { status: 'failed' } },
      testEnvironment(),
    );
    expect(outcome).toMatchObject({ status: 'applied', result: { isApplied: false } });
    expect(store.get(id as never)).toMatchObject({ status: 'pending', unfurlKey: 'k' });
  });
});
