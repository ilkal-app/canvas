import { bench, describe } from 'vitest';

import { sampleObject } from './__fixtures__/object-samples.js';
import { boardObjectSchema } from './board-object.js';
import { OBJECT_TYPES } from './object-type.js';

// The command layer validates every object a command writes, so a
// multi-object command such as a paste or an agent's create_objects parses this many at once.
const objects = [...Array(1000).keys()].map((index) => {
  const type = OBJECT_TYPES[index % OBJECT_TYPES.length] ?? 'shape';
  return sampleObject(type, `object-${String(index)}`);
});

describe('boardObjectSchema', () => {
  bench('parses 1000 objects of mixed types', () => {
    for (const object of objects) boardObjectSchema.parse(object);
  });
});
