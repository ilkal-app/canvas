import { expect, it } from 'vitest';

import { decodeAtomicFrame, encodeAtomicFrame, isAtomicFrame } from './atomic-frame.js';

it('round trips capability, exact part bytes and decimal cursor metadata', () => {
  const hello = {
    kind: 'hello' as const,
    boardId: 'board',
    capability: 'atomic-batch-v1' as const,
  };
  expect(decodeAtomicFrame(encodeAtomicFrame(hello))).toEqual({
    header: hello,
    payload: new Uint8Array(),
  });
  const part = { kind: 'part' as const, boardId: 'board', batchId: 'batch-1', index: 0 };
  const input = new Uint8Array([99, 0, 255, 42, 88]);
  const encoded = encodeAtomicFrame(part, input.subarray(1, 4));
  input.fill(0);
  const decoded = decodeAtomicFrame(encoded);
  expect(decoded).toEqual({ header: part, payload: new Uint8Array([0, 255, 42]) });
  encoded.fill(0);
  expect(decoded.payload).toEqual(new Uint8Array([0, 255, 42]));
  const receipt = {
    kind: 'receipt' as const,
    boardId: 'board',
    batchId: 'batch-1',
    commitCursor: '90071992547409930',
  };
  expect(decodeAtomicFrame(encodeAtomicFrame(receipt)).header).toEqual(receipt);
});

it('refuses unknown versions, malformed UTF8/JSON, trailing bytes and oversized metadata', () => {
  const valid = encodeAtomicFrame({ kind: 'hello', boardId: 'b', capability: 'atomic-batch-v1' });
  for (const length of [0, 3, 7, valid.length - 1])
    expect(() => decodeAtomicFrame(valid.subarray(0, length))).toThrow();
  const version = valid.slice();
  version[3] = 2;
  expect(() => decodeAtomicFrame(version)).toThrow();
  const trailing = new Uint8Array(valid.length + 1);
  trailing.set(valid);
  expect(() => decodeAtomicFrame(trailing)).toThrow();
  const badUtf8 = valid.slice();
  badUtf8[8] = 255;
  expect(() => decodeAtomicFrame(badUtf8)).toThrow();
  const badJson = valid.slice();
  badJson[8] = 0;
  expect(() => decodeAtomicFrame(badJson)).toThrow();
  const huge = valid.slice();
  new DataView(huge.buffer).setUint32(4, 65536);
  expect(() => decodeAtomicFrame(huge)).toThrow();
  expect(isAtomicFrame(valid)).toBe(true);
  expect(isAtomicFrame(version)).toBe(true);
  expect(isAtomicFrame(new Uint8Array([0, 1, 2]))).toBe(false);
});

it('rejects client authority spoofing and noncanonical identity or cursor fields', () => {
  const pack = (value: unknown): Uint8Array => {
    const json = new TextEncoder().encode(JSON.stringify(value));
    const bytes = new Uint8Array(8 + json.length);
    bytes.set([67, 65, 66, 1]);
    new DataView(bytes.buffer).setUint32(4, json.length);
    bytes.set(json, 8);
    return bytes;
  };
  const begin = {
    kind: 'begin',
    boardId: 'b',
    batchId: 'x',
    partCount: 1,
    totalBytes: 3,
    digest: 'a'.repeat(64),
  };
  for (const extra of [
    { principalId: 'other' },
    { ownershipEpoch: '1' },
    { connectionSessionId: 'x' },
  ])
    expect(() => decodeAtomicFrame(pack({ ...begin, ...extra }))).toThrow();
  for (const commitCursor of ['01', '-1', '1e5', '', 1])
    expect(() =>
      decodeAtomicFrame(pack({ kind: 'receipt', boardId: 'b', batchId: 'x', commitCursor })),
    ).toThrow();
  for (const change of [
    { partCount: 0 },
    { partCount: 257 },
    { totalBytes: 0 },
    { totalBytes: 67108865 },
    { digest: 'A'.repeat(64) },
    { batchId: '../x' },
  ])
    expect(() => decodeAtomicFrame(pack({ ...begin, ...change }))).toThrow();
});

it('bounds raw parts and forbids payloads on metadata-only frames', () => {
  expect(() => encodeAtomicFrame({ kind: 'part', boardId: 'b', batchId: 'x', index: 0 })).toThrow();
  expect(() =>
    encodeAtomicFrame(
      { kind: 'part', boardId: 'b', batchId: 'x', index: 0 },
      new Uint8Array(8 * 1024 * 1024 + 1),
    ),
  ).toThrow();
  expect(() =>
    encodeAtomicFrame({ kind: 'commit', boardId: 'b', batchId: 'x' }, new Uint8Array([1])),
  ).toThrow();
});
