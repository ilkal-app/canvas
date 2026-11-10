// An override record may restyle a text child (`textStyle`) and carry its own runs
// (`runs`, only beside `text`). The commands keep every stored record valid: a new `text`
// without runs drops the old runs, and resetting `text` takes its runs with it.
import { describe, expect, it } from 'vitest';

import {
  resolveInstance,
  type InstanceObject,
  type StyleRun,
  type TextStyle,
} from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import { ADA } from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { applyCommand, expectRejected, mustGet } from './__fixtures__/command-fixtures.js';
import { placeInstance, seedMainWithChildren } from './__fixtures__/component-boards.js';
import { codesOf, overridesOf } from './__fixtures__/component-fixtures.js';
import { createInstanceCommand } from './create-instance.js';
import { detachInstanceCommand } from './detach-instance.js';
import { resetInstanceOverridesCommand } from './reset-instance-overrides.js';
import { setInstanceOverrideCommand } from './set-instance-override.js';

const RED: [number, number, number, number] = [1, 0, 0, 1];
const AMBER: [number, number, number, number] = [1, 0.75, 0, 1];

/**
 * The caption's stored style, read from the store.
 *
 * @param store - The store.
 * @param captionId - The main's text child.
 * @returns Its first run's style.
 * @throws {Error} When the caption has no runs.
 */
function captionStyle(store: YjsDocumentStore, captionId: string): TextStyle {
  const caption = mustGet(store, captionId);
  const style = caption.type === 'text' ? caption.runs[0]?.style : undefined;
  if (style === undefined) throw new Error('the caption has no runs');
  return style;
}

/**
 * A main with a sticky, a rectangle, a caption and a photo, and one instance of it.
 *
 * @returns The store, the instance and the main's child ids.
 */
function seeded(): {
  readonly store: YjsDocumentStore;
  readonly instanceId: string;
  readonly captionId: string;
  readonly noteId: string;
  readonly photoId: string;
  readonly mention: { readonly text: string; readonly runs: StyleRun[] };
} {
  const store = new YjsDocumentStore();
  const { mainId, captionId, noteId, photoId } = seedMainWithChildren(store);
  const instanceId = placeInstance(store, mainId, { x: 1000, y: 0, instanceId: 'inst' });
  const body = captionStyle(store, captionId);
  const mention = {
    text: '@Mira hi',
    runs: [
      { length: 5, style: { ...body, color: AMBER } },
      { length: 3, style: body },
    ],
  };
  return { store, instanceId, captionId, noteId, photoId, mention };
}

/**
 * Sets one override through the command.
 *
 * @param store - The store.
 * @param instanceId - The instance.
 * @param path - The child path.
 * @param override - The record to merge.
 */
function setOverride(
  store: YjsDocumentStore,
  instanceId: string,
  path: string,
  override: object,
): void {
  applyCommand(store, setInstanceOverrideCommand, { id: instanceId, path, override });
}

