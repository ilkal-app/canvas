import { describe, expect, it } from 'vitest';

import { applyCommand, mustGet } from '../commands/__fixtures__/command-fixtures.js';
import { groupCommand } from '../commands/group.js';
import { Link } from '../history/__fixtures__/history-fixtures.js';
import { BOB } from '../store/__fixtures__/store-fixtures.js';
import type { YjsDocumentStore } from '../store/yjs-document-store.js';

import { createFrameClients, moveInto } from './__fixtures__/cycle-fixtures.js';
import { expectValidAndConverged, ORDERS } from './__fixtures__/repair-fixtures.js';

describe.each(ORDERS)(
  'a group is the lowest cycle member ($name)',
  ({ adaClientId, bobClientId }) => {
    it('reroots the group and retains its contents', () => {
      const [ada, bob] = createFrameClients([adaClientId, bobClientId]) as [
        YjsDocumentStore,
        YjsDocumentStore,
      ];
      const link = new Link(ada, bob);
      applyCommand(ada, groupCommand, { ids: ['frame-side', 'rect-free'], groupId: 'a-group' });
      link.deliver();
      link.disconnect();
      moveInto(ada, 'frame-outer', 'frame-side', { x: 800, y: 0 });
      moveInto(bob, 'a-group', 'frame-outer', { x: -500, y: 0 }, BOB);
      link.reconnect();
      expect(mustGet(ada, 'a-group').parentId).toBeNull();
      expect(mustGet(ada, 'frame-side').parentId).toBe('a-group');
      expect(mustGet(ada, 'rect-free').parentId).toBe('a-group');
      expect(mustGet(ada, 'frame-outer').parentId).toBe('frame-side');
      expectValidAndConverged(ada, bob);
      ada.destroy();
      bob.destroy();
    });
  },
);
