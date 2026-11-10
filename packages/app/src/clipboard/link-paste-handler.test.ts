import { describe, expect, it, vi } from 'vitest';

import type { NewObject } from '@canvas/document';
import type { ObjectId } from '@canvas/schema';

import {
  loneWebLinkOf,
  newLinkCard,
  pastedLinkNotice,
  pasteLinkCard,
  retryLinkCard,
} from './link-paste-handler.js';
import type { PasteItem, PasteTarget } from './paste-handlers.js';

const URL = 'https://example.com/story';

/**
 * A text item.
 *
 * @param data - Its text.
 * @returns The item.
 */
function text(data: string): PasteItem {
  return { kind: 'string', type: 'text/plain', data };
}

/**
 * A paste target that creates at once, recording what it was asked.
 *
 * @param fields - Fields to change.
 * @returns The target and its records.
 */
function target(fields: Partial<PasteTarget> = {}) {
  const created: NewObject[][] = [];
  const applied: unknown[] = [];
  const value: PasteTarget = {
    pointer: { x: 500, y: 300 },
    viewCentre: { x: 0, y: 0 },
    createObjects: (objects, onCreated) => {
      created.push([...objects]);
      onCreated?.(['card-1' as ObjectId]);
      return true;
    },
    notify: () => undefined,
    applyLinkUnfurl: (id, update) => {
      applied.push({ id, ...update });
      return true;
    },
    ...fields,
  };
  return { value, created, applied };
}

describe('the link paste', () => {
  it('takes a lone web link, and nothing else', () => {
    expect(loneWebLinkOf('  https://example.com/a  ')).toBe('https://example.com/a');
    expect(loneWebLinkOf('http://example.org')).toBe('http://example.org/');
    expect(loneWebLinkOf('see https://example.com/a')).toBeUndefined();
    expect(loneWebLinkOf('mailto:ana@example.com')).toBeUndefined();
    expect(loneWebLinkOf('javascript:alert(1)')).toBeUndefined();
    expect(loneWebLinkOf('example.com')).toBeUndefined();
    expect(loneWebLinkOf('')).toBeUndefined();
  });

  it('makes a pending vertical card centred on the point', () => {
    expect(newLinkCard(URL, { x: 500, y: 300 }, 'k')).toMatchObject({
      type: 'link',
      x: 340,
      y: 160,
      width: 320,
      height: 280,
      url: URL,
      status: 'pending',
      layout: 'vertical',
      unfurlKey: 'k',
    });
  });

  it('pastes a card at the pointer and writes the preview the service gives', async () => {
    const unfurlLink = vi.fn(() =>
      Promise.resolve({ title: 'Story', description: 'Summary', siteName: 'Example' }),
    );
    const { value, created, applied } = target({ unfurlLink });
    expect(pasteLinkCard(text(URL), value)).toBe(true);
    expect(created[0]?.[0]).toMatchObject({ type: 'link', url: URL, status: 'pending' });
    await vi.waitFor(() => {
      expect(applied).toHaveLength(1);
    });
    expect(unfurlLink).toHaveBeenCalledWith(URL);
    const key = (created[0]?.[0] as { unfurlKey: string }).unfurlKey;
    expect(applied[0]).toEqual({
      id: 'card-1',
      unfurlKey: key,
      outcome: { status: 'ready', title: 'Story', description: 'Summary', siteName: 'Example' },
    });
  });

  it('marks the card failed when the page cannot be had, or there is no service', async () => {
    const refused = target({ unfurlLink: () => Promise.reject(new Error('private-address')) });
    pasteLinkCard(text(URL), refused.value);
    await vi.waitFor(() => {
      expect(refused.applied).toHaveLength(1);
    });
    expect(refused.applied[0]).toMatchObject({ outcome: { status: 'failed' } });
    const offline = target();
    pasteLinkCard(text(URL), offline.value);
    await vi.waitFor(() => {
      expect(offline.applied).toHaveLength(1);
    });
    expect(offline.applied[0]).toMatchObject({ outcome: { status: 'failed' } });
  });

  it('says how to paste the link as text instead', () => {
    const notices: string[] = [];
    pasteLinkCard(text(URL), target({ notify: (message) => notices.push(message) }).value);
    expect(notices).toHaveLength(1);
    expect(pastedLinkNotice('mac')).toBe('Pasted as a link card · Paste as text ⌥⇧⌘V');
    expect(pastedLinkNotice('other')).toBe('Pasted as a link card · Paste as text Ctrl+Shift+V');
    expect(pastedLinkNotice('none')).toBe('Pasted as a link card');
  });

  it('names no chord on a touch screen, and pastes at the view’s centre without a pointer', () => {
    const notices: string[] = [];
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const created: NewObject[][] = [];
    const touch = target({
      pointer: undefined,
      viewCentre: { x: 160, y: 140 },
      notify: (message) => notices.push(message),
      createObjects: (objects, onCreated) => {
        created.push([...objects]);
        onCreated?.(['card-1' as ObjectId]);
        return true;
      },
    });
    pasteLinkCard(text(URL), touch.value);
    expect(notices).toEqual(['Pasted as a link card']);
    expect(created[0]?.[0]).toMatchObject({ x: 0, y: 0 });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    pasteLinkCard(text(URL), target({ notify: (message) => notices.push(message) }).value);
    expect(notices[1]).toMatch(/^Pasted as a link card · Paste as text /u);
    vi.unstubAllGlobals();
  });

  it('says nothing and fetches nothing when the card was not created', () => {
    const notices: string[] = [];
    const unfurlLink = vi.fn(() => Promise.resolve({ title: '', description: '', siteName: '' }));
    const refused = target({
      notify: (message) => notices.push(message),
      unfurlLink,
      createObjects: (ignored, onCreated) => {
        onCreated?.([]);
        return true;
      },
    });
    expect(pasteLinkCard(text(URL), refused.value)).toBe(true);
    expect(notices).toEqual([]);
    expect(unfurlLink).not.toHaveBeenCalled();
  });

  it('retries a failed card: back to pending under a new key, then fetched again', async () => {
    const keys: string[] = [];
    const { value, applied } = target({
      retryLinkUnfurl: (id, key) => {
        keys.push(key);
        return id === 'card-1';
      },
      unfurlLink: () => Promise.resolve({ title: 'Story', description: '', siteName: '' }),
    });
    expect(retryLinkCard(value, 'card-1' as ObjectId, URL)).toBe(true);
    await vi.waitFor(() => {
      expect(applied).toHaveLength(1);
    });
    expect(applied[0]).toMatchObject({ id: 'card-1', unfurlKey: keys[0] });
    expect(retryLinkCard(value, 'gone' as ObjectId, URL)).toBe(false);
    expect(retryLinkCard(target().value, 'card-1' as ObjectId, URL)).toBe(false);
  });

  it('leaves plain text, other text and files to the other handlers', () => {
    const { value, created } = target({ isPlainText: true });
    expect(pasteLinkCard(text(URL), value)).toBe(false);
    expect(pasteLinkCard(text('a note'), target().value)).toBe(false);
    const file: PasteItem = { kind: 'file', type: 'image/png', file: new File([], 'a.png') };
    expect(pasteLinkCard(file, target().value)).toBe(false);
    expect(created).toEqual([]);
  });
});
