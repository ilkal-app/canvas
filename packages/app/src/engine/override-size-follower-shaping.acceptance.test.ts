/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { YjsDocumentStore, type ChangeSet } from '@canvas/document';
import type {
  AutoLayout,
  BoardObject,
  ComponentObject,
  InstanceObject,
  ObjectId,
  PageId,
  PrincipalId,
  TextObject,
  TextStyle,
} from '@canvas/schema';
import {
  bundledFontFile,
  createTextShaping,
  loadShaper,
  measureOverrideText,
  type FontFaceKey,
  type SyncFontBytesSource,
} from '@canvas/text';

import { OverrideSizeFollower } from './override-size-follower.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const ADA = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ENVIRONMENT = { clock: () => 1_790_000_000_000, createId: () => 'x' as ObjectId };
const STYLE: TextStyle = {
  fontFamily: 'EB Garamond',
  fontSize: 20,
  color: 'ink',
  weight: 400,
  italic: false,
};
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

function storeOf(): YjsDocumentStore {
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
    autoLayout: ROW,
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
    runs: [{ length: 2, style: STYLE }],
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
    overrides: { label: { text: 'office' } },
  };
  const store = new YjsDocumentStore();
  store.transact(ADA, (transaction) => {
    for (const object of [main, label, instance] as BoardObject[]) transaction.setObject(object);
  });
  return store;
}

function instanceOf(store: YjsDocumentStore): InstanceObject {
  const object = store.get('inst' as ObjectId);
  if (object?.type !== 'instance') throw new Error('Expected test instance');
  return object;
}

function storedSize(store: YjsDocumentStore): unknown {
  return instanceOf(store).overrides.label?.measuredSize;
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

class MutableSource implements SyncFontBytesSource {
  hasEbGaramond = true;

  bytesOf(face: FontFaceKey): Uint8Array | undefined {
    if (!this.hasEbGaramond && face.family === STYLE.fontFamily) return undefined;
    const path = bundledFontFile(face);
    return path === undefined ? undefined : readFileSync(new URL(path, REPO_ROOT));
  }
}

describe('OverrideSizeFollower shaped measurements', () => {
  it('stores the shaped EB Garamond office size instead of the metrics size', async () => {
    const store = storeOf();
    const shaping = createTextShaping(await loadShaper(), new MutableSource());
    const follower = new OverrideSizeFollower({
      store,
      environment: ENVIRONMENT,
      textShaping: () => shaping,
    });
    await settle();
    const instance = instanceOf(store);
    const record = { text: 'office' };
    const shaped = measureOverrideText(store.read(), instance, 'label', record, shaping);
    const metrics = measureOverrideText(store.read(), instance, 'label', record);
    expect(storedSize(store)).toEqual(shaped?.measuredSize);
    expect(shaped?.measuredSize.width).not.toBeCloseTo(metrics?.measuredSize.width ?? 0, 8);
    follower.destroy();
  });

  it('keeps metrics measurement when textShaping is absent', async () => {
    const store = storeOf();
    const follower = new OverrideSizeFollower({ store, environment: ENVIRONMENT });
    await settle();
    expect(storedSize(store)).toEqual(
      measureOverrideText(store.read(), instanceOf(store), 'label', { text: 'office' })
        ?.measuredSize,
    );
    follower.destroy();
  });

  it('writes nothing while the page shaper is unavailable', async () => {
    const store = storeOf();
    const writes: ChangeSet[] = [];
    store.subscribe((change) => writes.push(change));
    const follower = new OverrideSizeFollower({
      store,
      environment: ENVIRONMENT,
      textShaping: () => undefined,
    });
    await settle();
    expect(storedSize(store)).toBeUndefined();
    expect(writes).toEqual([]);
    follower.destroy();
  });

  it('requests a missing EB Garamond face and writes after remeasure when it loads', async () => {
    const store = storeOf();
    const source = new MutableSource();
    source.hasEbGaramond = false;
    const shaping = createTextShaping(await loadShaper(), source, { readFiles: 'when-shaped' });
    const onMissingFace = vi.fn<(face: FontFaceKey) => void>();
    const writes: ChangeSet[] = [];
    store.subscribe((change) => writes.push(change));
    const follower = new OverrideSizeFollower({
      store,
      environment: ENVIRONMENT,
      textShaping: () => shaping,
      onMissingFace,
    });
    await settle();
    expect(storedSize(store)).toBeUndefined();
    expect(writes).toEqual([]);
    expect(onMissingFace).toHaveBeenCalledOnce();
    expect(onMissingFace.mock.calls[0]?.[0]).toEqual({
      family: 'EB Garamond',
      weight: 400,
      isItalic: false,
    });
    source.hasEbGaramond = true;
    follower.remeasure();
    await settle();
    expect(storedSize(store)).toEqual(
      measureOverrideText(store.read(), instanceOf(store), 'label', { text: 'office' }, shaping)
        ?.measuredSize,
    );
    expect(writes).toHaveLength(1);
    follower.destroy();
  });

  it('remeasures a successful size without another write when it is unchanged', async () => {
    const store = storeOf();
    const shaping = createTextShaping(await loadShaper(), new MutableSource());
    const follower = new OverrideSizeFollower({
      store,
      environment: ENVIRONMENT,
      textShaping: () => shaping,
    });
    await settle();
    const first = storedSize(store);
    expect(first).toBeDefined();
    const writes: ChangeSet[] = [];
    store.subscribe((change) => writes.push(change));
    follower.remeasure();
    await settle();
    expect(storedSize(store)).toEqual(first);
    expect(writes).toEqual([]);
    follower.destroy();
  });
});
