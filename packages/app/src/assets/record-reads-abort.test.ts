import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import { newFakeRecord } from './__fixtures__/fake-asset-records.js';
import { settle } from './__fixtures__/manual-schedule.js';
import { HttpAssetSource } from './http-asset-source.js';
import { RecordReads } from './record-reads.js';

const ASSET = 'a'.repeat(64) as AssetId;
const OTHER = 'b'.repeat(64) as AssetId;
const RECORD = newFakeRecord(ASSET, new Uint8Array([1]), 'processing');

afterEach(() => {
  vi.useRealTimers();
});

describe('record read cancellation and deadlines', () => {
  it('releases queued and joining callers promptly without cancelling their shared request', async () => {
    let answer!: (record: AssetRecord) => void;
    const readRecord = vi.fn(
      () =>
        new Promise<AssetRecord>((resolve) => {
          answer = resolve;
        }),
    );
    const reads = new RecordReads(readRecord);
    const first = new AbortController();
    const firstResult = reads.read(ASSET, first.signal).catch((error: unknown) => error);
    await settle();
    const joining = new AbortController();
    const joiningResult = reads.read(ASSET, joining.signal).catch((error: unknown) => error);
    const kept = reads.read(ASSET);
    first.abort(new Error('first left'));
    joining.abort(new Error('joining left'));
    let firstError: unknown;
    let joiningError: unknown;
    void firstResult.then((error) => {
      firstError = error;
    });
    void joiningResult.then((error) => {
      joiningError = error;
    });
    await settle();
    expect(firstError).toBe(first.signal.reason);
    expect(joiningError).toBe(joining.signal.reason);
    await expect(reads.read(ASSET, first.signal)).rejects.toBe(first.signal.reason);
    answer(RECORD);
    expect(await kept).toBe(RECORD);
    expect(readRecord).toHaveBeenCalledTimes(1);
  });

  it('aborts a hung request after thirty seconds and frees its slot even if the transport ignores abort', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const readRecord = vi.fn((assetId: AssetId, signal: AbortSignal) => {
      signals.push(signal);
      return assetId === ASSET
        ? new Promise<AssetRecord>(() => undefined)
        : Promise.resolve(RECORD);
    });
    const reads = new RecordReads(readRecord, 1);
    const timedOut = reads.read(ASSET).catch((error: unknown) => error);
    const queued = reads.read(OTHER);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(readRecord).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await timedOut).toMatchObject({ name: 'TimeoutError' });
    expect(signals[0]?.aborted).toBe(true);
    expect(await queued).toBe(RECORD);
    expect(reads.inFlightCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a refused request’s deadline and keeps a retry independent of a late timed-out response', async () => {
    vi.useFakeTimers();
    let finishOld!: (record: AssetRecord) => void;
    let finishRetry!: (record: AssetRecord) => void;
    const refused = new Error('refused');
    const readRecord = vi
      .fn<() => Promise<AssetRecord>>()
      .mockRejectedValueOnce(refused)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRetry = resolve;
          }),
      );
    const reads = new RecordReads(readRecord, 1);
    await expect(reads.read(ASSET)).rejects.toBe(refused);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    const timeout = reads.read(ASSET).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await timeout).toMatchObject({ name: 'TimeoutError' });
    const retry = reads.read(ASSET);
    await vi.advanceTimersByTimeAsync(0);
    finishOld(RECORD);
    await vi.advanceTimersByTimeAsync(0);
    expect(reads.inFlightCount).toBe(1);
    const shared = reads.read(ASSET);
    const fresh = newFakeRecord(ASSET, new Uint8Array([2]), 'ready');
    finishRetry(fresh);
    expect(await retry).toBe(fresh);
    expect(await shared).toBe(fresh);
    await vi.advanceTimersByTimeAsync(0);
    expect(readRecord).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards the record deadline to the HTTP transport', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((unused: string, init?: RequestInit) => {
      return new Promise<Response>(() => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
      });
    });
    const source = new HttpAssetSource(
      { assetsUrl: 'https://assets.example', boardId: 'test', token: 'test' },
      { fetch, isAvifDecodable: Promise.resolve(false) },
    );
    const result = source.fetchOriginal(ASSET).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    source.destroy();
  });

  it('removes abort listeners and deadlines when a request completes', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reads = new RecordReads(() => Promise.resolve(RECORD));
    expect(await reads.read(ASSET, controller.signal)).toBe(RECORD);
    await vi.advanceTimersByTimeAsync(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
