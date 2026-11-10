import { describe, expect, it } from 'vitest';

import { createFixtureStore, fixtureObject, id } from '../store/__fixtures__/store-fixtures.js';

import { applyCommand, expectRejected } from './__fixtures__/command-fixtures.js';
import { setStyleCommand } from './set-style.js';

describe('setStyle of a layer opacity', () => {
  it('keeps an image’s required opacity when a patch removes it, and sets one given', () => {
    const store = createFixtureStore();
    const image = id('image-photo');
    const before = fixtureObject('image-photo', 'image').opacity;
    applyCommand(store, setStyleCommand, {
      changes: [{ id: image, style: { opacity: undefined } }],
    });
    expect(store.get(image)).toMatchObject({ opacity: before });
    applyCommand(store, setStyleCommand, { changes: [{ id: image, style: { opacity: 0.3 } }] });
    expect(store.get(image)).toMatchObject({ opacity: 0.3 });
    store.destroy();
  });

  it('still refuses opacity on a comment', () => {
    const store = createFixtureStore();
    const comment = [...store.read().objects.values()].find(({ type }) => type === 'comment');
    if (comment === undefined) throw new Error('no fixture comment');
    const errors = expectRejected(store, setStyleCommand, {
      changes: [{ id: comment.id, style: { opacity: 0.5 } }],
    });
    expect(errors.map(({ code }) => code)).toEqual(['unsupported-type']);
    store.destroy();
  });
});
