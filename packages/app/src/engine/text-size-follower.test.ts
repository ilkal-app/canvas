// The text size follower over two synced documents, with monospaced fake layouts
// (__fixtures__/text-document.ts: MONO's 24 px text is 14.4 px a character, 30 px a line).
import { describe, expect, it } from 'vitest';

import {
  runCommand,
  setTextRunsCommand,
  YjsDocumentStore,
  type ChangeSet,
  type DocumentStore,
} from '@canvas/document';
import { layoutText, type GlyphMeasurer } from '@canvas/engine';
import type { ObjectId, PrincipalId, StickyObject, TextObject } from '@canvas/schema';
import type { TextLayoutService } from '@canvas/tools';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { MONO } from './__fixtures__/text-document.js';
import { TextSizeFollower } from './text-size-follower.js';

const ADA = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const BOB = { kind: 'user', principalId: 'user:bob' as PrincipalId } as const;
const ID = 'shared' as ObjectId;
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'x' as ObjectId };

/** A font that measures wider than MONO: 24 px text is 16.8 px a character. */
const WIDE: GlyphMeasurer = { ...MONO, advance: () => 0.7 };

/** "ab", measured by the monospaced layout: 28.8 × 30. */
const TEXT: TextObject = {
  id: ID,
  type: 'text',
  parentId: null,
  x: 0,
  y: 0,
  rotation: 0,
  z: 'a0',
  locked: false,
  createdBy: ADA.principalId,
  createdAt: 1,
  updatedAt: 1,
  width: 28.8,
  height: 30,
  text: 'ab',
  runs: [{ length: 2, style: DEFAULT_TEXT_STYLE }],
  align: 'left',
  autoWidth: true,
  verticalAlign: 'top',
};

function layoutWith(measurer: GlyphMeasurer): TextLayoutService {
  return {
    layout: ({ text, runs, wrapWidth, align, paragraphs }) =>
      layoutText(text, runs, wrapWidth, measurer, align, 'auto', paragraphs),
  };
}

/**
 * Sends one store's changes to another as the network would (a remote update there).
 *
 * @param from - The sender.
 * @param to - The receiver.
 */
function sync(from: DocumentStore, to: DocumentStore): void {
  to.applyUpdate(from.encodeState(to.encodeStateVector()), BOB);
}

/**
 * Collects the system-origin change sets a store's follower writes from now on.
 *
 * @param store - The store.
 * @returns The list, filled as they are written.
 */
function followerWrites(store: DocumentStore): ChangeSet[] {
  const written: ChangeSet[] = [];
  store.subscribe((changes) => {
    if (changes.isLocal && changes.origin.kind === 'system') written.push(changes);
  });
  return written;
}

/**
 * Types into a store as its text tool would: the text and runs with the size it measured.
 *
 * @param store - The store.
 * @param text - The whole text after typing.
 * @param measurer - The client's font metrics.
 */
function typeMeasured(store: DocumentStore, text: string, measurer: GlyphMeasurer): void {
  const runs = [{ length: text.length, style: DEFAULT_TEXT_STYLE }];
  const laidOut = layoutText(text, runs, null, measurer, 'left');
  const size = { width: laidOut.width, height: laidOut.height };
  runCommand(store, ADA, setTextRunsCommand, { id: ID, text, runs, size }, ENVIRONMENT);
}

function setUp(
  options: {
    readonly isEdited?: boolean;
    readonly canWrite?: () => boolean;
    readonly object?: TextObject;
  } = {},
) {
  const ada = new YjsDocumentStore();
  const bob = new YjsDocumentStore();
  ada.transact(ADA, (transaction) => {
    transaction.setObject(options.object ?? TEXT);
  });
  sync(ada, bob);
  const follower = new TextSizeFollower({
    store: ada,
    environment: ENVIRONMENT,
    layout: layoutWith(MONO),
    editedId: () => (options.isEdited === true ? ID : undefined),
    ...(options.canWrite === undefined ? {} : { canWrite: options.canWrite }),
  });
  if (options.isEdited === true) follower.noteEditing(ID);
  const written: ChangeSet[] = [];
  ada.subscribe((changes) => {
    if (changes.isLocal) written.push(changes);
  });
  // Bob writes a longer text without a size, as a client without fonts would.
  const bobTypes = (text: string) => {
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(ID, {
        text,
        runs: [{ length: text.length, style: DEFAULT_TEXT_STYLE }],
      });
    });
    sync(bob, ada);
  };
  const stored = () => ada.get(ID) as TextObject;
  return { ada, bob, follower, written, bobTypes, stored };
}

