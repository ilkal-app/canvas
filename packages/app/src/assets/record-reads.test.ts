import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import { newFakeRecord } from './__fixtures__/fake-asset-records.js';
import { settle } from './__fixtures__/manual-schedule.js';
import { AssetsHttpError } from './assets-responses.js';
import { MAX_RECORD_READS, RecordReads } from './record-reads.js';

/**
 * An asset id for a number.
 *
 * @param index - The number.
 * @returns A distinct id.
 */
function assetNumber(index: number): AssetId {
  return createHash('sha256')
    .update(`read ${String(index)}`)
    .digest('hex') as AssetId;
}

/**
 * A record request each test answers by hand, counting what is in flight.
 *
 * @returns The request, the ids in the order sent, the most in flight at once, and a function
 *   that answers the oldest pending requests.
 */
function manualService() {
  const sent: AssetId[] = [];
  const pending: { readonly assetId: AssetId; readonly answer: () => void }[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  const readRecord = (assetId: AssetId) =>
    new Promise<AssetRecord>((resolve) => {
      sent.push(assetId);
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      pending.push({
        assetId,
        answer: () => {
          inFlight -= 1;
          resolve(newFakeRecord(assetId, new Uint8Array([1]), 'processing'));
        },
      });
    });
  const answer = async (count = Number.POSITIVE_INFINITY) => {
    do {
      for (const request of pending.splice(0, count)) request.answer();
      await settle();
    } while (count === Number.POSITIVE_INFINITY && pending.length > 0);
  };
  return { readRecord, sent, answer, mostInFlight: () => mostInFlight };
}

describe('RecordReads', () => {
  it('keeps at most twelve reads in flight for 5,000 unknown assets at load', async () => {
    const service = manualService();
    const reads = new RecordReads(service.readRecord);
    const all = Array.from({ length: 5000 }, (unused, index) => reads.read(assetNumber(index)));
    await settle();
    expect(reads.inFlightCount).toBe(MAX_RECORD_READS);
    while (service.sent.length < 5000) await service.answer(MAX_RECORD_READS);
    await service.answer();
    expect((await Promise.all(all)).length).toBe(5000);
    expect(service.mostInFlight()).toBe(MAX_RECORD_READS);
    expect(new Set(service.sent).size).toBe(5000);
  });

  it('reads the images on screen first, then those near the view, then the rest', async () => {
    const service = manualService();
    const reads = new RecordReads(service.readRecord, 4);
    const visible = new Set([assetNumber(900), assetNumber(901), assetNumber(902)]);
    const near = new Set([assetNumber(800), assetNumber(801)]);
    reads.setPriorities(visible, near);
    for (let index = 0; index < 1000; index += 1) void reads.read(assetNumber(index));
    await settle();
    expect(service.sent.slice(0, 4)).toEqual([...visible, assetNumber(800)]);
    await service.answer(4);
    expect(service.sent.slice(4, 8)).toEqual([assetNumber(801), ...[0, 1, 2].map(assetNumber)]);
    // The view moved: what is on screen now goes before the rest.
    reads.setPriorities(new Set([assetNumber(500)]), new Set());
    await service.answer(1);
    expect(service.sent[8]).toBe(assetNumber(500));
    await service.answer();
  });

  it('looks through the queue when the preferred set is the larger', async () => {
    const service = manualService();
    const reads = new RecordReads(service.readRecord, 1);
    reads.setPriorities(
      new Set(Array.from({ length: 10 }, (unused, index) => assetNumber(index))),
      new Set(),
    );
    void reads.read(assetNumber(50));
    void reads.read(assetNumber(51));
    void reads.read(assetNumber(3));
    await settle();
    expect(service.sent).toEqual([assetNumber(3)]);
    await service.answer(1);
    expect(service.sent).toEqual([assetNumber(3), assetNumber(50)]);
    await service.answer();
  });

  it('shares one request between reads of one asset, queued or in flight', async () => {
    const service = manualService();
    const reads = new RecordReads(service.readRecord, 1);
    const blocker = reads.read(assetNumber(0));
    const [first, second] = [reads.read(assetNumber(1)), reads.read(assetNumber(1))];
    await settle();
    const third = reads.read(assetNumber(0));
    await service.answer();
    await service.answer();
    expect(await blocker).toBe(await third);
    expect(await first).toBe(await second);
    expect(service.sent).toEqual([assetNumber(0), assetNumber(1)]);
  });

  it('rejects a caller whose signal aborts while it waits, and drops a read no one waits for', async () => {
    const service = manualService();
    const reads = new RecordReads(service.readRecord, 1);
    void reads.read(assetNumber(0));
    const kept = reads.read(assetNumber(1));
    const controller = new AbortController();
    const dropped = reads.read(assetNumber(2), controller.signal);
    const shared = new AbortController();
    const leaving = reads.read(assetNumber(1), shared.signal);
    controller.abort(new Error('gone'));
    shared.abort(new Error('left'));
    await expect(dropped).rejects.toThrow('gone');
    await expect(leaving).rejects.toThrow('left');
    // Aborting again, or a signal aborted before the read, changes nothing else.
    controller.abort();
    await expect(reads.read(assetNumber(3), controller.signal)).rejects.toThrow('gone');
    await service.answer();
    await service.answer();
    expect((await kept).id).toBe(assetNumber(1));
    expect(service.sent).toEqual([assetNumber(0), assetNumber(1)]);
  });

  it('passes a refusal to every caller, and rejects the waiting reads when cleared', async () => {
    const refused = new AssetsHttpError(404, 'not-found', 'unknown');
    let calls = 0;
    const answers: ((record: AssetRecord) => void)[] = [];
    const reads = new RecordReads(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(refused)
        : new Promise<AssetRecord>((resolve) => answers.push(resolve));
    }, 2);
    const [first, second] = [reads.read(assetNumber(0)), reads.read(assetNumber(0))];
    await expect(first).rejects.toBe(refused);
    await expect(second).rejects.toBe(refused);
    const running = Promise.allSettled([reads.read(assetNumber(1)), reads.read(assetNumber(2))]);
    const waiting = reads.read(assetNumber(3));
    await settle();
    reads.clear();
    await expect(waiting).rejects.toThrow('closed');
    expect((await running).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    for (const answer of answers)
      answer(newFakeRecord(assetNumber(1), new Uint8Array([1]), 'processing'));
    await settle();
  });
});
