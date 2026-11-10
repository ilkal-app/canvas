import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { DEFAULT_AUTO_LAYOUT } from '@canvas/schema';

import { applyCommand, mustGet, NOW } from '../commands/__fixtures__/command-fixtures.js';
import { COMMANDS, type CommandName } from '../commands/registry.js';
import type { CommandEnvironment } from '../commands/run-command.js';
import {
  ADA,
  BOB,
  BODY,
  createFixtureStore,
  id,
  RELAY,
} from '../store/__fixtures__/store-fixtures.js';
import type { DocumentStore } from '../store/document-store.js';
import { internalsOf } from '../store/internal.js';
import { OBJECTS_MAP_NAME } from '../store/yjs-document-store.js';

import {
  BOB_ENVIRONMENT,
  create,
  createClients,
  NEW_FRAME,
  FAILED_LINK_CARD,
  newShape,
  sendAll,
  type NewObject,
} from './__fixtures__/creation-fixtures.js';
import { createClientPair } from './__fixtures__/history-fixtures.js';

// The two facts the creation guard's rule for the reference keys rests on (fix round 1):
// a person's command stamps `updatedAt` on every object it creates or changes, and the reference
// repair, which every client runs on the same merge, never writes `updatedAt`. A peer's write of
// a reference key therefore counts as the peer's own only when the peer also wrote the object's
// `updatedAt` since the step. If either test fails, the rule in `written-by-others.ts` is wrong.

/** A time no fixture object carries. */
const LATER = 1_780_000_000_000;

/** The variant axes the variant commands' inputs use. */
const STATE_AXES = [{ name: 'state', values: ['rest', 'hover'] }];

/** The `hover` preset of the fixture main. */
const HOVER_PRESET = { componentId: 'component-card', axis: 'state', value: 'hover' };

/** The variant commands, which need the fixture main to have axes first. */
const NEEDS_AXES: ReadonlySet<string> = new Set([
  'setVariantPreset',
  'resetVariantPreset',
  'setInstanceVariant',
]);