describe('TextSizeFollower', () => {
  it('keeps deferred measurements until the requested family has landed', async () => {
    const store = new YjsDocumentStore();
    store.transact(ADA, (transaction) => {
      transaction.setObject(TEXT);
    });
    let isReady = false;
    const follower = new TextSizeFollower({
      store,
      environment: ENVIRONMENT,
      layout: { layout: (input) => (isReady ? layoutWith(WIDE).layout(input) : undefined) },
      editedId: () => undefined,
    });
    follower.noteUnmeasured(ID);
    follower.fontsLanded();
    await Promise.resolve();
    expect((store.get(ID) as TextObject).width).toBe(TEXT.width);
    isReady = true;
    follower.fontsLanded();
    await Promise.resolve();
    expect((store.get(ID) as TextObject).width).toBeCloseTo(33.6);
    follower.destroy();
    store.destroy();
  });

  it('fits an edited sticky note’s text after a remote change, grows it past the floor, never shrinks it', async () => {
    const ada = new YjsDocumentStore();
    const bob = new YjsDocumentStore();
    const note: StickyObject = {
      ...TEXT,
      type: 'sticky',
      width: 200,
      height: 200,
      autoWidth: false,
      align: 'center',
      verticalAlign: 'middle',
      color: [1, 0.92, 0.55, 1],
    };
    ada.transact(ADA, (transaction) => {
      transaction.setObject(note);
    });
    sync(ada, bob);
    const follower = new TextSizeFollower({
      store: ada,
      environment: ENVIRONMENT,
      layout: layoutWith(MONO),
      editedId: () => ID,
    });
    follower.noteEditing(ID);
    const bobTypes = (text: string) => {
      bob.transact(BOB, (transaction) => {
        transaction.patchObject(ID, {
          text,
          runs: [{ length: text.length, style: DEFAULT_TEXT_STYLE }],
        });
      });
      sync(bob, ada);
    };
    // Seven 30 px lines (210) are fitted to the 168 inside the padding: the note keeps
    // its square.
    bobTypes(Array.from({ length: 7 }, () => 'x').join('\n'));
    await Promise.resolve();
    expect(ada.get(ID)).toMatchObject({ width: 200, height: 200 });
    // Eighteen lines are 180 even at the 8 px floor: the note grows to them and its padding, 212.
    bobTypes(Array.from({ length: 18 }, () => 'x').join('\n'));
    await Promise.resolve();
    expect((ada.get(ID) as StickyObject).height).toBeCloseTo(212, 9);
    // A note only grows: shorter text leaves it as tall as it is.
    bobTypes('x');
    await Promise.resolve();
    expect((ada.get(ID) as StickyObject).height).toBeCloseTo(212, 9);
  });

  it('rewrites the edited text’s size after a remote change, as one system change', async () => {
    const { written, bobTypes, stored } = setUp({ isEdited: true });
    bobTypes('abcd');
    expect(stored().width).toBe(28.8);
    await Promise.resolve();
    expect(stored().text).toBe('abcd');
    expect(stored().width).toBeCloseTo(57.6, 6);
    expect(stored().height).toBeCloseTo(30, 6);
    expect(written.map((changes) => changes.origin.kind)).toEqual(['system']);
  });

  it('re-measures a text this client changed when a concurrent change merges into it', async () => {
    const { ada, bob, written, stored } = setUp();
    typeMeasured(ada, 'abc', MONO);
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(ID, { align: 'center' });
    });
    written.length = 0;
    sync(bob, ada);
    await Promise.resolve();
    expect(stored().align).toBe('center');
    expect(written).toEqual([]);

    const merged = setUp();
    typeMeasured(merged.ada, 'abc', MONO);
    merged.bob.transact(BOB, (transaction) => {
      transaction.patchObject(ID, {
        text: 'abxy',
        runs: [{ length: 4, style: DEFAULT_TEXT_STYLE }],
      });
    });
    merged.written.length = 0;
    sync(merged.bob, merged.ada);
    await Promise.resolve();
    expect(merged.written.map((changes) => changes.origin.kind)).toEqual(['system']);
    expect(merged.stored().width).toBeCloseTo(merged.stored().text.length * 14.4, 6);
  });

  it('trusts the size a collaborator wrote to a text this client neither edits nor changed', async () => {
    const { written, bobTypes } = setUp();
    bobTypes('abcd');
    await Promise.resolve();
    expect(written).toEqual([]);
  });

  it('leaves locked text and a size that already matches', async () => {
    const shown = setUp({ isEdited: true });
    shown.bobTypes('ba');
    await Promise.resolve();
    expect(shown.written).toEqual([]);
    shown.ada.transact(ADA, (transaction) => {
      transaction.patchObject(ID, { locked: true });
    });
    shown.written.length = 0;
    shown.bobTypes('abcdef');
    await Promise.resolve();
    expect(shown.written).toEqual([]);
  });

  it('refreshes the content key when editing resumes after a remote change', async () => {
    const options = { isEdited: true };
    const { ada, bob, follower, written, bobTypes, stored } = setUp(options);
    options.isEdited = false;
    follower.noteEditing(undefined);
    bobTypes('abcd');
    await Promise.resolve();
    options.isEdited = true;
    follower.noteEditing(ID);
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(ID, { width: 67.2, height: 30 });
    });
    sync(bob, ada);
    await Promise.resolve();
    expect(written).toEqual([]);
    expect(stored().width).toBe(67.2);
    // A genuine content update during the resumed session still needs repair.
    bobTypes('abcdef');
    await Promise.resolve();
    expect(written.map((changes) => changes.origin.kind)).toEqual(['system']);
    expect(stored().width).toBeCloseTo(6 * 14.4, 6);
  });

  it('does not refresh an active session key before its pending remote repair', async () => {
    const { follower, written, bobTypes, stored } = setUp({ isEdited: true });
    bobTypes('abcd');
    // The router reports changes throughout a session, before the follower's microtask.
    follower.noteEditing(ID);
    await Promise.resolve();
    expect(written.map((changes) => changes.origin.kind)).toEqual(['system']);
    expect(stored().width).toBeCloseTo(4 * 14.4, 6);
  });

  it('writes nothing for a collaborator’s size-only change, even to the edited text', async () => {
    const { bob, ada, written } = setUp({ isEdited: true });
    bob.transact(BOB, (transaction) => {
      transaction.patchObject(ID, { width: 33.6, height: 30 });
    });
    sync(bob, ada);
    await Promise.resolve();
    expect(written).toEqual([]);
  });

  it('brings two clients whose fonts measure differently to one size, a write each at most', async () => {
    const ada = new YjsDocumentStore();
    const bob = new YjsDocumentStore();
    ada.transact(ADA, (transaction) => {
      transaction.setObject(TEXT);
    });
    sync(ada, bob);
    const followers = (
      [
        [ada, MONO],
        [bob, WIDE],
      ] as const
    ).map(
      ([store, measurer]) =>
        new TextSizeFollower({
          store,
          environment: ENVIRONMENT,
          layout: layoutWith(measurer),
          editedId: () => ID,
        }),
    );
    const adaWrites = followerWrites(ada);
    const bobWrites = followerWrites(bob);
    // Both type at once, each measuring with its own font.
    typeMeasured(ada, 'abc', MONO);
    typeMeasured(bob, 'abcd', WIDE);
    for (let round = 0; round < 6; round += 1) {
      sync(ada, bob);
      sync(bob, ada);
      await Promise.resolve();
    }
    expect(adaWrites.length).toBeLessThanOrEqual(1);
    expect(bobWrites.length).toBeLessThanOrEqual(1);
    expect(adaWrites.length + bobWrites.length).toBeGreaterThan(0);
    expect(ada.get(ID)).toEqual(bob.get(ID));
    const merged = ada.get(ID) as TextObject;
    const perCharacter = merged.width / merged.text.length;
    expect([14.4, 16.8].some((width) => Math.abs(width - perCharacter) < 1e-6)).toBe(true);
    for (const follower of followers) follower.destroy();
    expect(ada.encodeStateVector()).toEqual(bob.encodeStateVector());
  });

  it('measures a text again on request, whatever its content key', async () => {
    const { ada, follower, written, stored } = setUp();
    ada.transact(ADA, (transaction) => {
      transaction.patchObject(ID, { width: 1, height: 1 });
    });
    written.length = 0;
    follower.remeasure([ID]);
    await Promise.resolve();
    expect(written.map((changes) => changes.origin.kind)).toEqual(['system']);
    expect(stored().width).toBeCloseTo(28.8, 6);
    follower.remeasure([ID]);
    await Promise.resolve();
    expect(written).toHaveLength(1);
  });

  it('writes nothing while this client may not write (a viewer)', async () => {
    const { written, bobTypes, stored } = setUp({ isEdited: true, canWrite: () => false });
    bobTypes('abcd');
    await Promise.resolve();
    expect(stored().text).toBe('abcd');
    expect(written).toEqual([]);
  });

  it('writes nothing once destroyed', async () => {
    const { follower, written, bobTypes } = setUp({ isEdited: true });
    bobTypes('abcd');
    follower.destroy();
    await Promise.resolve();
    expect(written).toEqual([]);
  });

  it('rewrites a list’s size with its indent and keeps its paragraph styles', async () => {
    const listed: TextObject = { ...TEXT, paragraphs: [{ list: 'bullet' }] };
    const { bobTypes, stored } = setUp({ isEdited: true, object: listed });
    bobTypes('abcd');
    await Promise.resolve();
    expect(stored().paragraphs).toEqual([{ list: 'bullet' }]);
    // Four 14.4 px characters and one level's indent, 1.5 em of 24 px.
    expect(stored().width).toBeCloseTo(57.6 + 36, 6);
  });
});
