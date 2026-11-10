import { describe, expect, it } from 'vitest';

import { createLargeBoardObjects } from '@canvas/document';
import type { BoardObject, ObjectId } from '@canvas/schema';

import {
  selectionStyleContext,
  selectionStyleContextInStages,
  STAGED_STYLE_OBJECTS,
} from './selection-style-context.js';
import { StyleContextReader } from './style-context-reader.js';

/** A large board's objects, with text among them. */
const OBJECTS: readonly BoardObject[] = createLargeBoardObjects(1_400, 7);

describe('the style context of a large selection', () => {
  it('is the same worked out in stages as at once, yielding between parts', async () => {
    let stages = 0;
    const staged = await selectionStyleContextInStages(OBJECTS, () => {
      stages += 1;
      return Promise.resolve();
    });
    expect(selectionStyleContext(OBJECTS)).toBeDefined();
    expect(staged).toEqual(selectionStyleContext(OBJECTS));
    expect(stages).toBeGreaterThan(1);
  });

  it('is undefined when nothing selected has text', async () => {
    expect(await selectionStyleContextInStages([undefined], () => Promise.resolve())).toBe(
      undefined,
    );
  });

  it('is read in stages once, cached, and dropped when the selection changed meanwhile', async () => {
    const byId = new Map(OBJECTS.map((object) => [object.id, object]));
    let selection: readonly ObjectId[] = OBJECTS.map(({ id }) => id);
    const reader = new StyleContextReader({
      session: () => undefined,
      selection: () => selection,
      get: (id) => byId.get(id),
      version: () => 0,
    });
    expect(selection.length).toBeGreaterThan(STAGED_STYLE_OBJECTS);
    expect(reader.isStaged()).toBe(true);
    const read = await reader.readInStages(() => Promise.resolve());
    expect(read?.context).toEqual(selectionStyleContext(OBJECTS));
    expect(reader.isStaged()).toBe(false);
    expect(reader.read()).toBe(read?.context);
    const stale = reader.readInStages(() => {
      selection = [...selection];
      return Promise.resolve();
    });
    selection = [...selection];
    expect(await stale).toBeUndefined();
  });
});

describe('the style context of a connector', () => {
  it('is its label’s style when it has one, and undefined without', () => {
    const connector = OBJECTS.find((object) => object.type === 'connector');
    if (connector === undefined) throw new Error('No connector on the large board.');
    const label = {
      text: 'Yes',
      runs: [
        {
          length: 3,
          style: { fontFamily: 'Lora', fontSize: 18, color: [0.1, 0.2, 0.3, 1] as const },
        },
      ],
    };
    const labelled = { ...connector, label } as BoardObject;
    expect(selectionStyleContext([labelled])?.style).toMatchObject({
      fontFamily: 'Lora',
      fontSize: 18,
    });
    expect(selectionStyleContext([{ ...connector, label: null }])).toBeUndefined();
  });
});