/** A command input per registered command, on the fixture board. */
const INPUTS: Readonly<Record<CommandName, unknown>> = {
  createComponent: { ids: ['image-photo'], name: 'Photo' },
  createInstance: { componentId: 'component-card', x: 0, y: 0 },
  detachInstance: { id: 'instance-card' },
  setConstraints: { ids: ['text-title'], x: 'end' },
  setAutoLayout: {
    ids: ['frame-plan'],
    autoLayout: {
      direction: 'row',
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'start',
      justify: 'start',
      width: 'hug',
      height: 'hug',
    },
  },
  setLayoutChild: { ids: ['text-title'], layoutChild: { fill: true } },
  patchAutoLayout: { ids: ['frame-plan'], patch: { gap: 12 } },
  setInstanceOverride: {
    id: 'instance-card',
    path: 'component-child',
    override: { fill: [0, 1, 0, 1] },
  },
  resetInstanceOverrides: { id: 'instance-card' },
  setVariantAxes: { componentId: 'component-card', axes: STATE_AXES },
  setVariantPreset: { ...HOVER_PRESET, path: 'image-photo', override: { isHidden: true } },
  resetVariantPreset: HOVER_PRESET,
  setInstanceVariant: { id: 'instance-card', variant: { state: 'hover' } },
  setSwapOptions: { id: 'instance-card', options: ['component-card'] },
  createObject: { object: newShape('shape-new') },
  createObjects: { objects: [newShape('shape-a'), newShape('shape-b')] },
  createFrame: { frame: NEW_FRAME, childIds: ['image-photo'] },
  renameFrame: { id: 'frame-plan', name: 'Plan' },
  renameObject: { id: 'text-title', name: 'Title' },
  deleteObjects: { ids: ['sticky-idea'] },
  moveObjects: { moves: [{ id: 'image-photo', by: { x: 5, y: 0 } }] },
  resizeObjects: { resizes: [{ id: 'image-photo', to: { width: 300, height: 200 } }] },
  rotateObjects: { rotations: [{ id: 'image-photo', by: 0.5 }] },
  setStyle: { changes: [{ id: 'image-photo', style: { opacity: 0.5 } }] },
  setTextRuns: { id: 'text-title', text: 'New', runs: [{ length: 3, style: BODY }] },
  group: { ids: ['image-photo', 'line-divider'] },
  ungroup: { ids: ['group-diagram'] },
  connect: { from: { objectId: 'image-photo' }, to: { point: { x: 0, y: 0 } } },
  bringToFront: { ids: ['text-title'] },
  sendToBack: { ids: ['group-diagram'] },
  bringForward: { ids: ['text-title'] },
  sendBackward: { ids: ['group-diagram'] },
  placeObjects: { ids: ['shape-box'], parentId: 'frame-plan', belowId: 'group-diagram' },
  setLocked: { ids: ['image-photo'], locked: true },
  applyLinkUnfurl: {
    id: 'link-card',
    unfurlKey: 'fixture-paste',
    outcome: { status: 'ready', title: 'An article', description: '', siteName: 'Example' },
  },
  setLinkLayout: { ids: ['link-card'], layout: 'horizontal' },
  retryLinkUnfurl: { id: 'link-failed', unfurlKey: 'retry-1' },
  linkCardToText: {
    id: 'link-card',
    style: { fontFamily: 'Inter', fontSize: 16, color: [0, 0, 0, 1], weight: 400, italic: false },
  },
  setLinePoints: { id: 'line-divider', end: 1, point: { x: 900, y: 700 } },
  setConnectorEnd: { id: 'connector-flow', end: 'to', target: { objectId: 'image-photo' } },
  editNetwork: { id: 'path-squiggle', setVertices: [{ id: 'v1', x: 5, y: 5, mirror: 'none' }] },
  addPage: { name: 'Other' },
  renamePage: { pageId: 'page-1', name: 'Renamed' },
  reorderPage: { pageId: 'new-1', before: 'page-1' },
  duplicatePage: { pageId: 'page-1' },
  deletePage: { pageId: 'new-1' },
  moveObjectsToPage: { ids: ['image-photo'], pageId: 'new-1' },
  setColorToken: { name: 'Brand', light: [1, 0, 0, 1], dark: [0, 0, 1, 1] },
  renameColorToken: { id: 'new-1', name: 'Renamed' },
  deleteColorToken: { id: 'new-1' },
  resetColorToken: { id: 'accent' },
  setTextStyle: {
    name: 'Body',
    value: { fontFamily: 'Inter', fontSize: 16, weight: 400, italic: false },
  },
  deleteTextStyle: { id: 'new-1' },
  setEffectStyle: {
    name: 'Depth',
    value: { shadows: [{ x: 0, y: 4, blur: 4, spread: 0, color: [0, 0, 0, 0.25] }] },
  },
  deleteEffectStyle: { id: 'new-1' },
  replaceFontFamily: { from: 'Inter', to: 'Lora' },
  setBoardTimer: { action: { kind: 'start', durationMs: 60_000 }, serverNowMs: LATER },
  setStickyAuthors: { isShown: true },
  fitFrameToContent: { id: 'frame-plan' },
  replaceImage: {
    id: 'image-photo',
    assetId: 'asset-replaced',
    naturalSize: { width: 800, height: 600 },
  },
};

/** The style deletes, which need a style, `new-1`, first, made by its kind's set command. */
const NEEDS_STYLE: ReadonlyMap<CommandName, CommandName> = new Map([
  ['deleteTextStyle', 'setTextStyle'],
  ['deleteEffectStyle', 'setEffectStyle'],
] as const);

/** The token commands that need a custom token, `new-1`, or an edited built-in first. */
const NEEDS_TOKEN: ReadonlySet<CommandName> = new Set([
  'renameColorToken',
  'deleteColorToken',
  'resetColorToken',
]);

/** The commands that need a second page, `new-1`, which the test adds first. */
const NEEDS_PAGE: ReadonlySet<CommandName> = new Set([
  'reorderPage',
  'deletePage',
  'moveObjectsToPage',
]);

/**
 * The Yjs item holding an object's `updatedAt`.
 *
 * @param store - The store.
 * @param objectId - The object.
 * @returns The item.
 */
function updatedAtItem(store: DocumentStore, objectId: string): Y.Item | undefined {
  const map = internalsOf(store).objects.get(objectId) as Y.Map<unknown>;
  return map._map.get('updatedAt');
}

