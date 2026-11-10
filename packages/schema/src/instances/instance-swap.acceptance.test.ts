// Acceptance: swap records are retained even when their targets cannot render.
import { describe, expect, it } from 'vitest';

import * as schema from '@canvas/schema';
import type { Board, InstanceObject, ObjectId } from '@canvas/schema';

import { sampleObject } from '../objects/__fixtures__/object-samples.js';
import { instanceObjectSchema } from '../objects/instance-object.js';
import { deepFreeze } from '../rules/__fixtures__/deep-freeze.js';

import { boardOf, component, id, instance, shape } from './__fixtures__/component-board.js';
import { overrideRecordSchema } from './instance-overrides.js';
import { editableOverrideFields, instanceOverrideFields } from './override-content.js';

const effectiveSlotMain = (
  schema as typeof schema & {
    effectiveSlotMain: (
      board: Board,
      slot: InstanceObject,
      record: Readonly<{ mainId?: ObjectId }> | undefined,
      ancestorMains: readonly ObjectId[],
    ) => ObjectId;
  }
).effectiveSlotMain;

const slot = instance('slot', 'icon-a', { parentId: 'button' });

function boardWith(target: object = component('icon-b')) {
  return boardOf([component('button'), component('icon-a'), slot, target]);
}

describe('instance swap schema', () => {
  it('accepts mainId only on an instance child and excludes it from editable rows', () => {
    expect(overrideRecordSchema.safeParse({ mainId: id('icon-b') }).success).toBe(true);
    expect(instanceOverrideFields(slot)).toContain('mainId');
    expect(editableOverrideFields(slot)).not.toContain('mainId');
    for (const type of ['text', 'shape'] as const) {
      expect(instanceOverrideFields(sampleObject(type, type))).not.toContain('mainId');
    }
  });

  it('requires one to 64 distinct swap option ids without checking board membership', () => {
    const base = sampleObject('instance', 'slot');
    const options = Array.from({ length: 64 }, (unused, index) => id(`icon-${String(index)}`));
    expect(instanceObjectSchema.safeParse({ ...base, swapOptions: [id('missing')] }).success).toBe(
      true,
    );
    expect(instanceObjectSchema.safeParse({ ...base, swapOptions: options }).success).toBe(true);
    for (const invalid of [[], [...options, id('extra')], [id('same'), id('same')]]) {
      expect(instanceObjectSchema.safeParse({ ...base, swapOptions: invalid }).success).toBe(false);
    }
  });
});

describe('effectiveSlotMain', () => {
  it('uses a live target and leaves frozen inputs untouched', () => {
    const board = deepFreeze(boardWith());
    const frozenSlot = deepFreeze(slot);
    const record = deepFreeze({ mainId: id('icon-b') });
    const ancestors = deepFreeze([id('button')]);
    expect(effectiveSlotMain(board, frozenSlot, record, ancestors)).toBe(id('icon-b'));
    expect(record).toEqual({ mainId: id('icon-b') });
    expect(ancestors).toEqual([id('button')]);
  });

  it('uses the stored main without a swap or for a missing, non-component, or retired target', () => {
    expect(effectiveSlotMain(boardWith(), slot, undefined, [id('button')])).toBe(id('icon-a'));
    expect(effectiveSlotMain(boardWith(), slot, { mainId: id('missing') }, [id('button')])).toBe(
      id('icon-a'),
    );
    expect(
      effectiveSlotMain(boardWith(shape('icon-b', null)), slot, { mainId: id('icon-b') }, [
        id('button'),
      ]),
    ).toBe(id('icon-a'));
    expect(
      effectiveSlotMain(
        boardWith(component('icon-b', { retired: true })),
        slot,
        { mainId: id('icon-b') },
        [id('button')],
      ),
    ).toBe(id('icon-a'));
  });

  it('falls back when the target is an ancestor or its nesting exceeds depth five', () => {
    expect(effectiveSlotMain(boardWith(), slot, { mainId: id('button') }, [id('button')])).toBe(
      id('icon-a'),
    );
    const chain = [
      component('deep'),
      component('m1'),
      component('m2'),
      component('m3'),
      component('m4'),
      instance('i1', 'm1', { parentId: 'deep' }),
      instance('i2', 'm2', { parentId: 'm1' }),
      instance('i3', 'm3', { parentId: 'm2' }),
      instance('i4', 'm4', { parentId: 'm3' }),
    ];
    expect(
      effectiveSlotMain(
        boardOf([component('button'), component('icon-a'), slot, ...chain]),
        slot,
        { mainId: id('deep') },
        [id('button')],
      ),
    ).toBe(id('icon-a'));
  });
});
