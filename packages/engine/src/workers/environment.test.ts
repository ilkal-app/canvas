import { describe, expect, it } from 'vitest';

import { chooseWorkerCount, detectWorkerEnvironment } from './environment.js';

// Stands in for the `Worker` constructor: only its being a function matters.
const fakeWorkerConstructor = (): void => undefined;

describe('detectWorkerEnvironment', () => {
  it('reports workers and the core count a browser exposes', () => {
    const environment = detectWorkerEnvironment({
      Worker: fakeWorkerConstructor,
      navigator: { hardwareConcurrency: 8 },
    });

    expect(environment).toEqual({ hasWorkers: true, hardwareConcurrency: 8 });
  });

  it('reports no workers when the host has no Worker constructor', () => {
    expect(detectWorkerEnvironment({ navigator: { hardwareConcurrency: 8 } }).hasWorkers).toBe(
      false,
    );
    expect(detectWorkerEnvironment({ Worker: 'not a constructor' }).hasWorkers).toBe(false);
  });

  it('assumes two cores when the host does not say, or says something unusable', () => {
    expect(detectWorkerEnvironment({}).hardwareConcurrency).toBe(2);
    expect(
      detectWorkerEnvironment({ navigator: { hardwareConcurrency: 0 } }).hardwareConcurrency,
    ).toBe(2);
    expect(
      detectWorkerEnvironment({ navigator: { hardwareConcurrency: Number.NaN } })
        .hardwareConcurrency,
    ).toBe(2);
  });
});

describe('chooseWorkerCount', () => {
  it('leaves one core for the main thread', () => {
    expect(chooseWorkerCount({ hasWorkers: true, hardwareConcurrency: 4 })).toBe(3);
  });

  it('caps the pool at four workers by default, or at the given maximum', () => {
    expect(chooseWorkerCount({ hasWorkers: true, hardwareConcurrency: 16 })).toBe(4);
    expect(chooseWorkerCount({ hasWorkers: true, hardwareConcurrency: 16 }, 2)).toBe(2);
  });

  it('keeps at least one worker on a single-core device', () => {
    expect(chooseWorkerCount({ hasWorkers: true, hardwareConcurrency: 1 })).toBe(1);
  });

  it('chooses no workers when workers are unavailable, so jobs run on the main thread', () => {
    expect(chooseWorkerCount({ hasWorkers: false, hardwareConcurrency: 8 })).toBe(0);
  });

  it('rejects a maximum below one', () => {
    expect(() => chooseWorkerCount({ hasWorkers: true, hardwareConcurrency: 8 }, 0)).toThrow(
      RangeError,
    );
    expect(() => chooseWorkerCount({ hasWorkers: true, hardwareConcurrency: 8 }, 1.5)).toThrow(
      RangeError,
    );
  });
});
