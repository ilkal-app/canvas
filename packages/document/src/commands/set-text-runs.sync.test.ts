import { describe, expect, it } from 'vitest';

import type { StickyObject, StyleRun, TextObject } from '@canvas/schema';

import { createHistory } from '../history/undo-manager.js';
import {
  ADA,
  BOB,
  BODY,
  createSyncedPair,
  exchange,
  id,
  RELAY,
} from '../store/__fixtures__/store-fixtures.js';
import { YjsDocumentStore } from '../store/yjs-document-store.js';

import { testEnvironment } from './__fixtures__/command-fixtures.js';
import { createObjectCommand } from './create-object.js';
import { runCommand } from './run-command.js';
import { setStyleCommand } from './set-style.js';
import { setTextRunsCommand } from './set-text-runs.js';

// Sync tests for rich text, a shared type: the text editor
// writes every keystroke as one setTextRuns of the whole content, which the store turns into a
// minimal Y.Text edit, so two people typing in the same run, or one restyling a range while the
// other types inside it, merge character-wise and converge.

const TITLE = id('text-title');
const BOLD = { ...BODY, weight: 700 as const };

/**
 * Runs `setTextRuns` on one client as its own user.
 *
 * @param store - The client.
 * @param origin - Who types.
 * @param text - The whole new text.
 * @param runs - Its runs.
 */
function type(store: YjsDocumentStore, origin: typeof ADA, text: string, runs: StyleRun[]): void {
  const outcome = runCommand(
    store,
    origin,
    setTextRunsCommand,
    { id: TITLE, text, runs, size: { width: 10 * text.length || 1, height: 30 } },
    testEnvironment(),
  );
  expect(outcome.status).toBe('applied');
}

/**
 * The title's text object on a client.
 *
 * @param store - The client.
 * @returns The object.
 * @throws {Error} When the title is not a text object.
 */
function title(store: YjsDocumentStore): TextObject {
  const object = store.get(TITLE);
  if (object?.type !== 'text') throw new Error('The fixture title is a text object.');
  return object;
}