describe('who writes updatedAt', () => {
  it.each(Object.keys(COMMANDS) as CommandName[])(
    'the %s command stamps every object it creates or changes',
    (name) => {
      const store = createFixtureStore();
      let serial = 0;
      const createId = () => id(`new-${String((serial += 1))}`);
      const environment: CommandEnvironment = { clock: () => LATER, createId };
      if (NEEDS_PAGE.has(name)) applyCommand(store, COMMANDS.addPage, {}, ADA, environment);
      if (NEEDS_TOKEN.has(name)) {
        const token: Record<string, unknown> = {
          name: 'Brand',
          light: [1, 0, 0, 1],
          dark: [0, 0, 1, 1],
        };
        if (name === 'resetColorToken') token.id = 'accent';
        const setColorToken = COMMANDS.setColorToken as Parameters<typeof applyCommand>[1];
        applyCommand(store, setColorToken, token, ADA, environment);
      }
      const styleSetter = NEEDS_STYLE.get(name);
      if (styleSetter !== undefined) {
        const setStyle = COMMANDS[styleSetter] as Parameters<typeof applyCommand>[1];
        applyCommand(store, setStyle, INPUTS[styleSetter], ADA, environment);
      }
      if (
        [
          'createInstance',
          'detachInstance',
          'setInstanceOverride',
          'resetInstanceOverrides',
          'setVariantAxes',
          ...NEEDS_AXES,
          'setSwapOptions',
        ].includes(name)
      ) {
        applyCommand(store, COMMANDS.createComponent, {
          ids: ['image-photo'],
          name: 'Card',
          componentId: 'component-card',
        });
        applyCommand(store, COMMANDS.createInstance, {
          componentId: 'component-card',
          instanceId: 'instance-card',
          x: 2000,
          y: 0,
        });
      }
      if (name === 'patchAutoLayout') {
        applyCommand(store, COMMANDS.setAutoLayout, {
          ids: ['frame-plan'],
          autoLayout: DEFAULT_AUTO_LAYOUT,
        });
      }
      if (name === 'setInstanceOverride' || name === 'resetInstanceOverrides') {
        applyCommand(store, COMMANDS.createObject, {
          object: { ...newShape('component-child'), parentId: 'component-card' },
        });
        if (name === 'resetInstanceOverrides')
          applyCommand(store, COMMANDS.setInstanceOverride, {
            id: 'instance-card',
            path: 'component-child',
            override: { fill: [0, 1, 0, 1] },
          });
      }
      // Only a failed card is fetched again.
      if (name === 'retryLinkUnfurl') {
        applyCommand(store, COMMANDS.createObject, { object: FAILED_LINK_CARD });
      }
      if (NEEDS_AXES.has(name)) {
        applyCommand(store, COMMANDS.setVariantAxes, INPUTS.setVariantAxes as never);
        if (name === 'resetVariantPreset')
          applyCommand(store, COMMANDS.setVariantPreset, INPUTS.setVariantPreset as never);
      }
      const command = COMMANDS[name] as Parameters<typeof applyCommand>[1];
      const { changes } = applyCommand(store, command, INPUTS[name], ADA, environment);
      const written = [...changes.created, ...changes.updated];
      // Page, token and style commands may write no object: their
      // change set names the pages, tokens or styles. The timer command writes only the board
      // timer, which no change set names; the sticky author command only its setting.
      const sides =
        (name === 'setBoardTimer' && store.boardTimer.current !== undefined ? 1 : 0) +
        (name === 'setStickyAuthors' && store.stickyAuthors.current ? 1 : 0) +
        (changes.pages?.length ?? 0) +
        (changes.tokens?.length ?? 0) +
        (changes.textStyles?.length ?? 0) +
        (changes.effectStyles?.length ?? 0);
      expect(written.length + sides).toBeGreaterThan(0);
      for (const objectId of written) expect(mustGet(store, objectId).updatedAt).toBe(LATER);
    },
  );

  it('the reference repair never writes it, for any rule', () => {
    const [ada, bob] = createClientPair(1, 2);
    // Ada puts a shape in a frame, pins a comment and attaches a connector to one object while
    // Bob deletes the frame and that object: every client repairs the three references.
    const shape = newShape('shape-in', 'frame-plan');
    applyCommand(ada, COMMANDS.createObject, { object: shape });
    const wire = { from: { objectId: 'image-photo' }, to: { objectId: 'video-demo' } };
    applyCommand(ada, COMMANDS.connect, { ...wire, id: 'wire' });
    const pin: NewObject = {
      type: 'comment',
      id: 'pin',
      x: 0,
      y: 0,
      threadId: 't',
      anchor: { kind: 'object', objectId: 'image-photo', offset: { x: 1, y: 1 } },
    };
    applyCommand(ada, COMMANDS.createObject, { object: pin });
    const before = new Map(
      ['shape-in', 'wire', 'pin'].map((key) => [key, updatedAtItem(ada, key)?.id]),
    );
    applyCommand(
      bob,
      COMMANDS.deleteObjects,
      { ids: ['frame-plan', 'image-photo'] },
      BOB,
      BOB_ENVIRONMENT,
    );
    sendAll(bob, ada);
    sendAll(ada, bob);

    expect(mustGet(ada, 'shape-in').parentId).toBeNull();
    expect(mustGet(ada, 'wire')).toMatchObject({ from: { kind: 'point' } });
    expect(mustGet(ada, 'pin')).toMatchObject({ anchor: { kind: 'point' } });
    for (const [key, itemId] of before) {
      expect(updatedAtItem(ada, key)?.id).toEqual(itemId);
      expect(updatedAtItem(bob, key)?.id).toEqual(itemId);
    }
  });
});

