import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import { createFixtureStore } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';

const ID = 'text-title' as ObjectId;
const LINK = 'https://example.com/whole';

/**
 * The links of a text's runs.
 *
 * @param store - The store.
 * @returns Each run's link.
 * @throws {Error} When the object is not a text.
 */
function linksOf(store: ReturnType<typeof createFixtureStore>): (string | undefined)[] {
  const object = store.get(ID);
  if (object?.type !== 'text') throw new Error('Expected a text');
  return object.runs.map((run) => run.style.link);
}

describe("setStyle's textStyle link", () => {
  it('links every character, keeps the links when absent, and null removes them', () => {
    const store = createFixtureStore();
    try {
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { link: LINK } } }],
      });
      expect(linksOf(store).every((link) => link === LINK)).toBe(true);
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { weight: 700 } } }],
      });
      expect(linksOf(store).every((link) => link === LINK)).toBe(true);
      applyCommand(store, setStyleCommand, {
        changes: [{ id: ID, style: { textStyle: { link: null } } }],
      });
      expect(linksOf(store).every((link) => link === undefined)).toBe(true);
    } finally {
      store.destroy();
    }
  });

  it('refuses a link that is not a normalised http, https or mailto URL', () => {
    const store = createFixtureStore();
    try {
      expect(() =>
        applyCommand(store, setStyleCommand, {
          changes: [{ id: ID, style: { textStyle: { link: 'javascript:alert(1)' } } }],
        }),
      ).toThrow();
      expect(linksOf(store).every((link) => link === undefined)).toBe(true);
    } finally {
      store.destroy();
    }
  });
});