describe('setInstanceOverride with textStyle and runs', () => {
  it('stores a text colour and resolves it over every run', () => {
    const { store, instanceId, captionId } = seeded();
    setOverride(store, instanceId, captionId, { textStyle: { color: RED } });
    expect(overridesOf(store, instanceId)).toEqual({ [captionId]: { textStyle: { color: RED } } });
    const instance = mustGet(store, instanceId) as InstanceObject;
    const virtual = resolveInstance(store.read(), instance).objects.find(
      (object) => object.id === `${instanceId}/${captionId}`,
    );
    expect(virtual).toMatchObject({
      text: 'Caption',
      runs: [{ length: 7, style: { ...captionStyle(store, captionId), color: RED } }],
    });
  });

  it('stores text with runs, and a later style keeps them', () => {
    const { store, instanceId, captionId, mention } = seeded();
    setOverride(store, instanceId, captionId, mention);
    setOverride(store, instanceId, captionId, { textStyle: { fontSize: 12 } });
    expect(overridesOf(store, instanceId)[captionId]).toEqual({
      ...mention,
      textStyle: { fontSize: 12 },
    });
  });

  it('drops the stored runs when new text comes without runs', () => {
    const { store, instanceId, captionId, mention } = seeded();
    setOverride(store, instanceId, captionId, { ...mention, textStyle: { color: RED } });
    setOverride(store, instanceId, captionId, { text: 'Bye' });
    expect(overridesOf(store, instanceId)[captionId]).toEqual({
      text: 'Bye',
      textStyle: { color: RED },
    });
  });

  it('replaces a stored textStyle whole', () => {
    const { store, instanceId, captionId } = seeded();
    setOverride(store, instanceId, captionId, { textStyle: { color: RED, fontSize: 40 } });
    setOverride(store, instanceId, captionId, { textStyle: { color: AMBER } });
    expect(overridesOf(store, instanceId)[captionId]).toEqual({ textStyle: { color: AMBER } });
  });

  it('restyles a sticky’s text beside its background colour', () => {
    const { store, instanceId, noteId } = seeded();
    setOverride(store, instanceId, noteId, { color: RED, textStyle: { color: 'ink' } });
    expect(overridesOf(store, instanceId)[noteId]).toEqual({
      color: RED,
      textStyle: { color: 'ink' },
    });
  });

  it('is one undo step', () => {
    const { store, instanceId, captionId, mention } = seeded();
    const history = createHistory(store, ADA.principalId);
    setOverride(store, instanceId, captionId, { ...mention, textStyle: { italic: true } });
    expect(history.undo()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(overridesOf(store, instanceId)).toEqual({});
    history.destroy();
  });

  it.each([
    ['runs without text', (runs: readonly StyleRun[]) => ({ runs })],
    ['runs that do not cover the text', (runs: readonly StyleRun[]) => ({ text: 'Hi', runs })],
  ])('refuses %s as an invalid override, writing nothing', (label, record) => {
    const { store, instanceId, captionId, mention } = seeded();
    const errors = expectRejected(store, setInstanceOverrideCommand, {
      id: instanceId,
      path: captionId,
      override: record(mention.runs),
    });
    expect(new Set(codesOf(errors)), label).toEqual(new Set(['invalid-override']));
  });

  it.each([
    ['an empty style', () => ({ textStyle: {} })],
    ['a style key no text style has', () => ({ textStyle: { underline: true } })],
    ['a size past the bound', () => ({ textStyle: { fontSize: 1000 } })],
  ])('refuses %s as invalid input, writing nothing', (label, record) => {
    const { store, instanceId, captionId } = seeded();
    const errors = expectRejected(store, setInstanceOverrideCommand, {
      id: instanceId,
      path: captionId,
      override: record(),
    });
    expect(new Set(codesOf(errors)), label).toEqual(new Set(['invalid-input']));
  });

  it('refuses textStyle and runs on a child without text', () => {
    const { store, instanceId, photoId, mention } = seeded();
    for (const override of [{ textStyle: { color: RED } }, mention]) {
      const errors = expectRejected(store, setInstanceOverrideCommand, {
        id: instanceId,
        path: photoId,
        override,
      });
      expect(codesOf(errors)).toEqual(['invalid-override']);
    }
  });
});

describe('createInstance with textStyle and runs', () => {
  it('places the instance with the records in one undo step', () => {
    const { store, captionId, noteId, mention } = seeded();
    const mainId = (mustGet(store, captionId).parentId ?? '') as string;
    const history = createHistory(store, ADA.principalId);
    const overrides = {
      [captionId]: { ...mention, textStyle: { weight: 700 as const } },
      [noteId]: { textStyle: { color: RED } },
    };
    const { result } = applyCommand(store, createInstanceCommand, {
      componentId: mainId,
      x: 2000,
      y: 0,
      overrides,
    });
    expect(overridesOf(store, result.instanceId)).toEqual(overrides);
    expect(history.undo()).toBe(true);
    expect(store.get(result.instanceId)).toBeUndefined();
    history.destroy();
  });

  it('refuses runs on an image', () => {
    const { store, captionId, photoId, mention } = seeded();
    const mainId = (mustGet(store, captionId).parentId ?? '') as string;
    const errors = expectRejected(store, createInstanceCommand, {
      componentId: mainId,
      x: 2000,
      y: 0,
      overrides: { [photoId]: mention },
    });
    expect(codesOf(errors)).toEqual(['invalid-override']);
  });
});

describe('resetInstanceOverrides with textStyle and runs', () => {
  /**
   * A seeded instance whose caption holds text, runs, a style and visibility.
   *
   * @returns The store, instance and caption.
   */
  function full(): ReturnType<typeof seeded> {
    const board = seeded();
    setOverride(board.store, board.instanceId, board.captionId, {
      ...board.mention,
      textStyle: { color: RED },
      isHidden: false,
    });
    return board;
  }

  /**
   * Resets the caption's fields.
   *
   * @param board - The seeded board.
   * @param fields - The fields to clear.
   * @returns The caption's remaining record.
   */
  function reset(
    board: ReturnType<typeof seeded>,
    fields: readonly ('text' | 'runs' | 'textStyle')[],
  ): unknown {
    applyCommand(board.store, resetInstanceOverridesCommand, {
      id: board.instanceId,
      path: board.captionId,
      fields: [...fields],
    });
    return overridesOf(board.store, board.instanceId)[board.captionId];
  }

  it('clears textStyle alone', () => {
    const board = full();
    expect(reset(board, ['textStyle'])).toEqual({ ...board.mention, isHidden: false });
  });

  it('clears runs alone, the text then inheriting the main’s styles', () => {
    const board = full();
    expect(reset(board, ['runs'])).toEqual({
      text: board.mention.text,
      textStyle: { color: RED },
      isHidden: false,
    });
  });

  it('clears the runs with the text they cover', () => {
    const board = full();
    expect(reset(board, ['text'])).toEqual({ textStyle: { color: RED }, isHidden: false });
  });
});

describe('detachInstance with textStyle and runs', () => {
  it('materialises the restyled runs as the detached text’s own', () => {
    const { store, instanceId, captionId, mention } = seeded();
    setOverride(store, instanceId, captionId, { ...mention, textStyle: { fontSize: 12 } });
    applyCommand(store, detachInstanceCommand, { id: instanceId });
    const texts = [...store.read().objects.values()].filter(
      (object) => object.parentId === instanceId && object.type === 'text',
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({
      text: mention.text,
      runs: mention.runs.map((run) => ({
        ...run,
        style: { ...run.style, fontSize: 12 },
      })),
    });
  });
});
