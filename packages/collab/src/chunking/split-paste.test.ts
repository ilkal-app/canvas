// Fix round 1: a paste of up to 1,000 objects is one transaction, and when its update is
// split by struct ranges a peer sees it in parts. `createObjects` writes referents before
// referrers whatever the input order, so no part leaves a dangling reference for an editor
// peer's repair to act on.
import { expect, it } from 'vitest';

import {
  createLargeBoardObjects,
  createObjectsCommand,
  createObjectsInputSchema,
  runCommand,
  SYSTEM_ORIGIN,
  YjsDocumentStore,
  type TransactionOrigin,
} from '@canvas/document';
import { createSeededIdGenerator, type PrincipalId } from '@canvas/schema';

import { splitUpdate } from './split-update.js';

/** The fields `createObjects` generates, which a listed object leaves out. */
const GENERATED: ReadonlySet<string> = new Set(['z', 'createdBy', 'createdAt', 'updatedAt']);

const ADA: TransactionOrigin = { kind: 'user', principalId: 'user:ada' as PrincipalId };

it('a referrer-first paste split by struct ranges makes an editor peer repair nothing', () => {
  // Children before their frames, connectors and comments before their targets.
  const listed = createLargeBoardObjects(600, 41)
    .map((object) =>
      Object.fromEntries(Object.entries(object).filter(([key]) => !GENERATED.has(key))),
    )
    .reverse();
  const store = new YjsDocumentStore();
  const updates: Uint8Array[] = [];
  store.subscribeUpdates(({ update }) => updates.push(update));
  const outcome = runCommand(
    store,
    ADA,
    createObjectsCommand,
    createObjectsInputSchema.parse({ objects: listed }),
    { clock: () => 1_770_000_000_000, createId: createSeededIdGenerator(41) },
  );
  expect(outcome.status).toBe('applied');
  expect(updates).toHaveLength(1);
  const chunks = splitUpdate(updates[0] ?? new Uint8Array(), 8 * 1024);
  expect(chunks.length).toBeGreaterThan(20);
  const peer = new YjsDocumentStore();
  let repairs = 0;
  peer.subscribeUpdates(({ isLocal }) => {
    if (isLocal) repairs += 1;
  });
  for (const chunk of chunks) peer.applyUpdate(chunk, SYSTEM_ORIGIN);
  expect(repairs).toBe(0);
  expect(peer.encodeStateVector()).toEqual(store.encodeStateVector());
});
