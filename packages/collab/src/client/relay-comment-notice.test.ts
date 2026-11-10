import * as encoding from 'lib0/encoding';
import { expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { YjsDocumentStore } from '@canvas/document';

import { OutboundQueue } from './outbound-queue.js';
import type { RelayConnectionHost } from './relay-connection-host.js';
import { RelayConnection } from './relay-connection.js';

function frame(type: number, write: (encoder: encoding.Encoder) => void, board = 'board') {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, board);
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

it('notifies only authenticated board listeners and keeps keepalive separate', () => {
  const store = new YjsDocumentStore();
  const document = new Y.Doc();
  const awareness = new Awareness(document);
  awareness.setLocalState(null);
  const notice = vi.fn();
  const host: RelayConnectionHost = {
    documentName: 'board',
    token: 'local-test-token',
    store,
    awareness,
    queue: new OutboundQueue(),
    reportError: vi.fn(),
    onStructRangeSplit: vi.fn(),
    applyRemoteUpdate: vi.fn(),
    onAuthenticated: vi.fn(),
    onSynced: vi.fn(),
    onProgress: vi.fn(),
    onRejected: vi.fn(),
    onClosedByRelay: vi.fn(),
    onThreadsChanged: notice,
  };
  const send = vi.fn();
  const connection = new RelayConnection(host, send);
  const change = frame(5, (encoder) => {
    encoding.writeVarString(encoder, '{"type":"threads-changed"}');
  });
  connection.receive(change);
  expect(notice).not.toHaveBeenCalled();
  const authenticate = frame(2, (encoder) => {
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarString(encoder, 'read-write');
  });
  connection.receive(authenticate);
  connection.receive(change);
  expect(notice).toHaveBeenCalledOnce();
  connection.receive(
    frame(
      5,
      (encoder) => {
        encoding.writeVarString(encoder, '{"type":"threads-changed"}');
      },
      'other',
    ),
  );
  connection.receive(
    frame(5, (encoder) => {
      encoding.writeVarString(encoder, '{"type":"keepalive"}');
    }),
  );
  expect(notice).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledTimes(2);
  const withoutNotice = { ...host };
  delete withoutNotice.onThreadsChanged;
  const standalone = new RelayConnection(withoutNotice, vi.fn());
  standalone.receive(authenticate);
  expect(() => {
    standalone.receive(change);
  }).not.toThrow();
  standalone.dispose();
  connection.dispose();
  awareness.destroy();
  document.destroy();
  store.destroy();
});
