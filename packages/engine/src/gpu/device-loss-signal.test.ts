import { describe, expect, it } from 'vitest';

import { DeviceLossSignal } from './device-loss-signal.js';

const LOSS = { message: 'GPU reset', restored: Promise.resolve() };

describe('DeviceLossSignal', () => {
  it('tells every listener once', () => {
    const signal = new DeviceLossSignal();
    const heard: string[] = [];
    signal.add((loss) => heard.push(`first ${loss.message}`));
    signal.add((loss) => heard.push(`second ${loss.message}`));

    signal.fire(LOSS);
    signal.fire(LOSS);

    expect(heard).toEqual(['first GPU reset', 'second GPU reset']);
    expect(signal.isLost).toBe(true);
  });

  it('does not call a listener that stopped listening', () => {
    const signal = new DeviceLossSignal();
    const heard: string[] = [];
    const stop = signal.add(() => heard.push('heard'));

    stop();
    signal.fire(LOSS);

    expect(heard).toEqual([]);
  });

  it('stays quiet once silenced for a deliberate destroy', () => {
    const signal = new DeviceLossSignal();
    const heard: string[] = [];
    signal.add(() => heard.push('heard'));

    signal.silence();
    signal.fire(LOSS);

    expect(heard).toEqual([]);
    expect(signal.isLost).toBe(false);
  });
});
