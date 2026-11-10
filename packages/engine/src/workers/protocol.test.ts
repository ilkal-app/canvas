import { describe, expect, it } from 'vitest';

import {
  createJobRequestMessage,
  describeFailure,
  isJobId,
  isJobReplyMessage,
  isJobRequestMessage,
  isWorkerFaultMessage,
} from './protocol.js';

describe('job protocol', () => {
  it('builds a request message that its own guard accepts', () => {
    const message = createJobRequestMessage(7, 'echo', {
      message: 'hi',
      bytes: new ArrayBuffer(4),
    });

    expect(message).toMatchObject({ type: 'job-request', id: 7, kind: 'echo' });
    expect(isJobRequestMessage(message)).toBe(true);
  });

  it('rejects request envelopes with a bad type, id or kind, or no payload', () => {
    const valid = { type: 'job-request', id: 1, kind: 'layout', payload: {} };

    expect(isJobRequestMessage(valid)).toBe(true);
    expect(isJobRequestMessage({ ...valid, type: 'job-result' })).toBe(false);
    expect(isJobRequestMessage({ ...valid, id: 0 })).toBe(false);
    expect(isJobRequestMessage({ ...valid, id: 1.5 })).toBe(false);
    expect(isJobRequestMessage({ ...valid, kind: 'teleport' })).toBe(false);
    expect(isJobRequestMessage({ ...valid, kind: 'toString' })).toBe(false);
    expect(isJobRequestMessage({ type: 'job-request', id: 1, kind: 'echo' })).toBe(false);
    expect(isJobRequestMessage(null)).toBe(false);
    expect(isJobRequestMessage('job-request')).toBe(false);
  });

  it('accepts well-formed result and error replies', () => {
    expect(isJobReplyMessage({ type: 'job-result', id: 3, payload: { message: 'x' } })).toBe(true);
    expect(
      isJobReplyMessage({
        type: 'job-error',
        id: 3,
        failure: { code: 'handler-failed', name: 'Error', message: 'boom' },
      }),
    ).toBe(true);
  });

  it('rejects replies without an id, a payload or a well-formed failure', () => {
    expect(isJobReplyMessage({ type: 'job-result', payload: {} })).toBe(false);
    expect(isJobReplyMessage({ type: 'job-result', id: 3 })).toBe(false);
    expect(isJobReplyMessage({ type: 'job-error', id: 3, failure: { code: 'x' } })).toBe(false);
    expect(
      isJobReplyMessage({
        type: 'job-error',
        id: 3,
        failure: { code: 'exploded', name: 'Error', message: 'boom' },
      }),
    ).toBe(false);
    expect(isJobReplyMessage({ type: 'job-request', id: 3, payload: {} })).toBe(false);
    expect(isJobReplyMessage(undefined)).toBe(false);
  });

  it('recognises a worker fault and nothing else as one', () => {
    const failure = { code: 'worker-failed', name: 'Error', message: 'lost a request' };

    expect(isWorkerFaultMessage({ type: 'worker-fault', failure })).toBe(true);
    expect(isWorkerFaultMessage({ type: 'worker-fault' })).toBe(false);
    expect(isWorkerFaultMessage({ type: 'job-error', id: 1, failure })).toBe(false);
    expect(isWorkerFaultMessage(null)).toBe(false);
  });

  it('describes thrown errors and thrown non-errors as cloneable failures', () => {
    expect(describeFailure('handler-failed', new RangeError('too big'))).toEqual({
      code: 'handler-failed',
      name: 'RangeError',
      message: 'too big',
    });
    expect(describeFailure('handler-failed', 42)).toEqual({
      code: 'handler-failed',
      name: 'Error',
      message: '42',
    });
  });

  it('treats only positive integers as job ids', () => {
    expect(isJobId(1)).toBe(true);
    expect(isJobId(-1)).toBe(false);
    expect(isJobId('1')).toBe(false);
  });
});
