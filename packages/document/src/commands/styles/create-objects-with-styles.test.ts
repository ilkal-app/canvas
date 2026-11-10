// Named styles, colour tokens and the objects that use them in one command and one
// undo step.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MAX_TEXT_STYLES, type Rgba, type Shadow } from '@canvas/schema';

import { SCOUT_FOR_ADA } from '../../history/__fixtures__/history-fixtures.js';
import { createHistory } from '../../history/undo-manager.js';
import { ADA, createFixtureStore } from '../../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../../store/yjs-document-store.js';
import {
  applyCommand,
  expectRejected,
  mustGet,
  testEnvironment,
} from '../__fixtures__/command-fixtures.js';
import { MAX_OBJECTS_PER_TRANSACTION } from '../create-objects-parts.js';
import { runCommand } from '../run-command.js';

import {
  createObjectsWithStylesCommand,
  type createObjectsWithStylesInputSchema,
} from './create-objects-with-styles.js';
import { setEffectStyleCommand, setTextStyleCommand } from './set-named-style.js';

const BODY = { fontFamily: 'Inter', fontSize: 20, weight: 400 as const, italic: false };
const LOW: Shadow = { x: 0, y: 1, blur: 2, spread: 0, color: [0, 0, 0, 0.2] };
const RED: Rgba = [1, 0, 0, 1];

/** The input, before parsing. */
type Input = z.input<typeof createObjectsWithStylesInputSchema>;

/**
 * A rectangle naming an effect style, its shadow the style's.
 *
 * @param listedId - Its id in the list.
 * @param effectStyleId - The style it names, if any.
 * @returns The entry.
 */
function rectangle(listedId: string, effectStyleId?: string): Input['objects'][number] {
  return {
    type: 'shape',
    id: listedId,
    parentId: null,
    x: 0,
    y: 0,
    width: 40,
    height: 30,
    kind: 'rectangle',
    stroke: null,
    fill: RED,
    cornerRadius: 0,
    sides: 4,
    label: null,
    ...(effectStyleId === undefined ? {} : { effectStyleId, shadow: [LOW] }),
  };
}

const codesAt = (errors: readonly { code: string; path: readonly unknown[] }[]): string[] =>
  errors.map(({ code, path }) => `${code} ${path.join('.')}`);

