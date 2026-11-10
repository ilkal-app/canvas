import { describe, expect, it } from 'vitest';

import type { AssetId, AssetRecord } from '@canvas/schema';

import { ProcessingImages } from './processing-images.js';
import { ProcessingReport } from './processing-report.js';

const A = 'a'.repeat(64) as AssetId;
const B = 'b'.repeat(64) as AssetId;
const C = 'c'.repeat(64) as AssetId;
const D = 'd'.repeat(64) as AssetId;

/**
 * A record with a status.
 *
 * @param id - Its asset.
 * @param status - Its status.
 * @returns The record (only what the report reads).
 */
function record(id: AssetId, status: AssetRecord['status']): AssetRecord {
  return { id, status } as AssetRecord;
}

describe('ProcessingReport', () => {
  it('reports the processing assets seen on screen, sorted, only when they change', () => {
    const reports: (readonly AssetId[])[] = [];
    const own = new Set<AssetId>([C]);
    const report = new ProcessingReport(
      (assetIds) => reports.push(assetIds),
      (id) => own.has(id),
    );
    report.learn(record(B, 'processing'));
    report.learn(record(C, 'processing'));
    expect(reports).toEqual([]);
    report.setVisible(new Set([C, B, A]));
    expect(reports).toEqual([[B]]);
    // A record learnt while its placeholder is on screen shows at once.
    report.learn(record(A, 'uploading'));
    expect(reports).toEqual([[B], [A, B]]);
    report.learn(record(B, 'processing'));
    report.setVisible(new Set([A, B, C]));
    expect(reports).toHaveLength(2);
    // Drawn from its original meanwhile (no longer a placeholder): it stays until its record
    // settles, so the spinner does not flicker.
    report.setVisible(new Set());
    expect(reports).toHaveLength(2);
    report.learn(record(B, 'ready'));
    expect(reports.at(-1)).toEqual([A]);
    report.learn(record(A, 'failed'));
    expect(reports.at(-1)).toEqual([]);
    report.learn(record(D, 'ready'));
    // Off screen: learnt without a report, shown once it comes on screen.
    report.learn(record(B, 'processing'));
    expect(reports).toHaveLength(4);
    report.setVisible(new Set([B]));
    expect(reports.at(-1)).toEqual([B]);
    report.clear();
    expect(reports.at(-1)).toEqual([]);
    report.learn(record(A, 'processing'));
    expect(reports.at(-1)).toEqual([]);
  });

  it('needs no listener', () => {
    const report = new ProcessingReport(undefined, () => false);
    report.learn(record(A, 'processing'));
    expect(() => {
      report.setVisible(new Set([A]));
    }).not.toThrow();
  });
});

describe('ProcessingImages', () => {
  it('keeps the last report, the same array until the next, and tells its listeners', () => {
    const images = new ProcessingImages();
    const empty = images.snapshot();
    expect(empty).toEqual([]);
    let calls = 0;
    const stop = images.subscribe(() => (calls += 1));
    images.set([A]);
    expect(images.snapshot()).toEqual([A]);
    expect(images.snapshot()).toBe(images.snapshot());
    images.set([]);
    expect(images.snapshot()).toBe(empty);
    stop();
    images.set([B]);
    expect(calls).toBe(2);
  });
});
