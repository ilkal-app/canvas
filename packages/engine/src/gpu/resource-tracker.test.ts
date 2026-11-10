import { describe, expect, it } from 'vitest';

import { ResourceTracker } from './resource-tracker.js';

/** A resource that counts its destroys and untracks itself, as the WebGL2 handles do. */
class CountingResource {
  destroyCount = 0;

  constructor(private readonly tracker: ResourceTracker) {
    tracker.track(this);
  }

  destroy(): void {
    this.destroyCount += 1;
    this.tracker.untrack(this);
  }
}

describe('ResourceTracker', () => {
  it('destroys every live resource once when the backend is destroyed', () => {
    const tracker = new ResourceTracker();
    const resources = [new CountingResource(tracker), new CountingResource(tracker)];
    tracker.destroyAll();
    expect(resources.map((resource) => resource.destroyCount)).toEqual([1, 1]);
    expect(tracker.liveCount).toBe(0);
  });

  it('does not destroy again a resource the caller already destroyed', () => {
    const tracker = new ResourceTracker();
    const destroyedEarly = new CountingResource(tracker);
    destroyedEarly.destroy();
    tracker.destroyAll();
    expect(destroyedEarly.destroyCount).toBe(1);
  });

  it('counts live resources as they are tracked and destroyed', () => {
    const tracker = new ResourceTracker();
    const first = new CountingResource(tracker);
    new CountingResource(tracker);
    first.destroy();
    expect(tracker.liveCount).toBe(1);
  });
});
