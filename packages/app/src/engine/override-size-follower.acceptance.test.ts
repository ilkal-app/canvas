import { expect, it, vi } from 'vitest';

import { YjsDocumentStore } from '@canvas/document';
import type {
  AutoLayout,
  ComponentObject,
  InstanceObject,
  ObjectId,
  PageId,
  PrincipalId,
  TextObject,
} from '@canvas/schema';
import { measureOverrideText } from '@canvas/text';

import { DEFAULT_TEXT_STYLE } from '../text-input/font-catalogue.js';

import { OverrideSizeFollower } from './override-size-follower.js';

const ORIGIN = { kind: 'user', principalId: 'user:ada' as PrincipalId } as const;
const ENVIRONMENT = { clock: () => 1, createId: () => 'unused' as ObjectId };
const LAYOUT: AutoLayout = {
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
  createdBy: ORIGIN.principalId,
  createdAt: 1,
  updatedAt: 1,
} as const;

it('retains both instance IDs and writes each measured override after idle', async () => {
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
    autoLayout: LAYOUT,
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
  const instance = (id: string, z: string): InstanceObject => ({
    ...SHARED,
    id: id as ObjectId,
    type: 'instance',
    parentId: null,
    pageId: 'page-1' as PageId,
    x: 200,
    y: 0,
    z,
    width: 60,
    height: 40,
    mainId: main.id,
    overrides: { label: { text: 'a much longer label' } },
  });
  const store = new YjsDocumentStore();
  store.transact(ORIGIN, (tx) => {
    tx.setObject(main);
    tx.setObject(label);
    tx.setObject(instance('one', 'a1'));
    tx.setObject(instance('two', 'a2'));
  });
  const run = store.beginRun();
  const writes = vi.fn();
  store.subscribe((change) => {
    if (change.isLocal && change.origin.kind === 'system') writes();
  });
  const queued: VoidFunction[] = [];
  const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((work) => {
    queued.push(work);
  });
  const follower = new OverrideSizeFollower({ store, environment: ENVIRONMENT });
  try {
    expect(queued).toHaveLength(1);
    expect(() => queued[0]?.()).not.toThrow();
    expect(writes).not.toHaveBeenCalled();
    expect(
      (store.get('one' as ObjectId) as InstanceObject).overrides.label?.measuredSize,
    ).toBeUndefined();
    expect(
      (store.get('two' as ObjectId) as InstanceObject).overrides.label?.measuredSize,
    ).toBeUndefined();
  } finally {
    enqueue.mockRestore();
    run.close();
  }
  await vi.waitFor(() => {
    expect(writes).toHaveBeenCalledTimes(2);
  });
  expect(
    (store.get('one' as ObjectId) as InstanceObject).overrides.label?.measuredSize,
  ).toBeDefined();
  expect(
    (store.get('two' as ObjectId) as InstanceObject).overrides.label?.measuredSize,
  ).toBeDefined();
  const first = store.get('one' as ObjectId) as InstanceObject;
  const expected = measureOverrideText(store.read(), first, 'label', {
    text: 'a much longer label',
  });
  expect(first.overrides.label?.measuredSize).toEqual(expected?.measuredSize);
  expect((store.get('two' as ObjectId) as InstanceObject).overrides.label?.measuredSize).toEqual(
    expected?.measuredSize,
  );
  follower.destroy();
  store.destroy();
});