// Fix round 2: a command stamps `updatedAt` only when the time differs from the object's, so an
// edit of a reference key in the very millisecond of the object's last stamp left no stamp, and
// the guard read it as the product's repair. A command that writes a reference key now always
// writes `updatedAt`, as `max(now, stored + 1)`.
describe('reference-key edits at the same instant', () => {
  it.each([
    { name: "Ada's writes win", adaClientId: 2, bobClientId: 1 },
    { name: "Bob's writes win", adaClientId: 1, bobClientId: 2 },
  ])("protect both of Ada's creations ($name)", ({ adaClientId, bobClientId }) => {
    const { ada, bob, link, history } = createClients(adaClientId, bobClientId);
    const sameInstant: CommandEnvironment = { ...BOB_ENVIRONMENT, clock: () => NOW };
    const bobsShape = create(bob, newShape('shape-bob'), BOB);
    link.deliver();
    const shape = create(ada, newShape('shape-new'));
    const frame = create(ada, NEW_FRAME);
    link.deliver();
    const moves = [
      { id: shape, by: { x: 5, y: 0 } },
      { id: bobsShape, by: { x: 5, y: 0 }, parentId: frame },
    ];
    for (const move of moves) {
      applyCommand(bob, COMMANDS.moveObjects, { moves: [move] }, BOB, sameInstant);
    }
    link.deliver();

    expect(history.undo()).toBe(false);
    expect(history.undo()).toBe(false);
    link.deliver();
    expect(mustGet(ada, bobsShape).parentId).toBe(frame);
    expect(mustGet(ada, shape).x).toBe(45);
  });

  it('stamps a later time than the object carries, and a time it already carries only when the command writes no reference key', () => {
    const store = createFixtureStore();
    const photo = mustGet(store, 'image-photo');
    const atStamp: CommandEnvironment = {
      clock: () => photo.updatedAt,
      createId: () => id('unused'),
    };
    applyCommand(
      store,
      COMMANDS.setStyle,
      { changes: [{ id: 'image-photo', style: { opacity: 0.2 } }] },
      ADA,
      atStamp,
    );
    expect(mustGet(store, 'image-photo').updatedAt).toBe(photo.updatedAt);
    applyCommand(
      store,
      COMMANDS.moveObjects,
      { moves: [{ id: 'image-photo', by: { x: 1, y: 0 } }] },
      ADA,
      atStamp,
    );
    expect(mustGet(store, 'image-photo').updatedAt).toBe(photo.updatedAt + 1);
  });
});

// Fix round 3 (review M2): a peer that skips validation can store the largest safe integer as a
// stamp; the forced stamp of the next reference edit must not go past it, or the store refuses
// the stamp after the command has written.
describe('the forced stamp at the largest safe integer', () => {
  it('stays there, and the command applies', () => {
    const store = createFixtureStore();
    const peer = new Y.Doc();
    peer.clientID = 9_998;
    Y.applyUpdate(peer, store.encodeState());
    const objects = peer.getMap<Y.Map<unknown>>(OBJECTS_MAP_NAME);
    peer.transact(() => objects.get('image-photo')?.set('updatedAt', Number.MAX_SAFE_INTEGER));
    store.applyUpdate(Y.encodeStateAsUpdate(peer, store.encodeStateVector()), RELAY);

    const moves = [{ id: 'image-photo', by: { x: 1, y: 0 } }];
    applyCommand(store, COMMANDS.moveObjects, { moves }, ADA, {
      ...BOB_ENVIRONMENT,
      clock: () => NOW,
    });
    expect(mustGet(store, 'image-photo').updatedAt).toBe(Number.MAX_SAFE_INTEGER);
  });
});
