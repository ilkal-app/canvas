// The override size follower over a real store: it measures instance text overrides
// a layout reads with the shared `measureOverrideText`, and writes only what is missing, stale or
// off, as the system.
import { describe, expect, it } from 'vitest';

import { YjsDocumentStore, type ChangeSet } from '@canvas/document';
import type {
  AutoLayout,
  BoardObject,
  ComponentObject,
  InstanceObject,
  InstanceOverrides,
  ObjectId,
  PageId,
  PrincipalId,
  TextObject,
} from '@canvas/schema';
import { BUNDLED_FONTS_FINGERPRINT, measureOverrideText } from '@canvas/text';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { OverrideSizeFollower } from './override-size-follower.js';

const ADA = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'x' as ObjectId };

/** A row that hugs both axes, 10 apart, padded 5 all round. */
const ROW: AutoLayout = {
  direction: 'row',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  width: 'hug',
  height: 'hug',
};

const SHARED = {
  rotation: 0,
  locked: false,
  createdBy: ADA.principalId,
  createdAt: 1,
  updatedAt: 1,
} as const;

/**
 * A main holding one auto-width label, and an instance of it.
 *
 * @param overrides - The instance's records.
 * @param layout - The main's auto-layout, or null for none.
 * @returns The objects, parents first.
 */
function boardWith(overrides: InstanceOverrides, layout: AutoLayout | null = ROW): BoardObject[] {
  const main: ComponentObject = {
    ...SHARED,
    id: 'main' as ObjectId,
    type: 'component',
    parentId: null,
    pageId: 'page-1' as PageId,
    x: 0,
    y: 0,
    z: 'a0',
    width: 60,
    height: 40,
    name: 'Chip',
    retired: false,
    ...(layout === null ? {} : { autoLayout: layout }),
  };
  const label: TextObject = {
    ...SHARED,
    id: 'label' as ObjectId,
    type: 'text',
    parentId: main.id,
    pageId: null,
    x: 5,
    y: 5,
    z: 'a0',
    width: 50,
    height: 30,
    text: 'ab',
    runs: [{ length: 2, style: DEFAULT_TEXT_STYLE }],
    align: 'left',
    autoWidth: true,
    verticalAlign: 'top',
  };
  const instance: InstanceObject = {
    ...SHARED,
    id: 'inst' as ObjectId,
    type: 'instance',
    parentId: null,
    pageId: 'page-1' as PageId,
    x: 200,
    y: 0,
    z: 'a1',
    width: 60,
    height: 40,
    mainId: main.id,
    overrides,
  };
  return [main, label, instance];
}

/**
 * A store holding the objects, written by Ada in one transaction.
 *
 * @param objects - The objects.
 * @returns The store.
 */
function storeOf(objects: readonly BoardObject[]): YjsDocumentStore {
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of objects) transaction.setObject(object);
  });
  return store;
}

/** Lets the follower's microtask run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

/**
 * The record the instance stores at the label's path.
 *
 * @param store - The store.
 * @returns The record.
 */
function labelRecord(store: YjsDocumentStore): Record<string, unknown> | undefined {
  const instance = store.get('inst' as ObjectId);
  return instance?.type === 'instance' ? instance.overrides.label : undefined;
}

