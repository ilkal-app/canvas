import * as encoding from 'lib0/encoding';
import { expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { SYSTEM_ORIGIN, YjsDocumentStore } from '@canvas/document';

import { OutboundQueue } from './outbound-queue.js';
import { RelayConnection } from './relay-connection.js';
import {
  decodeRelayMessage,
  encodeSyncStep1,
  encodeSyncStep2,
  RELAY_MESSAGE_TYPES,
} from './relay-protocol.js';

function response(kind: 'auth' | 'syncStatus', isAccepted: boolean): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, 'board');
  encoding.writeVarUint(encoder, RELAY_MESSAGE_TYPES[kind]);
  encoding.writeVarUint(encoder, kind === 'auth' ? 2 : isAccepted ? 1 : 0);
  if (kind === 'auth') encoding.writeVarString(encoder, isAccepted ? 'read-write' : 'readonly');
  return encoding.toUint8Array(encoder);
}

it.each([
  { isAccepted: true, isInboundFirst: true },
  { isAccepted: false, isInboundFirst: true },
  { isAccepted: true, isInboundFirst: false },
])(
  'waits for every accepted initial chunk and inbound sync: %j',
  ({ isAccepted, isInboundFirst }) => {
    const source = new Y.Doc();
    source.getMap('payload').set('one', 'a'.repeat(600_000));
    source.getMap('payload').set('two', 'b'.repeat(600_000));
    const store = new YjsDocumentStore();
    store.applyUpdate(Y.encodeStateAsUpdate(source), SYSTEM_ORIGIN);
    const awarenessDoc = new Y.Doc();
    const awareness = new Awareness(awarenessDoc);
    const frames: Uint8Array[] = [];
    const noop = (): void => undefined;
    const connection = new RelayConnection(
      {
        documentName: 'board',
        token: 'token',
        store,
        awareness,
        queue: new OutboundQueue(),
        reportError: noop,
        onStructRangeSplit: noop,
        applyRemoteUpdate: noop,
        onAuthenticated: noop,
        onSynced: noop,
        onProgress: noop,
        onRejected: noop,
        onClosedByRelay: noop,
      },
      (frame) => {
        frames.push(frame);
      },
    );
    try {
      connection.receive(response('auth', true));
      connection.receive(encodeSyncStep1('board', Y.encodeStateVector(new Map())));
      const chunks = frames.filter(
        (frame) => decodeRelayMessage(frame, 'board').kind === 'sync-step-2',
      );
      expect(chunks.length).toBeGreaterThan(1);
      if (isInboundFirst) connection.receive(encodeSyncStep2('board', new Uint8Array([0, 0])));
      expect(connection.isSyncAcknowledged).toBe(false);
      for (let index = 1; index < chunks.length; index += 1) {
        connection.receive(response('syncStatus', true));
        expect(connection.isSyncAcknowledged).toBe(false);
      }
      connection.receive(response('syncStatus', isAccepted));
      expect(connection.isSyncAcknowledged).toBe(isAccepted && isInboundFirst);
      if (!isInboundFirst) connection.receive(encodeSyncStep2('board', new Uint8Array([0, 0])));
      connection.receive(response('syncStatus', true));
      expect(connection.isSyncAcknowledged).toBe(isAccepted);
    } finally {
      connection.dispose();
      awareness.destroy();
      awarenessDoc.destroy();
      store.destroy();
      source.destroy();
    }
  },
);