describe('createObjectsWithStyles', () => {
  it('writes the styles, then the objects naming them, as one undo step', () => {
    const store = createFixtureStore();
    const history = createHistory(store, ADA.principalId);
    const objectCount = store.read().objects.size;
    const { result } = applyCommand(store, createObjectsWithStylesCommand, {
      textStyles: [{ name: 'Body', value: BODY }],
      effectStyles: [{ name: 'Low', value: { shadows: [LOW] } }],
      newTextStyleIds: ['body'],
      newEffectStyleIds: ['low'],
      objects: [rectangle('a', 'low')],
    });
    expect(result.textStyles).toEqual([{ id: 'body', isCreated: true, isChanged: true }]);
    expect(result.effectStyles).toEqual([{ id: 'low', isCreated: true, isChanged: true }]);
    expect(result.tokens).toEqual([]);
    expect(store.readTextStyles().get('body')).toMatchObject({ createdBy: ADA.principalId });
    expect(mustGet(store, result.ids[0] ?? '')).toMatchObject({ effectStyleId: 'low' });
    expect(history.undo()).toBe(true);
    expect(store.readTextStyles().size + store.readEffectStyles().size).toBe(0);
    expect(store.read().objects.size).toBe(objectCount);
    store.destroy();
  });

  it('defines tokens beside the styles, and reports an unchanged update', () => {
    const store = createFixtureStore();
    const id = applyCommand(store, setEffectStyleCommand, {
      name: 'Low',
      value: { shadows: [LOW] },
    }).result.id;
    const { result } = applyCommand(
      store,
      createObjectsWithStylesCommand,
      {
        tokens: [{ name: 'Brand', light: RED, dark: RED }],
        newTokenIds: ['brand'],
        effectStyles: [{ id, name: 'Low', value: { shadows: [LOW] } }],
        objects: [rectangle('a', id)],
      },
      ADA,
      testEnvironment(7),
    );
    expect(result.tokens).toEqual([{ id: 'brand', isCreated: true, isChanged: true }]);
    expect(result.effectStyles).toEqual([{ id, isCreated: false, isChanged: false }]);
    expect(result.textStyles).toEqual([]);
    store.destroy();
  });

  it('sees earlier items, refusing a repeated name at the later one and an over-limit item', () => {
    const store = createFixtureStore();
    expect(
      codesAt(
        expectRejected(store, createObjectsWithStylesCommand, {
          textStyles: [
            { name: 'Body', value: BODY },
            { name: 'BODY', value: BODY },
          ],
          objects: [rectangle('a')],
        }),
      ),
    ).toEqual(['duplicate-style-name textStyles.1.name']);
    const many = [...Array(MAX_TEXT_STYLES + 1).keys()].map((index) => ({
      name: `Style ${String(index)}`,
      value: BODY,
    }));
    expect(
      codesAt(
        expectRejected(store, createObjectsWithStylesCommand, {
          textStyles: many,
          objects: [rectangle('a')],
        }),
      ),
    ).toEqual([`too-many-styles textStyles.${String(MAX_TEXT_STYLES)}`]);
    store.destroy();
  });

  it('refuses a taken chosen id, a spare chosen id and an agent changing another’s style', () => {
    const store = createFixtureStore();
    const taken = applyCommand(store, setTextStyleCommand, { name: 'Taken', value: BODY }).result
      .id;
    expect(
      codesAt(
        expectRejected(store, createObjectsWithStylesCommand, {
          textStyles: [{ name: 'Fresh', value: BODY }],
          newTextStyleIds: [taken],
          effectStyles: [{ name: 'Low', value: { shadows: [LOW] } }],
          newEffectStyleIds: ['low', 'spare'],
          objects: [rectangle('a')],
        }),
      ),
    ).toEqual(['duplicate-id textStyles.0.id', 'invalid-input newEffectStyleIds']);
    const before = store.encodeState();
    const outcome = runCommand(
      store,
      SCOUT_FOR_ADA,
      createObjectsWithStylesCommand,
      { textStyles: [{ id: taken, name: 'Mine', value: BODY }], objects: [rectangle('a')] },
      testEnvironment(),
    );
    expect(outcome.status === 'rejected' ? codesAt(outcome.errors) : []).toEqual([
      'not-own-style textStyles.0.id',
    ]);
    expect(store.encodeState()).toEqual(before);
    store.destroy();
  });

  it('refuses the objects and the styles together, writing neither', () => {
    const store = createFixtureStore();
    const errors = expectRejected(store, createObjectsWithStylesCommand, {
      textStyles: [{ name: 'Body', value: BODY }],
      objects: [rectangle('a'), rectangle('a')],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(store.readTextStyles().size).toBe(0);
    store.destroy();
  });

  it.each([false, true])(
    'writes the styles in the first part of a split creation, still one undo step (tokens: %s)',
    (hasTokens) => {
      const store = new YjsDocumentStore();
      const history = createHistory(store, ADA.principalId);
      let updates = 0;
      store.subscribeUpdates(({ isLocal }) => {
        if (isLocal) updates += 1;
      });
      const objects = [...Array(MAX_OBJECTS_PER_TRANSACTION + 1).keys()].map((index) =>
        rectangle(`r${String(index)}`, 'low'),
      );
      const { result } = applyCommand(store, createObjectsWithStylesCommand, {
        ...(hasTokens ? { tokens: [{ name: 'Brand', light: RED, dark: RED }] } : {}),
        effectStyles: [{ name: 'Low', value: { shadows: [LOW] } }],
        newEffectStyleIds: ['low'],
        objects,
      });
      expect(updates).toBe(2);
      expect(result.ids).toHaveLength(objects.length);
      expect(result.effectStyles).toEqual([{ id: 'low', isCreated: true, isChanged: true }]);
      expect(result.tokens).toHaveLength(hasTokens ? 1 : 0);
      expect(store.readEffectStyles().get('low')?.name).toBe('Low');
      expect(history.undo()).toBe(true);
      expect(store.readEffectStyles().size).toBe(0);
      expect(store.read().objects.size).toBe(0);
      store.destroy();
    },
  );
});
