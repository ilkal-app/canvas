// The board bound and the reference repair: re-rooting an orphan composes it into its
// grandparent's frame, so an orphan placed past the bound (by a peer that skips validation) keeps
// that place with coordinates stored as computed. The repair is the system's, not a command: it
// is never refused for the bound, so the orphan is repaired on every peer instead of staying a
// missing-parent.
import { describe, expect, it } from 'vitest';

import { BOARD_BOUND } from '@canvas/schema';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { createObjectCommand } from '../commands/create-object.js';
import { deleteObjectsCommand } from '../commands/delete-objects.js';
import { createClientPair, Link } from '../history/__fixtures__/history-fixtures.js';
import {
  readStoredEntry,
  writeStoredEntriesRemotely,
} from '../store/__fixtures__/remote-values.js';
import { BOB, exchange } from '../store/__fixtures__/store-fixtures.js';

import {
  BOB_ENVIRONMENT,
  expectValidAndConverged,
  newShape,
  ORDERS,
} from './__fixtures__/repair-fixtures.js';

describe.each(ORDERS)(
  'an orphan re-rooted past the bound ($name)',
  ({ adaClientId, bobClientId }) => {
    it('is still moved to the deleted group’s parent, on both clients, with the composed values', () => {
      const [ada, bob] = createClientPair(adaClientId, bobClientId);
      const link = new Link(ada, bob);
      link.disconnect();
      applyCommand(ada, deleteObjectsCommand, { ids: ['group-diagram'] });
      const near = BOARD_BOUND - 100;
      applyCommand(
        bob,
        createObjectCommand,
        { object: newShape('shape-late', 'group-diagram', 40) },
        BOB,
        BOB_ENVIRONMENT,
      );
      // A peer that skips validation places it B - 100 out along both axes in the group.
      const placement = readStoredEntry(bob, 'shape-late', 'placement') as object;
      writeStoredEntriesRemotely(bob, 'shape-late', {
        placement: { ...placement, x: near, y: -near },
      });
      link.reconnect();
      // The raw write is not a command, so the link does not carry it: hand it over.
      exchange(ada, bob);
      for (const store of [ada, bob]) {
        const moved = mustGet(store, 'shape-late');
        expect(moved.parentId).toBe('frame-plan');
        expect(Number.isFinite(moved.x)).toBe(true);
        expect(moved.x).toBeGreaterThan(BOARD_BOUND);
      }
      expectValidAndConverged(ada, bob);
    });

    it('is still moved when two stored rotations of 1e308 sum to an infinity (M1)', () => {
      const [ada, bob] = createClientPair(adaClientId, bobClientId);
      const link = new Link(ada, bob);
      // The group turned by 1e308, written by a peer that skips validation, on both clients.
      const placement = readStoredEntry(ada, 'group-diagram', 'placement') as object;
      writeStoredEntriesRemotely(ada, 'group-diagram', {
        placement: { ...placement, rotation: 1e308 },
      });
      exchange(ada, bob);
      link.disconnect();
      applyCommand(ada, deleteObjectsCommand, { ids: ['group-diagram'] });
      applyCommand(
        bob,
        createObjectCommand,
        { object: newShape('shape-late', 'group-diagram', 40) },
        BOB,
        BOB_ENVIRONMENT,
      );
      // Its own rotation is far too, on Bob's side.
      const own = readStoredEntry(bob, 'shape-late', 'placement') as object;
      writeStoredEntriesRemotely(bob, 'shape-late', { placement: { ...own, rotation: 1e308 } });
      link.reconnect();
      // The raw write is not a command, so the link does not carry it: hand it over.
      exchange(ada, bob);
      for (const store of [ada, bob]) {
        const moved = mustGet(store, 'shape-late');
        expect(moved.parentId).toBe('frame-plan');
        expect(Number.isFinite(moved.rotation)).toBe(true);
      }
      expectValidAndConverged(ada, bob);
    });
  },
);