describe('setTextRuns sync', () => {
  it('keeps both insertions when two clients type into the same run concurrently', () => {
    const [ada, bob] = createSyncedPair();
    type(ada, ADA, 'hello world', [{ length: 11, style: BODY }]);
    exchange(ada, bob);
    type(ada, ADA, 'hello brave world', [{ length: 17, style: BODY }]);
    type(bob, BOB, 'hello world again', [{ length: 17, style: BODY }]);
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(title(ada)).toMatchObject({
      text: 'hello brave world again',
      runs: [{ length: 23, style: BODY }],
    });
  });

  it('undoes only the undoing client’s own word, keeping the other client’s concurrent typing', () => {
    const [ada, bob] = createSyncedPair();
    type(ada, ADA, 'hello world', [{ length: 11, style: BODY }]);
    exchange(ada, bob);
    const adaHistory = createHistory(ada, ADA.principalId, { captureTimeout: 30_000 });
    // Ada types a word at the start (one step), while Bob types at the end.
    adaHistory.stopCapturing();
    type(ada, ADA, 'bold hello world', [{ length: 16, style: BODY }]);
    type(bob, BOB, 'hello world!!', [{ length: 13, style: BODY }]);
    exchange(ada, bob);
    expect(title(ada).text).toBe('bold hello world!!');
    expect(adaHistory.undo()).toBe(true);
    exchange(ada, bob);
    expect(title(ada).text).toBe('hello world!!');
    expect(title(bob)).toEqual(title(ada));
    adaHistory.destroy();
  });

  it('converges when one client restyles a range while the other types inside it', () => {
    const [ada, bob] = createSyncedPair();
    type(ada, ADA, 'abcdef', [{ length: 6, style: BODY }]);
    exchange(ada, bob);
    type(ada, ADA, 'abcdef', [
      { length: 1, style: BODY },
      { length: 4, style: BOLD },
      { length: 1, style: BODY },
    ]);
    type(bob, BOB, 'abcXYdef', [{ length: 8, style: BODY }]);
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    const merged = title(ada);
    expect(merged.text).toBe('abcXYdef');
    // Y.Text formats a range between two markers, so what Bob typed inside Ada's range lands
    // between them and takes her bold, on both clients.
    expect(merged.runs).toEqual([
      { length: 1, style: BODY },
      { length: 6, style: BOLD },
      { length: 1, style: BODY },
    ]);
  });

  it('merges typing on a sticky note with a concurrent recolour and a grown size', () => {
    const [ada, bob] = createSyncedPair();
    const note = id('sticky-idea');
    const pink = [1, 0.74, 0.8, 1] as [number, number, number, number];
    // Ada types a second line into the note and writes its grown size; Bob recolours it and
    // types at its start.
    const typed = 'Ship the beta 😀\nand the docs';
    const typing = runCommand(
      ada,
      ADA,
      setTextRunsCommand,
      {
        id: note,
        text: typed,
        runs: [{ length: typed.length, style: BODY }],
        size: { width: 200, height: 232 },
      },
      testEnvironment(),
    );
    const recolour = runCommand(
      bob,
      BOB,
      setStyleCommand,
      { changes: [{ id: note, style: { color: pink } }] },
      testEnvironment(),
    );
    const bobTyped = 'Oh! Ship the beta 😀';
    const bobTyping = runCommand(
      bob,
      BOB,
      setTextRunsCommand,
      { id: note, text: bobTyped, runs: [{ length: bobTyped.length, style: BODY }] },
      testEnvironment(),
    );
    expect([typing.status, recolour.status, bobTyping.status]).toEqual([
      'applied',
      'applied',
      'applied',
    ]);
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect(ada.get(note) as StickyObject).toMatchObject({
      type: 'sticky',
      text: `Oh! ${typed}`,
      color: pink,
      width: 200,
      height: 232,
    });
  });

  it('merges a note created on one client with typing into another note on the other, in either order', () => {
    const [ada, bob] = createSyncedPair();
    const base = ada.encodeState();
    const baseVector = ada.encodeStateVector();
    const typing = 'Ship the beta';
    // Ada types into the fixture's note; Bob makes a new note with the sticky tool's click.
    const typed = runCommand(
      ada,
      ADA,
      setTextRunsCommand,
      { id: id('sticky-idea'), text: typing, runs: [{ length: typing.length, style: BODY }] },
      testEnvironment(),
    );
    const created = runCommand(
      bob,
      BOB,
      createObjectCommand,
      {
        object: {
          id: id('sticky-new'),
          type: 'sticky',
          x: 600,
          y: 100,
          width: 200,
          height: 200,
          text: '',
          runs: [{ length: 0, style: BODY }],
          align: 'center',
          autoWidth: false,
          verticalAlign: 'middle',
          color: [1, 0.92, 0.55, 1],
        },
      },
      testEnvironment(),
    );
    expect([typed.status, created.status]).toEqual(['applied', 'applied']);
    const fromAda = ada.encodeState(baseVector);
    const fromBob = bob.encodeState(baseVector);
    // Two more clients take the two edits in opposite orders; everyone converges.
    const [adaFirst, bobFirst] = [new YjsDocumentStore(), new YjsDocumentStore()];
    for (const store of [adaFirst, bobFirst]) store.applyUpdate(base, RELAY);
    adaFirst.applyUpdate(fromAda, RELAY);
    adaFirst.applyUpdate(fromBob, RELAY);
    bobFirst.applyUpdate(fromBob, RELAY);
    bobFirst.applyUpdate(fromAda, RELAY);
    exchange(ada, bob);
    const merged = ada.read().objects;
    for (const store of [bob, adaFirst, bobFirst]) expect(store.read().objects).toEqual(merged);
    expect(merged.get(id('sticky-idea'))).toMatchObject({ type: 'sticky', text: typing });
    expect(merged.get(id('sticky-new'))).toMatchObject({ type: 'sticky', text: '', x: 600 });
  });

  it('converges on one size when both clients measure their own edit', () => {
    const [ada, bob] = createSyncedPair();
    type(ada, ADA, 'ab', [{ length: 2, style: BODY }]);
    type(bob, BOB, 'abcd', [{ length: 4, style: BODY }]);
    exchange(ada, bob);
    expect(ada.read().objects).toEqual(bob.read().objects);
    expect([20, 40]).toContain(title(ada).width);
  });
});