describe('OverrideSizeFollower', () => {
  it('measures an override with no size, as the system, and the instance hugs it', async () => {
    const store = storeOf(boardWith({ label: { text: 'a much longer label' } }));
    const changes: ChangeSet[] = [];
    store.subscribe((change) => changes.push(change));
    const follower = new OverrideSizeFollower({ store, environment: ENVIRONMENT });
    await settle();
    const instance = store.get('inst' as ObjectId) as InstanceObject;
    const expected = measureOverrideText(store.read(), instance, 'label', {
      text: 'a much longer label',
    });
    expect(labelRecord(store)).toMatchObject({
      text: 'a much longer label',
      measuredSize: expected?.measuredSize,
    });
    expect(expected?.measuredSize.fonts).toBe(BUNDLED_FONTS_FINGERPRINT);
    // The hugging main's instance takes the measured label plus padding.
    expect(instance.width).toBeCloseTo((expected?.measuredSize.width ?? 0) + 10);
    expect(changes.map(({ origin }) => origin.kind)).toEqual(['system']);
    follower.destroy();
  });

  it('stops, without reading, when a face lands after its store is destroyed', async () => {
    const store = storeOf(boardWith({ label: { text: 'xyz' } }));
    let landed: (() => void) | undefined;
    let isUnsubscribed = false;
    const follower = new OverrideSizeFollower({
      store,
      environment: ENVIRONMENT,
      onFontsChanged: (listener) => {
        landed = listener;
        return () => {
          isUnsubscribed = true;
        };
      },
    });
    await settle();
    store.destroy();
    expect(() => landed?.()).not.toThrow();
    await settle();
    expect(isUnsubscribed).toBe(true);
    follower.destroy();
  });

  it('measures again a size taken with other fonts, and leaves a current one alone', async () => {
    const store = storeOf(
      boardWith({ label: { text: 'xyz', measuredSize: { width: 1, height: 1, fonts: 'old' } } }),
    );
    const follower = new OverrideSizeFollower({ store, environment: ENVIRONMENT });
    await settle();
    expect(labelRecord(store)?.measuredSize).toMatchObject({ fonts: BUNDLED_FONTS_FINGERPRINT });
    const writes: ChangeSet[] = [];
    store.subscribe((change) => writes.push(change));
    const second = new OverrideSizeFollower({ store, environment: ENVIRONMENT });
    await settle();
    expect(writes).toEqual([]);
    second.destroy();
    follower.destroy();
  });

  it('measures again when the main’s text changes under a restyling override', async () => {
    const store = storeOf(boardWith({ label: { textStyle: { fontSize: 32 } } }));
    const follower = new OverrideSizeFollower({ store, environment: ENVIRONMENT });
    await settle();
    const before = labelRecord(store)?.measuredSize as { width: number };
    store.transact(ADA, (transaction) => {
      const label = store.get('label' as ObjectId) as TextObject;
      transaction.setObject({
        ...label,
        text: 'abcdefgh',
        runs: [{ length: 8, style: DEFAULT_TEXT_STYLE }],
      });
    });
    await settle();
    const after = labelRecord(store)?.measuredSize as { width: number };
    expect(after.width).toBeGreaterThan(before.width);
    follower.destroy();
  });

  it('leaves an override no layout reads, and writes nothing for a viewer', async () => {
    const plain = storeOf(boardWith({ label: { text: 'longer' } }, null));
    const follower = new OverrideSizeFollower({ store: plain, environment: ENVIRONMENT });
    await settle();
    expect(labelRecord(plain)?.measuredSize).toBeUndefined();
    follower.destroy();
    const viewed = storeOf(boardWith({ label: { text: 'longer' } }));
    const viewer = new OverrideSizeFollower({
      store: viewed,
      environment: ENVIRONMENT,
      canWrite: () => false,
    });
    await settle();
    expect(labelRecord(viewed)?.measuredSize).toBeUndefined();
    viewer.destroy();
  });

  it('measures again when a variant switch takes the measured text away', async () => {
    const [main, label, instance] = boardWith({});
    if (main === undefined || label === undefined || instance === undefined)
      throw new Error('no board');
    const variants = {
      variantAxes: [{ name: 'size', values: ['big', 'small'] }],
      variantPresets: { 'size=big': { label: { text: 'a very long preset label' } } },
    };
    const store = storeOf([
      { ...main, ...variants },
      label,
      { ...instance, variant: { size: 'big' } } as BoardObject,
    ]);
    const follower = new OverrideSizeFollower({ store, environment: ENVIRONMENT });
    await settle();
    const big = labelRecord(store)?.measuredSize as { width: number };
    // The small variant has no preset text: the label shows the main's "ab" again.
    store.transact(ADA, (transaction) => {
      const current = store.get('inst' as ObjectId) as InstanceObject;
      transaction.setObject({ ...current, variant: { size: 'small' } });
    });
    await settle();
    const now = store.get('inst' as ObjectId) as InstanceObject;
    const expected = measureOverrideText(store.read(), now, 'label', {});
    expect(labelRecord(store)?.measuredSize).toEqual(expected?.measuredSize);
    expect((labelRecord(store)?.measuredSize as { width: number }).width).toBeLessThan(big.width);
    follower.destroy();
  });
});
