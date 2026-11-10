import { describe, expect, it } from 'vitest';

import type { ObjectId } from '@canvas/schema';

import type { WorldTransform } from '../scene/world-transform.js';

import { imageObject } from './__fixtures__/image-objects.js';
import { ImageIndex } from './image-index.js';

const AT_ORIGIN: WorldTransform = { cos: 1, sin: 0, x: 0, y: 0 };

describe('ImageIndex', () => {
  it('keeps its version when the same object and transform are tracked again', () => {
    const index = new ImageIndex();
    const object = imageObject();
    index.track({ object, transform: AT_ORIGIN });
    const version = index.version;

    const again = index.track({ object, transform: AT_ORIGIN });

    expect(index.version).toBe(version);
    expect(again).toBe(index.get(object.id));
  });

  it('changes its version when an image moves, changes or leaves', () => {
    const index = new ImageIndex();
    const object = imageObject();
    index.track({ object, transform: AT_ORIGIN });
    const versions = [index.version];

    index.track({ object, transform: { ...AT_ORIGIN, x: 500 } });
    versions.push(index.version);
    index.track({ object: imageObject({ opacity: 0.5 }), transform: AT_ORIGIN });
    versions.push(index.version);
    index.forget(object.id);
    versions.push(index.version);

    expect(new Set(versions).size).toBe(4);
    expect(index.search({ minX: -1, minY: -1, maxX: 1000, maxY: 1000 })).toEqual([]);
  });

  it('ignores objects that are not images, leaving its version alone', () => {
    const index = new ImageIndex();
    const version = index.version;

    const tracked = index.track({
      object: { ...imageObject(), type: 'shape' } as never,
      transform: AT_ORIGIN,
    });

    expect(tracked).toBeUndefined();
    expect(index.version).toBe(version);
    expect(index.get('image-1' as ObjectId)).toBeUndefined();
  });

  it('forgets nothing for an object it does not track', () => {
    const index = new ImageIndex();
    const version = index.version;

    expect(index.forget('never-tracked' as ObjectId)).toBeUndefined();
    expect(index.version).toBe(version);
  });
});
